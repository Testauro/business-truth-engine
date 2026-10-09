import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceSet, FixedClock, SystemClock, evaluateRules, toIso } from '@bte/core';
import type { Clock, Verdict } from '@bte/core';
import { readAllEvidence } from '@bte/evidence';
import { loadRules } from '@bte/rules';
import type { EvaluationReport } from './report.js';
import { REPORT_SCHEMA_VERSION, renderJson, renderText, summarize } from './report.js';

export type FailOn = 'fail' | 'unknown' | 'pending';

export interface EvaluateCommandOptions {
  rules: readonly string[];
  evidence: readonly string[];
  now?: string | undefined;
  format: 'text' | 'json';
  output?: string | undefined;
  failOn: FailOn;
}

export interface EvaluateCommandResult {
  report: EvaluationReport;
  rendered: string;
  exitCode: number;
}

const GATE: Readonly<Record<FailOn, readonly Verdict[]>> = {
  fail: ['FAIL'],
  unknown: ['FAIL', 'UNKNOWN'],
  pending: ['FAIL', 'UNKNOWN', 'PENDING'],
};

export function makeClock(now: string | undefined): Clock {
  return now === undefined ? new SystemClock() : new FixedClock(now);
}

export async function runEvaluate(options: EvaluateCommandOptions): Promise<EvaluateCommandResult> {
  const rules = (await Promise.all(options.rules.map((target) => loadRules(target)))).flat();
  if (rules.length === 0) throw new Error(`no rules found in ${options.rules.join(', ')}`);
  const records = await readAllEvidence(options.evidence);
  const evidence = EvidenceSet.from(records);
  const clock = makeClock(options.now);
  const verdicts = evaluateRules(rules, evidence, { clock });
  const report: EvaluationReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generator: 'bte-cli/0.1.0',
    evaluatedAt: toIso(clock.now()),
    inputs: {
      rules: options.rules.map(normalizePath),
      evidence: options.evidence.map(normalizePath),
      eventCount: evidence.size,
      sourceCount: evidence.sources.length,
    },
    summary: summarize(verdicts),
    verdicts,
  };
  const rendered = options.format === 'json' ? renderJson(report) : renderText(report);
  if (options.output !== undefined) {
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, renderJson(report), 'utf8');
  }
  const gated = GATE[options.failOn];
  const exitCode = verdicts.some((verdict) => gated.includes(verdict.verdict)) ? 1 : 0;
  return { report, rendered, exitCode };
}

function normalizePath(target: string): string {
  return path.relative(process.cwd(), path.resolve(target)).split(path.sep).join('/') || '.';
}
