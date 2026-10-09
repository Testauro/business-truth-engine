import type { RuleVerdict, Verdict } from '@bte/core';
import { VERDICTS } from '@bte/core';

export const REPORT_SCHEMA_VERSION = 1;

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
  summary: Record<Verdict, number>;
  verdicts: readonly RuleVerdict[];
}

export function summarize(verdicts: readonly RuleVerdict[]): Record<Verdict, number> {
  const summary: Record<Verdict, number> = { PASS: 0, FAIL: 0, PENDING: 0, UNKNOWN: 0 };
  for (const verdict of verdicts) summary[verdict.verdict] += 1;
  return summary;
}

export function renderJson(report: EvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
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
    for (const reason of verdict.reasons) {
      const ids = reason.evidenceIds.length > 0 ? ` [${reason.evidenceIds.join(', ')}]` : '';
      lines.push(`        - ${reason.code}: ${reason.message}${ids}`);
    }
    lines.push('');
  }
  lines.push(
    `summary: ${VERDICTS.map((verdict) => `${verdict}=${report.summary[verdict]}`).join(' ')}`,
  );
  return `${lines.join('\n')}\n`;
}

function describeSource(source: RuleVerdict['expectations'][number]['source']): string {
  if (source.status === 'missing') return '(no attestation)';
  const parts = [source.status, source.authoritative ? 'authoritative' : 'non-authoritative'];
  if (source.completeThrough !== null) parts.push(`complete through ${source.completeThrough}`);
  return `(${parts.join(', ')})`;
}
