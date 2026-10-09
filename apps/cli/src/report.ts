import type { EvidenceSet, RuleVerdict, Verdict } from '@bte/core';
import { VERDICTS } from '@bte/core';

export const REPORT_SCHEMA_VERSION = 2;

export type FailOn = 'fail' | 'unknown' | 'pending';

/** Which verdicts fail the gate for each `--fail-on` level. */
export const GATE: Readonly<Record<FailOn, readonly Verdict[]>> = {
  fail: ['FAIL'],
  unknown: ['FAIL', 'UNKNOWN'],
  pending: ['FAIL', 'UNKNOWN', 'PENDING'],
};

/**
 * Process exit codes. They are part of the CLI contract (docs/reports.md):
 *  0 - evaluated; no verdict failed the gate
 *  1 - evaluated; at least one verdict failed the gate (`--fail-on`)
 *  2 - could not evaluate: invalid arguments, unreadable or invalid rules/evidence
 */
export const EXIT_OK = 0;
export const EXIT_GATE_FAILED = 1;
export const EXIT_ERROR = 2;

/** A resolved evidence reference so the report is self-contained. */
export interface EvidenceReference {
  id: string;
  kind: 'event' | 'source';
  type?: string;
  source: string;
  occurredAt?: string;
  collectedAt?: string;
  observedAt?: string;
  deliveries?: number;
  status?: 'available' | 'unavailable';
  authoritative?: boolean;
  completeThrough?: string | null;
}

export interface EvaluationReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generator: string;
  evaluatedAt: string;
  inputs: {
    rules: readonly string[];
    evidence: readonly string[];
    eventCount: number;
    sourceCount: number;
  };
  gate: {
    failOn: FailOn;
    failingVerdicts: readonly Verdict[];
    /** Verdicts (rule + correlation) that failed the gate. */
    failed: readonly { ruleId: string; correlationValue: string; verdict: Verdict }[];
  };
  exitCode: number;
  summary: Record<Verdict, number>;
  verdicts: readonly RuleVerdict[];
  /** Every evidence id cited by any reason, resolved against the evidence set. */
  evidence: readonly EvidenceReference[];
}

export function summarize(verdicts: readonly RuleVerdict[]): Record<Verdict, number> {
  const summary: Record<Verdict, number> = { PASS: 0, FAIL: 0, PENDING: 0, UNKNOWN: 0 };
  for (const verdict of verdicts) summary[verdict.verdict] += 1;
  return summary;
}

const SOURCE_REF = /^source:(.+)@(.+)$/;

/** Resolve every cited evidence id to a compact reference, sorted by id. */
export function indexEvidence(
  verdicts: readonly RuleVerdict[],
  evidence: EvidenceSet,
): EvidenceReference[] {
  const ids = new Set<string>();
  for (const verdict of verdicts) {
    for (const reason of verdict.reasons) for (const id of reason.evidenceIds) ids.add(id);
  }
  const references: EvidenceReference[] = [];
  for (const id of [...ids].sort()) {
    const sourceMatch = SOURCE_REF.exec(id);
    if (sourceMatch !== null) {
      const [, source] = sourceMatch;
      const status = source === undefined ? undefined : evidence.sourceStatus(source);
      references.push({
        id,
        kind: 'source',
        source: source ?? '',
        ...(status === undefined
          ? {}
          : {
              observedAt: status.observedAt,
              status: status.status,
              authoritative: status.authoritative,
              completeThrough: status.completeThrough ?? null,
            }),
      });
      continue;
    }
    const event = evidence.event(id);
    references.push({
      id,
      kind: 'event',
      source: event?.canonical.source ?? '',
      ...(event === undefined
        ? {}
        : {
            type: event.canonical.type,
            occurredAt: event.canonical.occurredAt,
            collectedAt: event.canonical.collectedAt,
            deliveries: event.deliveries.length,
          }),
    });
  }
  return references;
}

export function renderJson(report: EvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function describeSource(source: RuleVerdict['expectations'][number]['source']): string {
  if (source.status === 'missing') return '(no attestation)';
  const parts = [source.status, source.authoritative ? 'authoritative' : 'non-authoritative'];
  if (source.completeThrough !== null) parts.push(`complete through ${source.completeThrough}`);
  return `(${parts.join(', ')})`;
}

function reasonLine(reason: RuleVerdict['reasons'][number]): string {
  const ids = reason.evidenceIds.length > 0 ? ` [${reason.evidenceIds.join(', ')}]` : '';
  return `${reason.code}: ${reason.message}${ids}`;
}

export function renderText(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push(`Business Truth Engine evaluation @ ${report.evaluatedAt}`);
  lines.push(
    `rules: ${report.inputs.rules.join(', ')} | evidence: ${report.inputs.evidence.join(', ')} (${report.inputs.eventCount} events, ${report.inputs.sourceCount} sources)`,
  );
  lines.push('');
  for (const verdict of report.verdicts) {
    lines.push(
      `${verdict.verdict.padEnd(7)} ${verdict.ruleId}@v${verdict.ruleVersion}  ${verdict.correlationKey}=${verdict.correlationValue}  trigger=${verdict.trigger.eventId} (${verdict.trigger.occurredAt})`,
    );
    for (const expectation of verdict.expectations) {
      lines.push(
        `        ${expectation.verdict.padEnd(7)} ${expectation.expectationId}: ${expectation.distinctInWindow} distinct in window, deadline ${expectation.deadline}, source ${expectation.source.source} ${describeSource(expectation.source)}`,
      );
    }
    for (const reason of verdict.reasons) lines.push(`        - ${reasonLine(reason)}`);
    lines.push('');
  }
  lines.push(
    `summary: ${VERDICTS.map((verdict) => `${verdict}=${report.summary[verdict]}`).join(' ')}`,
  );
  lines.push(
    `gate: --fail-on ${report.gate.failOn} (${report.gate.failingVerdicts.join(', ')}) -> exit ${report.exitCode}`,
  );
  return `${lines.join('\n')}\n`;
}

const VERDICT_ICON: Readonly<Record<Verdict, string>> = {
  PASS: '✅',
  FAIL: '❌',
  PENDING: '⏳',
  UNKNOWN: '❓',
};

function mdCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Markdown suitable for pull-request comments and `$GITHUB_STEP_SUMMARY`. */
export function renderMarkdown(report: EvaluationReport): string {
  const lines: string[] = [];
  const headline = report.exitCode === EXIT_OK ? 'gate passed' : 'gate failed';
  lines.push(`## Business Truth Engine: ${headline}`);
  lines.push('');
  lines.push(
    `Evaluated at \`${report.evaluatedAt}\` · rules: ${report.inputs.rules.map((r) => `\`${r}\``).join(', ')} · evidence: ${report.inputs.evidence.map((e) => `\`${e}\``).join(', ')} (${report.inputs.eventCount} events, ${report.inputs.sourceCount} sources) · gate \`--fail-on ${report.gate.failOn}\` → exit \`${report.exitCode}\``,
  );
  lines.push('');
  lines.push('| Verdict | Count |');
  lines.push('| --- | ---: |');
  for (const verdict of VERDICTS) {
    lines.push(`| ${VERDICT_ICON[verdict]} ${verdict} | ${report.summary[verdict]} |`);
  }
  lines.push('');
  if (report.verdicts.length === 0) {
    lines.push('_No trigger events found; nothing was evaluated._');
    lines.push('');
  } else {
    lines.push('| Verdict | Rule | Correlation | Trigger | Reasons |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const verdict of report.verdicts) {
      const reasons = verdict.reasons
        .map(
          (reason) =>
            `\`${reason.code}\` ${mdCell(reason.message)}${reason.evidenceIds.length > 0 ? ` _(${reason.evidenceIds.map((id) => `\`${mdCell(id)}\``).join(', ')})_` : ''}`,
        )
        .join('<br>');
      lines.push(
        `| ${VERDICT_ICON[verdict.verdict]} ${verdict.verdict} | \`${verdict.ruleId}@v${verdict.ruleVersion}\` | \`${mdCell(verdict.correlationKey)}=${mdCell(verdict.correlationValue)}\` | \`${mdCell(verdict.trigger.eventId)}\` | ${reasons} |`,
      );
    }
    lines.push('');
  }
  if (report.evidence.length > 0) {
    lines.push('<details><summary>Cited evidence</summary>');
    lines.push('');
    lines.push('| Id | Kind | Source | Occurred / observed | Collected | Deliveries |');
    lines.push('| --- | --- | --- | --- | --- | ---: |');
    for (const ref of report.evidence) {
      lines.push(
        `| \`${mdCell(ref.id)}\` | ${ref.kind}${ref.type === undefined ? '' : ` ${ref.type}`} | ${ref.source} | ${ref.occurredAt ?? ref.observedAt ?? ''} | ${ref.collectedAt ?? ''} | ${ref.deliveries ?? ''} |`,
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function explanation(verdict: RuleVerdict): string {
  const lines = [
    `${verdict.verdict}: ${verdict.ruleId}@v${verdict.ruleVersion} ${verdict.correlationKey}=${verdict.correlationValue}`,
    `trigger ${verdict.trigger.type} ${verdict.trigger.eventId} at ${verdict.trigger.occurredAt}; evaluated at ${verdict.evaluatedAt}`,
  ];
  for (const expectation of verdict.expectations) {
    lines.push(
      `expectation ${expectation.expectationId} (${expectation.type}): ${expectation.verdict}; ${expectation.distinctInWindow} distinct in window; deadline ${expectation.deadline}; source ${expectation.source.source} ${describeSource(expectation.source)}`,
    );
  }
  for (const reason of verdict.reasons) lines.push(`- ${reasonLine(reason)}`);
  return lines.join('\n');
}

/**
 * JUnit XML: one testsuite per rule, one testcase per trigger (correlation).
 * Verdicts that fail the gate become `<failure>`; other non-PASS verdicts
 * become `<skipped>` with the verdict as the message, so dashboards show them
 * without failing the build. Evidence ids travel as testcase properties.
 */
export function renderJunit(report: EvaluationReport): string {
  const failing = new Set<Verdict>(report.gate.failingVerdicts);
  const byRule = new Map<string, RuleVerdict[]>();
  for (const verdict of report.verdicts) {
    const key = `${verdict.ruleId}@v${verdict.ruleVersion}`;
    const bucket = byRule.get(key) ?? [];
    bucket.push(verdict);
    byRule.set(key, bucket);
  }
  let totalFailures = 0;
  let totalSkipped = 0;
  const suites: string[] = [];
  for (const [suiteName, verdicts] of [...byRule.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const cases: string[] = [];
    let failures = 0;
    let skipped = 0;
    for (const verdict of verdicts) {
      const name = `${verdict.correlationKey}=${verdict.correlationValue}`;
      const evidenceIds = [...new Set(verdict.reasons.flatMap((reason) => reason.evidenceIds))];
      const codes = verdict.reasons.map((reason) => reason.code).join(', ');
      const body: string[] = [];
      body.push('      <properties>');
      body.push(`        <property name="bte.verdict" value="${xml(verdict.verdict)}"/>`);
      body.push(
        `        <property name="bte.rule" value="${xml(`${verdict.ruleId}@v${verdict.ruleVersion}`)}"/>`,
      );
      body.push(`        <property name="bte.trigger" value="${xml(verdict.trigger.eventId)}"/>`);
      body.push(`        <property name="bte.reasons" value="${xml(codes)}"/>`);
      body.push(`        <property name="bte.evidence" value="${xml(evidenceIds.join(','))}"/>`);
      body.push('      </properties>');
      if (failing.has(verdict.verdict)) {
        failures += 1;
        body.push(
          `      <failure message="${xml(`${verdict.verdict}: ${codes}`)}" type="${xml(verdict.verdict)}">${xml(explanation(verdict))}</failure>`,
        );
      } else if (verdict.verdict !== 'PASS') {
        skipped += 1;
        body.push(`      <skipped message="${xml(`${verdict.verdict}: ${codes}`)}"/>`);
      }
      body.push(`      <system-out>${xml(explanation(verdict))}</system-out>`);
      cases.push(
        `    <testcase name="${xml(name)}" classname="${xml(verdict.ruleId)}" time="0">\n${body.join('\n')}\n    </testcase>`,
      );
    }
    totalFailures += failures;
    totalSkipped += skipped;
    suites.push(
      `  <testsuite name="${xml(suiteName)}" tests="${verdicts.length}" failures="${failures}" errors="0" skipped="${skipped}" time="0" timestamp="${xml(report.evaluatedAt)}">\n${cases.join('\n')}\n  </testsuite>`,
    );
  }
  const header = `<testsuites name="bte" tests="${report.verdicts.length}" failures="${totalFailures}" errors="0" skipped="${totalSkipped}" time="0">`;
  const properties = [
    '  <properties>',
    `    <property name="bte.schemaVersion" value="${REPORT_SCHEMA_VERSION}"/>`,
    `    <property name="bte.generator" value="${xml(report.generator)}"/>`,
    `    <property name="bte.evaluatedAt" value="${xml(report.evaluatedAt)}"/>`,
    `    <property name="bte.failOn" value="${xml(report.gate.failOn)}"/>`,
    `    <property name="bte.exitCode" value="${report.exitCode}"/>`,
    `    <property name="bte.rules" value="${xml(report.inputs.rules.join(','))}"/>`,
    `    <property name="bte.evidenceFiles" value="${xml(report.inputs.evidence.join(','))}"/>`,
    '  </properties>',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n${header}\n${properties.join('\n')}\n${suites.join('\n')}${suites.length > 0 ? '\n' : ''}</testsuites>\n`;
}
