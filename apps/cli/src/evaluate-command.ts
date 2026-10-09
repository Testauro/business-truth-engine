import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceSet, FixedClock, SystemClock, evaluateRules, toIso } from '@bte/core';
import type { Clock } from '@bte/core';
import { readAllEvidence } from '@bte/evidence';
import { PostgresEvidenceStore, redactConnectionString } from '@bte/evidence-postgres';
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
  /** NDJSON files. May be empty when `postgres` is given. */
  evidence: readonly string[];
  /** PostgreSQL connection string; evidence is loaded from the store (and NDJSON files, if any). */
  postgres?: string | undefined;
  /** Store schema (default `bte`). */
  postgresSchema?: string | undefined;
  /** As-of: only store rows collected/observed at or before this instant. Defaults to `now`. */
  collectedUntil?: string | undefined;
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
  if (options.evidence.length === 0 && options.postgres === undefined) {
    throw new Error('no evidence given: pass --evidence <file...> and/or --postgres <url>');
  }
  const clock = makeClock(options.now);
  const records = await readAllEvidence(options.evidence);
  const evidenceInputs = options.evidence.map(normalizePath);
  if (options.postgres !== undefined) {
    const store = PostgresEvidenceStore.connect(options.postgres, {
      schema: options.postgresSchema,
    });
    try {
      const collectedUntil = options.collectedUntil ?? toIso(clock.now());
      records.push(...(await store.load({ collectedUntil })));
      evidenceInputs.push(
        `${redactConnectionString(options.postgres)} (schema ${store.schema}, collected until ${collectedUntil})`,
      );
    } finally {
      await store.close();
    }
  }
  const evidence = EvidenceSet.from(records);
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
      evidence: evidenceInputs,
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
