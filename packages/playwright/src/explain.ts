import type { RuleVerdict } from '@bte/core';

/** Human-readable, evidence-citing explanation used in assertion messages and attachments. */
export function explainVerdict(verdict: RuleVerdict): string {
  const lines: string[] = [];
  lines.push(
    `BTE ${verdict.verdict}: rule ${verdict.ruleId}@v${verdict.ruleVersion} for ${verdict.correlationKey}=${verdict.correlationValue}`,
  );
  lines.push(
    `  trigger ${verdict.trigger.type} ${verdict.trigger.eventId} at ${verdict.trigger.occurredAt}; evaluated at ${verdict.evaluatedAt}`,
  );
  if (verdict.triggerSource !== null) {
    lines.push(
      `  trigger source ${verdict.triggerSource.source}: ${verdict.triggerSource.trusted ? 'trusted' : 'NOT trusted'} ${describeSource(verdict.triggerSource)}`,
    );
  }
  for (const expectation of verdict.expectations) {
    lines.push(
      `  expectation "${expectation.expectationId}" (${expectation.type}): ${expectation.verdict}; ${expectation.distinctInWindow} distinct in window; deadline ${expectation.deadline}; source ${expectation.source.source} ${describeSource(expectation.source)}`,
    );
  }
  for (const reason of verdict.reasons) {
    const ids =
      reason.evidenceIds.length > 0 ? ` [evidence: ${reason.evidenceIds.join(', ')}]` : '';
    lines.push(`  - ${reason.code}: ${reason.message}${ids}`);
  }
  return lines.join('\n');
}

function describeSource(source: RuleVerdict['expectations'][number]['source']): string {
  if (source.status === 'missing') return '(no attestation)';
  const parts = [source.status, source.authoritative ? 'authoritative' : 'non-authoritative'];
  if (source.completeThrough !== null) parts.push(`complete through ${source.completeThrough}`);
  return `(${parts.join(', ')})`;
}
