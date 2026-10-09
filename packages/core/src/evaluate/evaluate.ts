import type { Clock } from '../clock.js';
import { toEpochMillis, toIso } from '../clock.js';
import type { SourceStatus } from '../contracts/evidence.js';
import type { Expectation, Rule } from '../contracts/rule.js';
import { expectationId, resolveCardinality } from '../contracts/rule.js';
import { parseDuration } from '../duration.js';
import type { DedupedEvent, EvidenceSet } from '../evidence-set.js';
import { getPath, jsonEquals, stableKey } from '../path.js';
import type {
  ExpectationVerdict,
  ObservationSummary,
  Reason,
  RuleVerdict,
  SourceAssessment,
  Verdict,
} from '../verdict.js';
import { combineVerdicts } from '../verdict.js';
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

  const correlationValue = getPath(trigger.canonical.payload, rule.trigger.correlationKey);
  if (correlationValue === undefined) {
    reasons.push({
      code: 'CORRELATION_VALUE_MISSING',
      message: `trigger ${trigger.canonical.eventId} has no value at "${rule.trigger.correlationKey}"; cannot correlate`,
      evidenceIds: [trigger.canonical.eventId],
    });
    return { ...base, verdict: 'UNKNOWN', distinctInWindow: 0, observations: [], reasons };
  }

  const observationKey = expectation.correlationKey ?? rule.trigger.correlationKey;
  const candidates = evidence
    .eventsOfType(expectation.type)
    .filter((event) => event.canonical.source === expectation.source)
    .filter((event) =>
      jsonEquals(getPath(event.canonical.payload, observationKey), correlationValue),
    );

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

  const finish = (verdict: Verdict): ExpectationVerdict => ({
    ...base,
    verdict,
    distinctInWindow,
    observations,
    reasons,
  });

  // 1. Trust gate. Without an authoritative, available source nothing can be
  //    confirmed: not presence, not absence, not correctness.
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
    if (source.completeThroughDeadline) {
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
      source,
      sourceIds,
      deadline,
      reasons,
      finish,
      distinctInWindow,
      min,
    );
  }

  // 4. Cardinality within bounds. If more arrivals could still break the
  //    upper bound, PASS needs a closed window and a complete source.
  if (Number.isFinite(max)) {
    if (windowOpen) {
      reasons.push({
        code: 'WINDOW_OPEN',
        message: `${plural(distinctInWindow, `${expectation.type} outcome`)} observed; cardinality is bounded (max ${max}) and the window is open until ${toIso(deadline)}`,
        evidenceIds: inWindowIds,
      });
      return finish('PENDING');
    }
    if (!source.completeThroughDeadline) {
      return finishIncomplete(
        ctx,
        source,
        sourceIds,
        deadline,
        reasons,
        finish,
        distinctInWindow,
        min,
      );
    }
  }
  reasons.push({
    code: 'OUTCOME_CONFIRMED',
    message: `${plural(distinctInWindow, `distinct ${expectation.type} outcome`)} observed within ${expectation.window.within} (bounds ${min}..${Number.isFinite(max) ? max : '∞'}); ${expectation.assertions.length === 0 ? 'no assertions' : plural(expectation.assertions.length, 'assertion') + ' satisfied'}; source "${expectation.source}" authoritative${source.completeThrough === null ? '' : `, complete through ${source.completeThrough}`}`,
    evidenceIds: [...sourceIds, trigger.canonical.eventId, ...inWindowIds],
  });
  return finish('PASS');
}

function finishIncomplete(
  ctx: ExpectationContext,
  source: SourceAssessment,
  sourceIds: readonly string[],
  deadline: number,
  reasons: Reason[],
  finish: (verdict: Verdict) => ExpectationVerdict,
  observed: number,
  min: number,
): ExpectationVerdict {
  const { expectation } = ctx;
  if (source.completeThrough === null) {
    reasons.push({
      code: 'NO_COMPLETENESS_ATTESTATION',
      message: `source "${expectation.source}" gives no completeness watermark; ${observed} of ${min} required ${expectation.type} observed but absence of further outcomes cannot be confirmed`,
      evidenceIds: [...sourceIds],
    });
    return finish('UNKNOWN');
  }
  reasons.push({
    code: 'SOURCE_INCOMPLETE',
    message: `source "${expectation.source}" is complete only through ${source.completeThrough}${source.watermarkClamped ? ' (watermark clamped to the attestation instant)' : ''}, before the deadline ${toIso(deadline)}; ${observed} of ${min} required ${expectation.type} observed so far`,
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
  if (trigger.canonical.type !== rule.trigger.type) {
    throw new TypeError(
      `event ${trigger.canonical.eventId} has type "${trigger.canonical.type}" but rule ${rule.id} triggers on "${rule.trigger.type}"`,
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
          `the ${rule.trigger.type} trigger and its values cannot be trusted, so no PASS or FAIL can be given`,
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
  return evidence
    .eventsOfType(rule.trigger.type)
    .filter(
      (trigger) =>
        rule.trigger.source === undefined || trigger.canonical.source === rule.trigger.source,
    )
    .map((trigger) => evaluateTrigger(rule, trigger, evidence, options));
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
