import type { Clock } from '../clock.js';
import { toEpochMillis, toIso } from '../clock.js';
import type { SourceStatus } from '../contracts/evidence.js';
import type { Expectation, Rule } from '../contracts/rule.js';
import {
  expectationId,
  resolveCardinality,
  resolveCorrelation,
  triggerTypes,
} from '../contracts/rule.js';
import { parseDuration } from '../duration.js';
import type { DedupedEvent, EvidenceSet } from '../evidence-set.js';
import { getPath, stableKey } from '../path.js';
import type {
  AggregateSummary,
  CorrelationHopSummary,
  CorrelationSummary,
  ExpectationVerdict,
  ObservationSummary,
  Reason,
  RuleVerdict,
  SourceAssessment,
  Verdict,
} from '../verdict.js';
import { combineVerdicts } from '../verdict.js';
import { evaluateAggregate } from './aggregates.js';
import { evaluateAssertion } from './assertions.js';

export interface EvaluateOptions {
  clock: Clock;
}

function sourceEvidenceId(status: SourceStatus): string {
  return `source:${status.source}@${status.observedAt}`;
}

function assessSource(status: SourceStatus | undefined, deadline: number): SourceAssessment {
  if (status === undefined) {
    return {
      source: '',
      trusted: false,
      status: 'missing',
      authoritative: null,
      completeThrough: null,
      watermarkClamped: false,
      completeThroughDeadline: false,
      observedAt: null,
    };
  }
  // A source can only vouch for what it had seen when it was observed.
  const observedAt = toEpochMillis(status.observedAt);
  const attested =
    status.completeThrough === undefined ? null : toEpochMillis(status.completeThrough);
  const watermarkClamped = attested !== null && attested > observedAt;
  const effective = attested === null ? null : Math.min(attested, observedAt);
  const completeThrough = effective === null ? null : toIso(effective);
  const trusted = status.status === 'available' && status.authoritative;
  return {
    source: status.source,
    trusted,
    status: status.status,
    authoritative: status.authoritative,
    completeThrough,
    watermarkClamped,
    completeThroughDeadline: trusted && effective !== null && effective >= deadline,
    observedAt: status.observedAt,
  };
}

function untrustedReason(
  source: SourceAssessment,
  sourceIds: readonly string[],
  subject: string,
  detail: string,
): Reason {
  if (source.status === 'missing') {
    return {
      code: 'SOURCE_STATUS_MISSING',
      message: `no attestation for ${subject} source "${source.source}"; ${detail}`,
      evidenceIds: [...sourceIds],
    };
  }
  if (source.status === 'unavailable') {
    return {
      code: 'SOURCE_UNAVAILABLE',
      message: `${subject} source "${source.source}" was unavailable at ${source.observedAt ?? '?'}; ${detail}`,
      evidenceIds: [...sourceIds],
    };
  }
  return {
    code: 'SOURCE_NOT_AUTHORITATIVE',
    message: `${subject} source "${source.source}" is not authoritative; ${detail}`,
    evidenceIds: [...sourceIds],
  };
}

type Placement = ObservationSummary['placement'];

function placeObservation(occurredAt: number, windowStart: number, deadline: number): Placement {
  if (occurredAt < windowStart) return 'early';
  if (occurredAt > deadline) return 'late';
  return 'in-window';
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

interface ExpectationContext {
  rule: Rule;
  expectation: Expectation;
  trigger: DedupedEvent;
  evidence: EvidenceSet;
  now: number;
}

function evaluateExpectation(ctx: ExpectationContext): ExpectationVerdict {
  const { rule, expectation, trigger, evidence, now } = ctx;
  const id = expectationId(expectation);
  const triggerAt = toEpochMillis(trigger.canonical.occurredAt);
  const windowStart =
    triggerAt -
    (expectation.window.before === undefined ? 0 : parseDuration(expectation.window.before));
  const deadline = triggerAt + parseDuration(expectation.window.within);
  const { min, max } = resolveCardinality(expectation.cardinality);
  const reasons: Reason[] = [];

  const rawStatus = evidence.sourceStatus(expectation.source);
  const source: SourceAssessment = {
    ...assessSource(rawStatus, deadline),
    source: expectation.source,
  };
  const sourceIds = rawStatus === undefined ? [] : [sourceEvidenceId(rawStatus)];

  const base = {
    expectationId: id,
    type: expectation.type,
    deadline: toIso(deadline),
    windowStart: toIso(windowStart),
    cardinality: { min, max: Number.isFinite(max) ? max : null },
    source,
  };

  const { triggerPath, observationPath, via } = resolveCorrelation(rule, expectation);
  const correlationValue = getPath(trigger.canonical.payload, triggerPath);
  if (correlationValue === undefined) {
    reasons.push({
      code: 'CORRELATION_VALUE_MISSING',
      message: `trigger ${trigger.canonical.eventId} has no value at "${triggerPath}"; cannot correlate`,
      evidenceIds: [trigger.canonical.eventId],
    });
    return {
      ...base,
      verdict: 'UNKNOWN',
      correlation: { triggerPath, observationPath, keys: [], hops: [] },
      distinctInWindow: 0,
      observations: [],
      aggregates: notEvaluated(expectation),
      reasons,
    };
  }

  // Walk the correlation chain: each hop maps the current key set to the next
  // through events of its own type and source, inside the same window.
  let keys = new Set<string>([stableKey(correlationValue)]);
  const hops: CorrelationHopSummary[] = [];
  const hopLinks: { assessment: SourceAssessment; ids: string[]; label: string }[] = [];
  for (const hop of via) {
    const hopStatus = evidence.sourceStatus(hop.source);
    const assessment: SourceAssessment = {
      ...assessSource(hopStatus, deadline),
      source: hop.source,
    };
    const ids = hopStatus === undefined ? [] : [sourceEvidenceId(hopStatus)];
    const incoming = keys;
    const matched = evidence
      .eventsOfType(hop.type)
      .filter((event) => event.canonical.source === hop.source)
      .filter((event) => {
        const occurred = toEpochMillis(event.canonical.occurredAt);
        return occurred >= windowStart && occurred <= deadline;
      })
      .filter((event) => {
        const from = getPath(event.canonical.payload, hop.from);
        return from !== undefined && incoming.has(stableKey(from));
      });
    const next = new Set<string>();
    for (const event of matched) {
      const to = getPath(event.canonical.payload, hop.to);
      if (to !== undefined) next.add(stableKey(to));
    }
    const matchedIds = matched.map((event) => event.canonical.eventId);
    hops.push({
      type: hop.type,
      source: hop.source,
      matched: matched.length,
      keys: [...next].sort(),
      evidenceIds: matchedIds,
      sourceAssessment: assessment,
    });
    hopLinks.push({ assessment, ids, label: `hop ${hop.type}` });
    reasons.push({
      code: 'CORRELATION_HOP',
      message: `hop ${hop.type} from "${hop.source}": ${plural(matched.length, 'event')} matched ${plural(incoming.size, 'key')} via "${hop.from}", yielding ${plural(next.size, 'key')} via "${hop.to}"`,
      evidenceIds: [...ids, ...matchedIds],
    });
    keys = next;
  }
  const correlation: CorrelationSummary = {
    triggerPath,
    observationPath,
    keys: [...keys].sort(),
    hops,
  };

  const candidates = evidence
    .eventsOfType(expectation.type)
    .filter((event) => event.canonical.source === expectation.source)
    .filter((event) => {
      const value = getPath(event.canonical.payload, observationPath);
      return value !== undefined && keys.has(stableKey(value));
    });

  const observations: ObservationSummary[] = candidates.map((event) => {
    const distinctValue =
      expectation.distinctBy === undefined
        ? event.canonical.eventId
        : getPath(event.canonical.payload, expectation.distinctBy);
    return {
      eventId: event.canonical.eventId,
      type: event.canonical.type,
      source: event.canonical.source,
      occurredAt: event.canonical.occurredAt,
      collectedAt: event.canonical.collectedAt,
      distinctKey:
        distinctValue === undefined ? `event:${event.canonical.eventId}` : stableKey(distinctValue),
      deliveries: event.deliveries.length,
      placement: placeObservation(toEpochMillis(event.canonical.occurredAt), windowStart, deadline),
    };
  });

  for (const [index, event] of candidates.entries()) {
    if (event.deliveries.length > 1) {
      reasons.push({
        code: 'REDELIVERY_DEDUPLICATED',
        message: `event ${event.canonical.eventId} was delivered ${event.deliveries.length} times and counted once`,
        evidenceIds: [event.canonical.eventId],
      });
    }
    const summary = observations[index];
    if (summary?.placement === 'early') {
      reasons.push({
        code: 'EARLY_OUTCOME',
        message: `${expectation.type} ${event.canonical.eventId} occurred at ${event.canonical.occurredAt}, before the window start ${toIso(windowStart)}; not counted`,
        evidenceIds: [event.canonical.eventId],
      });
    }
  }

  const inWindow = candidates.filter((_, index) => observations[index]?.placement === 'in-window');
  const late = candidates.filter((_, index) => observations[index]?.placement === 'late');
  const distinct = new Map<string, DedupedEvent[]>();
  for (const [index, event] of candidates.entries()) {
    const summary = observations[index];
    if (summary?.placement !== 'in-window') continue;
    const bucket = distinct.get(summary.distinctKey) ?? [];
    bucket.push(event);
    distinct.set(summary.distinctKey, bucket);
  }
  const distinctInWindow = distinct.size;
  const inWindowIds = inWindow.map((event) => event.canonical.eventId);

  let aggregates: AggregateSummary[] = notEvaluated(expectation);
  const finish = (verdict: Verdict): ExpectationVerdict => ({
    ...base,
    verdict,
    correlation,
    distinctInWindow,
    observations,
    aggregates,
    reasons,
  });

  // 1. Trust gate. Without an authoritative, available source nothing can be
  //    confirmed: not presence, not absence, not correctness.
  const untrustedHop = hopLinks.find((link) => !link.assessment.trusted);
  if (untrustedHop !== undefined) {
    reasons.push(
      untrustedReason(
        untrustedHop.assessment,
        [...untrustedHop.ids, ...inWindowIds],
        untrustedHop.label,
        'the correlation chain cannot be followed, so neither presence nor absence can be confirmed',
      ),
    );
    return finish('UNKNOWN');
  }
  if (!source.trusted) {
    const seen =
      candidates.length === 0
        ? 'no matching observations were collected'
        : `${plural(candidates.length, 'matching observation')} collected but cannot be trusted`;
    reasons.push(untrustedReason(source, [...sourceIds, ...inWindowIds], 'expectation', seen));
    if (now < deadline) {
      reasons.push({
        code: 'WINDOW_OPEN',
        message: `window is open until ${toIso(deadline)}; re-evaluate once the source is trustworthy`,
        evidenceIds: [],
      });
    }
    return finish('UNKNOWN');
  }

  // 2. Hard failures that authoritative evidence proves regardless of time.
  let failed = false;
  let indeterminate = false;
  for (const event of inWindow) {
    for (const assertion of expectation.assertions) {
      const outcome = evaluateAssertion(
        assertion,
        event.canonical.payload,
        trigger.canonical.payload,
      );
      if (outcome.status === 'fail') {
        failed = true;
        reasons.push({
          code: 'ASSERTION_MISMATCH',
          message: `${expectation.type} ${event.canonical.eventId}: ${outcome.message}`,
          evidenceIds: [event.canonical.eventId, trigger.canonical.eventId],
        });
      } else if (outcome.status === 'indeterminate') {
        indeterminate = true;
        reasons.push({
          code: 'CORRELATION_VALUE_MISSING',
          message: `${expectation.type} ${event.canonical.eventId}: ${outcome.message}`,
          evidenceIds: [event.canonical.eventId, trigger.canonical.eventId],
        });
      }
    }
  }
  if (distinctInWindow > max) {
    failed = true;
    const keys = [...distinct.keys()].sort();
    reasons.push({
      code: max === 0 ? 'UNEXPECTED_OUTCOME' : 'DUPLICATE_OUTCOME',
      message:
        max === 0
          ? `${plural(distinctInWindow, `distinct ${expectation.type} outcome`)} observed but none expected (keys: ${keys.join(', ')})`
          : `${plural(distinctInWindow, `distinct ${expectation.type} outcome`)} observed, at most ${max} allowed (keys: ${keys.join(', ')})`,
      evidenceIds: inWindowIds,
    });
  }
  const conflicts = candidates.filter((event) => event.conflicting);
  for (const event of conflicts) {
    reasons.push({
      code: 'CONFLICTING_REDELIVERY',
      message: `deliveries of event ${event.canonical.eventId} disagree on content (${event.deliveries
        .map((d) => d.deliveryId ?? d.collectedAt)
        .join(', ')})`,
      evidenceIds: [event.canonical.eventId],
    });
  }
  if (failed) return finish('FAIL');
  if (indeterminate || conflicts.length > 0) return finish('UNKNOWN');

  // The chain is only as complete as its weakest link.
  const links = [
    { assessment: source, ids: [...sourceIds], label: `source "${expectation.source}"` },
    ...hopLinks,
  ];
  const weakest = links.find((link) => !link.assessment.completeThroughDeadline);
  const chainComplete = weakest === undefined;

  // 3. Cardinality not yet met: missing, pending, or unknowable.
  const windowOpen = now < deadline;
  if (distinctInWindow < min) {
    if (windowOpen) {
      reasons.push({
        code: 'WINDOW_OPEN',
        message: `${distinctInWindow} of ${min} required ${expectation.type} observed; window is open until ${toIso(deadline)}`,
        evidenceIds: inWindowIds,
      });
      return finish('PENDING');
    }
    if (chainComplete) {
      if (late.length > 0) {
        reasons.push({
          code: 'LATE_OUTCOME',
          message: `${expectation.type} observed only after the deadline ${toIso(deadline)}: ${late
            .map((event) => `${event.canonical.eventId} at ${event.canonical.occurredAt}`)
            .join(', ')}`,
          evidenceIds: late.map((event) => event.canonical.eventId),
        });
      }
      reasons.push({
        code: 'MISSING_EXPECTED_OUTCOME',
        message: `${distinctInWindow} of ${min} required ${expectation.type} observed by ${toIso(deadline)}; source "${expectation.source}" is complete through ${source.completeThrough ?? '?'}`,
        evidenceIds: [...sourceIds, trigger.canonical.eventId, ...inWindowIds],
      });
      return finish('FAIL');
    }
    return finishIncomplete(
      ctx,
      weakestLink(links),
      deadline,
      reasons,
      finish,
      distinctInWindow,
      min,
    );
  }

  // 4. Cardinality within bounds. If more arrivals could still break the
  //    upper bound, or an aggregate depends on the whole set, PASS needs a
  //    closed window and a complete source.
  if (Number.isFinite(max) || expectation.aggregates.length > 0) {
    if (windowOpen) {
      reasons.push({
        code: 'WINDOW_OPEN',
        message: `${plural(distinctInWindow, `${expectation.type} outcome`)} observed; cardinality is bounded (max ${max}) and the window is open until ${toIso(deadline)}`,
        evidenceIds: inWindowIds,
      });
      return finish('PENDING');
    }
    if (!chainComplete) {
      return finishIncomplete(
        ctx,
        weakestLink(links),
        deadline,
        reasons,
        finish,
        distinctInWindow,
        min,
      );
    }
  }
  // 5. Aggregates over the complete set of distinct outcomes.
  if (expectation.aggregates.length > 0) {
    const representatives = [...distinct.values()].map((bucket) => {
      const [first] = bucket;
      if (first === undefined) throw new Error('unreachable: empty distinct bucket');
      return first.canonical.payload;
    });
    aggregates = expectation.aggregates.map((aggregate) =>
      evaluateAggregate(aggregate, representatives, trigger.canonical.payload),
    );
    let aggregateFailed = false;
    let aggregateIndeterminate = false;
    for (const summary of aggregates) {
      if (summary.status === 'fail') {
        aggregateFailed = true;
        reasons.push({
          code: 'AGGREGATE_MISMATCH',
          message: `${expectation.type}: ${summary.message}`,
          evidenceIds: [...inWindowIds, trigger.canonical.eventId],
        });
      } else if (summary.status === 'indeterminate') {
        aggregateIndeterminate = true;
        reasons.push({
          code: 'CORRELATION_VALUE_MISSING',
          message: `${expectation.type}: ${summary.message}`,
          evidenceIds: [trigger.canonical.eventId],
        });
      }
    }
    if (aggregateFailed) return finish('FAIL');
    if (aggregateIndeterminate) return finish('UNKNOWN');
  }
  reasons.push({
    code: 'OUTCOME_CONFIRMED',
    message: `${plural(distinctInWindow, `distinct ${expectation.type} outcome`)} observed within ${expectation.window.within} (bounds ${min}..${Number.isFinite(max) ? max : '∞'}); ${expectation.assertions.length === 0 ? 'no assertions' : plural(expectation.assertions.length, 'assertion') + ' satisfied'}${expectation.aggregates.length === 0 ? '' : `; ${plural(expectation.aggregates.length, 'aggregate')} satisfied`}; source "${expectation.source}" authoritative${source.completeThrough === null ? '' : `, complete through ${source.completeThrough}`}`,
    evidenceIds: [...sourceIds, trigger.canonical.eventId, ...inWindowIds],
  });
  return finish('PASS');
}

function notEvaluated(expectation: Expectation): AggregateSummary[] {
  return expectation.aggregates.map((aggregate) => ({
    fn: aggregate.fn,
    field: aggregate.field ?? null,
    op: aggregate.op,
    value: null,
    expected:
      'trigger' in aggregate.expected
        ? `trigger.${aggregate.expected.trigger}`
        : aggregate.expected.value,
    status: 'not-evaluated',
    message: 'not evaluated: the observation set is not yet complete',
  }));
}

interface Link {
  assessment: SourceAssessment;
  ids: readonly string[];
  label: string;
}

function weakestLink(links: readonly Link[]): Link {
  const weakest = links.find((link) => !link.assessment.completeThroughDeadline);
  if (weakest === undefined) throw new Error('unreachable: chain is complete');
  return weakest;
}

function finishIncomplete(
  ctx: ExpectationContext,
  link: Link,
  deadline: number,
  reasons: Reason[],
  finish: (verdict: Verdict) => ExpectationVerdict,
  observed: number,
  min: number,
): ExpectationVerdict {
  const { expectation } = ctx;
  const { assessment: source, ids: sourceIds } = link;
  const who = link.label.startsWith('hop') ? `${link.label} source "${source.source}"` : link.label;
  if (source.completeThrough === null) {
    reasons.push({
      code: 'NO_COMPLETENESS_ATTESTATION',
      message: `${who} gives no completeness watermark; ${observed} of ${min} required ${expectation.type} observed but absence of further outcomes cannot be confirmed`,
      evidenceIds: [...sourceIds],
    });
    return finish('UNKNOWN');
  }
  reasons.push({
    code: 'SOURCE_INCOMPLETE',
    message: `${who} is complete only through ${source.completeThrough}${source.watermarkClamped ? ' (watermark clamped to the attestation instant)' : ''}, before the deadline ${toIso(deadline)}; ${observed} of ${min} required ${expectation.type} observed so far`,
    evidenceIds: [...sourceIds],
  });
  return finish('PENDING');
}

/** Evaluate one rule against one (deduplicated) trigger event. */
export function evaluateTrigger(
  rule: Rule,
  trigger: DedupedEvent,
  evidence: EvidenceSet,
  options: EvaluateOptions,
): RuleVerdict {
  const types = triggerTypes(rule);
  if (!types.includes(trigger.canonical.type)) {
    throw new TypeError(
      `event ${trigger.canonical.eventId} has type "${trigger.canonical.type}" but rule ${rule.id} triggers on "${types.join('" | "')}"`,
    );
  }
  if (rule.trigger.source !== undefined && trigger.canonical.source !== rule.trigger.source) {
    throw new TypeError(
      `event ${trigger.canonical.eventId} comes from source "${trigger.canonical.source}" but rule ${rule.id} triggers on source "${rule.trigger.source}"`,
    );
  }
  const now = options.clock.now();
  const expectations = rule.expectations.map((expectation) =>
    evaluateExpectation({ rule, expectation, trigger, evidence, now }),
  );
  const correlationValue = getPath(trigger.canonical.payload, rule.trigger.correlationKey);
  const reasons: Reason[] = [];
  let triggerSource: SourceAssessment | null = null;
  let triggerTrusted = true;
  if (rule.trigger.source !== undefined) {
    const rawStatus = evidence.sourceStatus(rule.trigger.source);
    triggerSource = { ...assessSource(rawStatus, now), source: rule.trigger.source };
    if (!triggerSource.trusted) {
      triggerTrusted = false;
      reasons.push(
        untrustedReason(
          triggerSource,
          rawStatus === undefined
            ? [trigger.canonical.eventId]
            : [sourceEvidenceId(rawStatus), trigger.canonical.eventId],
          'trigger',
          `the ${triggerTypes(rule).join(' | ')} trigger and its values cannot be trusted, so no PASS or FAIL can be given`,
        ),
      );
    }
  }
  if (trigger.deliveries.length > 1) {
    reasons.push({
      code: 'REDELIVERY_DEDUPLICATED',
      message: `trigger ${trigger.canonical.eventId} was delivered ${trigger.deliveries.length} times and evaluated once`,
      evidenceIds: [trigger.canonical.eventId],
    });
  }
  if (trigger.conflicting) {
    reasons.push({
      code: 'CONFLICTING_REDELIVERY',
      message: `deliveries of trigger ${trigger.canonical.eventId} disagree on content`,
      evidenceIds: [trigger.canonical.eventId],
    });
  }
  const verdicts = expectations.map((e) => e.verdict);
  let verdict = trigger.conflicting
    ? combineVerdicts([...verdicts, 'UNKNOWN'])
    : combineVerdicts(verdicts);
  // An untrusted trigger poisons every conclusion drawn from its values.
  if (!triggerTrusted) verdict = 'UNKNOWN';
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    verdict,
    correlationKey: rule.trigger.correlationKey,
    correlationValue: correlationValue === undefined ? '' : stableKey(correlationValue),
    trigger: {
      eventId: trigger.canonical.eventId,
      type: trigger.canonical.type,
      occurredAt: trigger.canonical.occurredAt,
      collectedAt: trigger.canonical.collectedAt,
      deliveries: trigger.deliveries.length,
    },
    evaluatedAt: toIso(now),
    triggerSource,
    expectations,
    reasons: [...reasons, ...expectations.flatMap((e) => e.reasons)],
  };
}

/** Evaluate one rule against every trigger present in the evidence set. */
export function evaluateRule(
  rule: Rule,
  evidence: EvidenceSet,
  options: EvaluateOptions,
): RuleVerdict[] {
  const triggers = triggerTypes(rule)
    .flatMap((type) => evidence.eventsOfType(type))
    .filter(
      (trigger) =>
        rule.trigger.source === undefined || trigger.canonical.source === rule.trigger.source,
    )
    .sort((a, b) => {
      const byOccurred =
        toEpochMillis(a.canonical.occurredAt) - toEpochMillis(b.canonical.occurredAt);
      if (byOccurred !== 0) return byOccurred;
      const byCollected =
        toEpochMillis(a.canonical.collectedAt) - toEpochMillis(b.canonical.collectedAt);
      if (byCollected !== 0) return byCollected;
      return a.canonical.eventId < b.canonical.eventId
        ? -1
        : a.canonical.eventId > b.canonical.eventId
          ? 1
          : 0;
    });
  return triggers.map((trigger) => evaluateTrigger(rule, trigger, evidence, options));
}

/** Evaluate many rules; output order is deterministic (rule id, correlation, trigger time, trigger id). */
export function evaluateRules(
  rules: readonly Rule[],
  evidence: EvidenceSet,
  options: EvaluateOptions,
): RuleVerdict[] {
  const sortedRules = [...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sortedRules.flatMap((rule) => evaluateRule(rule, evidence, options));
}
