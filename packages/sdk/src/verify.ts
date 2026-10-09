import path from 'node:path';
import type { Clock, EvidenceRecord, Rule, RuleVerdict } from '@bte/core';
import { EvidenceSet, FixedClock, SystemClock, collectAll, evaluateRules } from '@bte/core';
import { loadRules } from '@bte/rules';
import type { LoadedConfig } from './config.js';
import { resolveSources } from './sources.js';

export interface VerifyOptions {
  /** Evaluation instant override (ISO or epoch ms); else config.now, else wall clock. */
  now?: string | number | undefined;
  /** Narrow collection (adapters may use it) and, when set, filter verdicts to this correlation value. */
  correlation?: Readonly<Record<string, unknown>> | undefined;
  /** Extra records (e.g. from a Playwright run) merged with what the sources return. */
  extraRecords?: readonly EvidenceRecord[] | undefined;
}

export interface VerifyResult {
  rules: Rule[];
  records: EvidenceRecord[];
  evidence: EvidenceSet;
  verdicts: RuleVerdict[];
  evaluatedAt: number;
  failures: { source: string; error: string }[];
}

export function clockFor(loaded: LoadedConfig, now: VerifyOptions['now']): Clock {
  if (now !== undefined) return new FixedClock(now);
  if (loaded.config.now !== undefined) return new FixedClock(loaded.config.now);
  return new SystemClock();
}

export async function loadConfiguredRules(loaded: LoadedConfig): Promise<Rule[]> {
  const rules = (
    await Promise.all(
      loaded.config.rules.map((target) => loadRules(path.resolve(loaded.dir, target))),
    )
  ).flat();
  if (rules.length === 0)
    throw new Error(
      `no rules found in ${loaded.config.rules.join(', ')} (relative to ${loaded.dir})`,
    );
  return rules;
}

/** Collect from every configured source and evaluate every rule: the programmatic `bte verify`. */
export async function verify(
  loaded: LoadedConfig,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const clock = clockFor(loaded, options.now);
  const evaluatedAt = clock.now();
  const [rules, sources] = await Promise.all([loadConfiguredRules(loaded), resolveSources(loaded)]);
  const collected = await collectAll(sources, {
    now: evaluatedAt,
    correlation: options.correlation,
  });
  const records = [...collected.records, ...(options.extraRecords ?? [])];
  const evidence = EvidenceSet.from(records);
  const verdicts = evaluateRules(rules, evidence, { clock });
  return { rules, records, evidence, verdicts, evaluatedAt, failures: collected.failures };
}
