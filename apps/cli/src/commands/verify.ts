import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvidenceSet, toIso } from '@bte/core';
import type { RuleVerdict } from '@bte/core';
import { loadBteConfig, verify } from '@bte/sdk';
import type { LoadConfigOptions } from '@bte/sdk';
import type { OutputFormat } from '../evaluate-command.js';
import { render } from '../evaluate-command.js';
import type { EvaluationReport, FailOn } from '../report.js';
import {
  EXIT_GATE_FAILED,
  EXIT_OK,
  GATE,
  REPORT_SCHEMA_VERSION,
  indexEvidence,
  renderJson,
  renderJunit,
  renderMarkdown,
  summarize,
} from '../report.js';

export interface VerifyCommandOptions {
  config: LoadConfigOptions;
  now?: string | undefined;
  /** key=value pairs narrowing collection and, when given, the reported verdicts. */
  correlation?: Readonly<Record<string, string>> | undefined;
  format: OutputFormat;
  failOn?: FailOn | undefined;
  /** Write json/junit/markdown reports into the configured report dir. */
  reports?: boolean | undefined;
}

export interface VerifyCommandResult {
  report: EvaluationReport;
  rendered: string;
  exitCode: number;
  written: string[];
  failures: { source: string; error: string }[];
}

/** Config-driven verification: collect from every configured source, evaluate every rule, report. */
export async function runVerify(options: VerifyCommandOptions): Promise<VerifyCommandResult> {
  const loaded = await loadBteConfig(options.config);
  const result = await verify(loaded, { now: options.now, correlation: options.correlation });
  const failOn = options.failOn ?? loaded.config.gate.failOn;
  const failingVerdicts = GATE[failOn];
  let verdicts: RuleVerdict[] = result.verdicts;
  if (options.correlation !== undefined) {
    const wanted = new Set(Object.values(options.correlation).map((v) => JSON.stringify(v)));
    verdicts = verdicts.filter((v) => wanted.has(v.correlationValue));
  }
  const failed = verdicts
    .filter((v) => failingVerdicts.includes(v.verdict))
    .map((v) => ({ ruleId: v.ruleId, correlationValue: v.correlationValue, verdict: v.verdict }));
  const exitCode = failed.length > 0 ? EXIT_GATE_FAILED : EXIT_OK;
  const evidence = EvidenceSet.from(result.records);
  const report: EvaluationReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generator: 'bte-cli/0.1.0',
    evaluatedAt: toIso(result.evaluatedAt),
    inputs: {
      rules: loaded.config.rules,
      evidence: loaded.config.sources.map(
        (s) => `${s.type}:${'name' in s && s.name !== undefined ? s.name : '?'}`,
      ),
      eventCount: evidence.size,
      sourceCount: evidence.sources.length,
    },
    gate: { failOn, failingVerdicts, failed },
    exitCode,
    summary: summarize(verdicts),
    verdicts,
    evidence: indexEvidence(verdicts, evidence),
  };
  const written: string[] = [];
  if (options.reports !== false) {
    const dir = path.resolve(loaded.dir, loaded.config.report.dir);
    await mkdir(dir, { recursive: true });
    for (const [name, body] of [
      ['bte.json', renderJson(report)],
      ['bte.junit.xml', renderJunit(report)],
      ['bte.md', renderMarkdown(report)],
    ] as const) {
      const file = path.join(dir, name);
      await writeFile(file, body, 'utf8');
      written.push(file);
    }
  }
  return {
    report,
    rendered: render(report, options.format),
    exitCode,
    written,
    failures: result.failures,
  };
}
