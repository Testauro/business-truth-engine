import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { readAllEvidence } from '@bte/evidence';
import { PostgresEvidenceStore, redactConnectionString } from '@bte/evidence-postgres';
import { loadRules, ruleJsonSchema } from '@bte/rules';
import { ConfigError } from '@bte/sdk';
import { runExplain } from './commands/explain.js';
import { runInit } from './commands/init.js';
import { runVerify } from './commands/verify.js';
import type { OutputFormat } from './evaluate-command.js';
import { runEvaluate } from './evaluate-command.js';
import type { FailOn } from './report.js';
import { EXIT_ERROR, EXIT_OK } from './report.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function parseFailOn(value: string): FailOn {
  const normalized = value.toLowerCase();
  if (normalized === 'fail' || normalized === 'unknown' || normalized === 'pending')
    return normalized;
  throw new InvalidArgumentError('expected one of: fail, unknown, pending');
}

function parseFormat(value: string): OutputFormat {
  const normalized = value.toLowerCase();
  if (normalized === 'text' || normalized === 'json' || normalized === 'markdown')
    return normalized;
  throw new InvalidArgumentError('expected one of: text, json, markdown');
}

function parseIso(value: string): string {
  if (Number.isNaN(Date.parse(value)))
    throw new InvalidArgumentError('expected an ISO-8601 timestamp');
  return new Date(value).toISOString();
}

export interface CliState {
  exitCode: number;
}

export function buildProgram(io: CliIo, state: CliState = { exitCode: 0 }): Command {
  const program = new Command('bte')
    .description('Business Truth Engine: verify business invariants against collected evidence.')
    .version('0.1.0')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command('evaluate')
    .description('Evaluate rules against NDJSON evidence and emit verdicts.')
    .requiredOption('-r, --rules <path...>', 'rule file(s) or directories')
    .option('-e, --evidence <file...>', 'NDJSON evidence file(s)')
    .option('--postgres <url>', 'load evidence from a PostgreSQL store (see `bte ingest`)')
    .option('--postgres-schema <name>', 'store schema', 'bte')
    .option(
      '--collected-until <iso>',
      'as-of: only store rows collected at or before this instant (default: --now)',
      parseIso,
    )
    .option(
      '--now <iso>',
      'evaluation instant (defaults to wall clock; pass for reproducible output)',
      parseIso,
    )
    .option('-f, --format <format>', 'stdout format: text | json | markdown', parseFormat, 'text')
    .option('-o, --output <file>', 'write the JSON report to this file')
    .option('--junit <file>', 'write a JUnit XML report to this file')
    .option(
      '--markdown <file>',
      'write a Markdown report to this file (e.g. for $GITHUB_STEP_SUMMARY)',
    )
    .option(
      '--fail-on <verdict>',
      'exit 1 when any verdict is at least this bad: fail | unknown | pending',
      parseFailOn,
      'fail',
    )
    .action(
      async (options: {
        rules: string[];
        evidence?: string[];
        postgres?: string;
        postgresSchema: string;
        collectedUntil?: string;
        now?: string;
        format: OutputFormat;
        output?: string;
        junit?: string;
        markdown?: string;
        failOn: FailOn;
      }) => {
        if (options.now === undefined) {
          io.stderr('warning: --now not given; using the wall clock, output is not reproducible\n');
        }
        const result = await runEvaluate({
          rules: options.rules,
          evidence: options.evidence ?? [],
          postgres: options.postgres,
          postgresSchema: options.postgresSchema,
          collectedUntil: options.collectedUntil,
          now: options.now,
          format: options.format,
          output: options.output,
          junit: options.junit,
          markdown: options.markdown,
          failOn: options.failOn,
        });
        io.stdout(result.rendered);
        for (const file of result.written) io.stderr(`wrote ${file}\n`);
        state.exitCode = result.exitCode;
      },
    );

  program
    .command('init')
    .description(
      'Scaffold bte.config.ts, an example rule and .env.example in the current project (never overwrites unless --force).',
    )
    .option('--source <name>', 'logical name of the first evidence source', 'app')
    .option('--force', 'overwrite existing files', false)
    .option('--cwd <dir>', 'project directory', process.cwd())
    .action(async (options: { source: string; force: boolean; cwd: string }) => {
      const result = await runInit({
        cwd: options.cwd,
        force: options.force,
        source: options.source,
      });
      for (const file of result.written) io.stdout(`created ${file}\n`);
      for (const file of result.skipped)
        io.stdout(`kept    ${file} (exists; use --force to overwrite)\n`);
      io.stdout(
        'next: edit bte.config.ts and bte/rules/*.yaml, copy .env.example to .env, then `bte rules validate` and `bte verify`\n',
      );
    });

  program
    .command('verify')
    .description(
      'Collect evidence from the sources in bte.config.* and evaluate every rule; writes json/junit/markdown reports.',
    )
    .option('-c, --config <file>', 'config file (default: bte.config.* in --cwd)')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('--now <iso>', 'evaluation instant (default: config.now or wall clock)', parseIso)
    .option(
      '--correlation <key=value...>',
      'narrow collection and output to a business transaction, e.g. orderId=ord_1',
    )
    .option('-f, --format <format>', 'stdout format: text | json | markdown', parseFormat, 'text')
    .option(
      '--fail-on <verdict>',
      'override the configured gate: fail | unknown | pending',
      parseFailOn,
    )
    .option('--no-reports', 'do not write report files')
    .action(
      async (options: {
        config?: string;
        cwd: string;
        now?: string;
        correlation?: string[];
        format: OutputFormat;
        failOn?: FailOn;
        reports: boolean;
      }) => {
        const correlation =
          options.correlation === undefined
            ? undefined
            : Object.fromEntries(
                options.correlation.map((pair) => {
                  const eq = pair.indexOf('=');
                  if (eq <= 0)
                    throw new InvalidArgumentError(
                      `--correlation expects key=value, got "${pair}"`,
                    );
                  return [pair.slice(0, eq), pair.slice(eq + 1)];
                }),
              );
        const result = await runVerify({
          config: { cwd: options.cwd, file: options.config },
          now: options.now,
          correlation,
          format: options.format,
          failOn: options.failOn,
          reports: options.reports,
        });
        io.stdout(result.rendered);
        for (const failure of result.failures)
          io.stderr(`warning: source "${failure.source}" unavailable: ${failure.error}\n`);
        for (const file of result.written) io.stderr(`wrote ${file}\n`);
        state.exitCode = result.exitCode;
      },
    );

  program
    .command('explain')
    .description('Evaluate and explain one verdict: `bte explain <ruleId> <correlationValue>`.')
    .argument('<ruleId>', 'rule id')
    .argument('<correlation>', 'correlation value, e.g. ord_1001')
    .option('-c, --config <file>', 'config file (default: bte.config.* in --cwd)')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('--now <iso>', 'evaluation instant', parseIso)
    .action(
      async (
        ruleId: string,
        correlation: string,
        options: { config?: string; cwd: string; now?: string },
      ) => {
        const result = await runExplain({
          config: { cwd: options.cwd, file: options.config },
          ruleId,
          correlation,
          now: options.now,
        });
        io.stdout(result.text);
        if (result.verdict === undefined) state.exitCode = EXIT_ERROR;
        else if (result.verdict.verdict === 'FAIL') state.exitCode = 1;
      },
    );

  const rules = program.command('rules').description('Rule tooling.');
  rules
    .command('validate')
    .description('Validate rule files (or the rules configured in bte.config.*).')
    .option('-r, --rules <path...>', 'rule file(s) or directories; default: from bte.config.*')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .action(async (options: { rules?: string[]; cwd: string }) => {
      let targets = options.rules;
      if (targets === undefined) {
        const { loadBteConfig } = await import('@bte/sdk');
        const loaded = await loadBteConfig({ cwd: options.cwd });
        const path = await import('node:path');
        targets = loaded.config.rules.map((r) => path.resolve(loaded.dir, r));
      }
      const loadedRules = (await Promise.all(targets.map((target) => loadRules(target)))).flat();
      for (const rule of loadedRules) {
        io.stdout(
          `ok  ${rule.id}@v${rule.version}  trigger=${Array.isArray(rule.trigger.type) ? rule.trigger.type.join('|') : rule.trigger.type}  expectations=${rule.expectations.length}\n`,
        );
      }
      io.stdout(`${loadedRules.length} rule(s) valid\n`);
    });

  program
    .command('ingest')
    .description(
      'Append NDJSON evidence to a PostgreSQL store (creates the schema if needed). Idempotent.',
    )
    .requiredOption('--postgres <url>', 'PostgreSQL connection string')
    .option('--postgres-schema <name>', 'store schema', 'bte')
    .requiredOption('-e, --evidence <file...>', 'NDJSON evidence file(s)')
    .action(async (options: { postgres: string; postgresSchema: string; evidence: string[] }) => {
      const store = PostgresEvidenceStore.connect(options.postgres, {
        schema: options.postgresSchema,
      });
      try {
        await store.migrate();
        const records = await readAllEvidence(options.evidence);
        const result = await store.appendAll(records);
        const counts = await store.counts();
        io.stdout(
          `ingested ${records.length} record(s) into ${redactConnectionString(options.postgres)} schema ${store.schema}: events +${result.events.inserted} (${result.events.duplicates} already present), sources +${result.sources.inserted} (${result.sources.duplicates} already present); store now holds ${counts.events} events, ${counts.sources} attestations\n`,
        );
      } finally {
        await store.close();
      }
    });

  program
    .command('validate')
    .description('Validate rule files without evaluating anything.')
    .requiredOption('-r, --rules <path...>', 'rule file(s) or directories')
    .action(async (options: { rules: string[] }) => {
      const rules = (await Promise.all(options.rules.map((target) => loadRules(target)))).flat();
      for (const rule of rules) {
        io.stdout(
          `ok  ${rule.id}@v${rule.version}  trigger=${Array.isArray(rule.trigger.type) ? rule.trigger.type.join('|') : rule.trigger.type}  expectations=${rule.expectations.length}\n`,
        );
      }
      io.stdout(`${rules.length} rule(s) valid\n`);
    });

  program
    .command('schema')
    .description('Print the JSON Schema for rule documents.')
    .action(() => {
      io.stdout(`${JSON.stringify(ruleJsonSchema(), null, 2)}\n`);
    });

  return program;
}

/**
 * Run the CLI; returns the process exit code instead of exiting.
 * 0 = gate passed, 1 = gate failed, 2 = could not evaluate (usage, rules or evidence errors).
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const state: CliState = { exitCode: EXIT_OK };
  const program = buildProgram(io, state);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help / --version exit 0; every usage error is an "could not evaluate" error.
      return error.exitCode === 0 ? EXIT_OK : EXIT_ERROR;
    }
    if (error instanceof ConfigError) {
      io.stderr(`error: ${error.message}\n`);
      return EXIT_ERROR;
    }
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_ERROR;
  }
}
