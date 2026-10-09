import type { RuleVerdict } from '@bte/core';
import { stableKey } from '@bte/core';
import { loadBteConfig, verify } from '@bte/sdk';
import type { LoadConfigOptions } from '@bte/sdk';

export interface ExplainOptions {
  config: LoadConfigOptions;
  ruleId: string;
  /** Correlation value as typed on the command line; matched against the verdict's correlation value. */
  correlation: string;
  now?: string | undefined;
}

export function explainText(verdict: RuleVerdict): string {
  const lines: string[] = [];
  lines.push(
    `${verdict.verdict}  ${verdict.ruleId}@v${verdict.ruleVersion}  ${verdict.correlationKey}=${verdict.correlationValue}`,
  );
  lines.push(
    `trigger: ${verdict.trigger.type} ${verdict.trigger.eventId} occurred ${verdict.trigger.occurredAt}, collected ${verdict.trigger.collectedAt}, ${verdict.trigger.deliveries} deliver${verdict.trigger.deliveries === 1 ? 'y' : 'ies'}`,
  );
  lines.push(`evaluated at: ${verdict.evaluatedAt}`);
  if (verdict.triggerSource !== null) {
    lines.push(
      `trigger source ${verdict.triggerSource.source}: ${verdict.triggerSource.trusted ? 'trusted' : 'NOT trusted'} (${verdict.triggerSource.status}${verdict.triggerSource.completeThrough === null ? '' : `, complete through ${verdict.triggerSource.completeThrough}`})`,
    );
  }
  for (const e of verdict.expectations) {
    lines.push('');
    lines.push(`expectation ${e.expectationId} (${e.type} from ${e.source.source}): ${e.verdict}`);
    lines.push(
      `  window ${e.windowStart} .. ${e.deadline}; cardinality ${e.cardinality.min}..${e.cardinality.max ?? '∞'}; ${e.distinctInWindow} distinct in window`,
    );
    lines.push(
      `  source: ${e.source.status}${e.source.authoritative === null ? '' : e.source.authoritative ? ', authoritative' : ', NOT authoritative'}${e.source.completeThrough === null ? ', no completeness watermark' : `, complete through ${e.source.completeThrough}${e.source.watermarkClamped ? ' (clamped)' : ''}`}`,
    );
    if (e.correlation.hops.length > 0) {
      lines.push(
        `  correlation: ${e.correlation.triggerPath} -> ${e.correlation.hops.map((h) => `${h.type}[${h.matched}]`).join(' -> ')} -> ${e.correlation.observationPath}; keys ${e.correlation.keys.join(', ') || '(none)'}`,
      );
    }
    for (const o of e.observations) {
      lines.push(
        `  observation ${o.eventId}: ${o.placement}, occurred ${o.occurredAt}, ${o.deliveries} deliver${o.deliveries === 1 ? 'y' : 'ies'}, key ${o.distinctKey}`,
      );
    }
    for (const a of e.aggregates)
      lines.push(
        `  aggregate ${a.fn}(${a.field ?? ''}) ${a.op}: ${a.status}${a.value === null ? '' : ` = ${a.value}`}; ${a.message}`,
      );
  }
  lines.push('');
  lines.push('reasons:');
  for (const r of verdict.reasons)
    lines.push(
      `  - ${r.code}: ${r.message}${r.evidenceIds.length > 0 ? ` [${r.evidenceIds.join(', ')}]` : ''}`,
    );
  return `${lines.join('\n')}\n`;
}

/** Evaluate once and explain the single verdict for a rule and correlation value. */
export async function runExplain(
  options: ExplainOptions,
): Promise<{ verdict: RuleVerdict | undefined; text: string; candidates: string[] }> {
  const loaded = await loadBteConfig(options.config);
  const rule = (await import('@bte/sdk')).loadConfiguredRules;
  const rules = await rule(loaded);
  if (!rules.some((r) => r.id === options.ruleId)) {
    return {
      verdict: undefined,
      text: `unknown rule "${options.ruleId}"; configured rules: ${rules.map((r) => r.id).join(', ')}\n`,
      candidates: [],
    };
  }
  const result = await verify(loaded, { now: options.now });
  const wanted = [
    options.correlation,
    stableKey(options.correlation),
    stableKey(Number(options.correlation)),
  ];
  const verdicts = result.verdicts.filter((v) => v.ruleId === options.ruleId);
  const verdict = verdicts.find((v) => wanted.includes(v.correlationValue));
  if (verdict === undefined) {
    const candidates = verdicts.map((v) => v.correlationValue);
    return {
      verdict: undefined,
      text: `no verdict for rule "${options.ruleId}" with correlation ${JSON.stringify(options.correlation)}; ${candidates.length === 0 ? 'no trigger events were found' : `known correlations: ${candidates.join(', ')}`}${result.failures.length > 0 ? `; sources unavailable: ${result.failures.map((f) => `${f.source} (${f.error})`).join(', ')}` : ''}\n`,
      candidates,
    };
  }
  return {
    verdict,
    text: explainText(verdict),
    candidates: verdicts.map((v) => v.correlationValue),
  };
}
