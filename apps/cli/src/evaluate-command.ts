import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceSet, FixedClock, SystemClock, evaluateRules, toIso } from '@bte/core';
import type { Clock } from '@bte/core';
import { readAllEvidence } from '@bte/evidence';
import { loadRules } from '@bte/rules';
import type { EvaluationReport, FailOn } from './report.js';
import {
  EXIT_GATE_FAILED,
  EXIT_OK,
  GATE,
  REPORT_SCHEMA_VERSION,
  indexEvidence,
  renderJson,
  renderJunit,
  renderMarkdown,
  renderText,
  summarize,
} from './report.js';

export type OutputFormat = 'text' | 'json' | 'markdown';

export interface EvaluateCommandOptions {
  rules: readonly string[];
  evidence: readonly string[];
  now?: string | undefined;
  format: OutputFormat;
  /** JSON report file. */
  output?: string | undefined;
  /** JUnit XML report file. */
  junit?: string | undefined;
  /** Markdown report file (e.g. appended to $GITHUB_STEP_SUMMARY). */
  markdown?: string | undefined;
  failOn: FailOn;
}

export interface EvaluateCommandResult {
  report: EvaluationReport;
  rendered: string;
  exitCode: number;
  /** Files written, in order. */
  written: readonly string[];
}

export function makeClock(now: string | undefined): Clock {
  return now === undefined ? new SystemClock() : new FixedClock(now);
}

export function render(report: EvaluationReport, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return renderJson(report);
    case 'markdown':
      return renderMarkdown(report);
    case 'text':
      return renderText(report);
  }
}

export async function runEvaluate(options: EvaluateCommandOptions): Promise<EvaluateCommandResult> {
  const rules = (await Promise.all(options.rules.map((target) => loadRules(target)))).flat();
  if (rules.length === 0) throw new Error(`no rules found in ${options.rules.join(', ')}`);
  const records = await readAllEvidence(options.evidence);
  const evidence = EvidenceSet.from(records);
  const clock = makeClock(options.now);
  const verdicts = evaluateRules(rules, evidence, { clock });
  const failingVerdicts = GATE[options.failOn];
  const failed = verdicts
    .filter((verdict) => failingVerdicts.includes(verdict.verdict))
    .map((verdict) => ({
      ruleId: verdict.ruleId,
      correlationValue: verdict.correlationValue,
      verdict: verdict.verdict,
    }));
  const exitCode = failed.length > 0 ? EXIT_GATE_FAILED : EXIT_OK;
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
    gate: { failOn: options.failOn, failingVerdicts, failed },
    exitCode,
    summary: summarize(verdicts),
    verdicts,
    evidence: indexEvidence(verdicts, evidence),
  };
  const written: string[] = [];
  const outputs: [string | undefined, string][] = [
    [options.output, renderJson(report)],
    [options.junit, renderJunit(report)],
    [options.markdown, renderMarkdown(report)],
  ];
  for (const [file, body] of outputs) {
    if (file === undefined) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
    written.push(file);
  }
  return { report, rendered: render(report, options.format), exitCode, written };
}

function normalizePath(target: string): string {
  return path.relative(process.cwd(), path.resolve(target)).split(path.sep).join('/') || '.';
}
