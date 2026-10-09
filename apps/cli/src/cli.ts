import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { loadRules, ruleJsonSchema } from '@bte/rules';
import type { FailOn } from './evaluate-command.js';
import { runEvaluate } from './evaluate-command.js';

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

function parseFormat(value: string): 'text' | 'json' {
  const normalized = value.toLowerCase();
  if (normalized === 'text' || normalized === 'json') return normalized;
  throw new InvalidArgumentError('expected one of: text, json');
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
    .requiredOption('-e, --evidence <file...>', 'NDJSON evidence file(s)')
    .option(
      '--now <iso>',
      'evaluation instant (defaults to wall clock; pass for reproducible output)',
      parseIso,
    )
    .option('-f, --format <format>', 'text | json', parseFormat, 'text')
    .option('-o, --output <file>', 'also write the JSON report to this file')
    .option(
      '--fail-on <verdict>',
      'exit 1 when any verdict is at least this bad: fail | unknown | pending',
      parseFailOn,
      'fail',
    )
    .action(
      async (options: {
        rules: string[];
        evidence: string[];
        now?: string;
        format: 'text' | 'json';
        output?: string;
        failOn: FailOn;
      }) => {
        if (options.now === undefined) {
          io.stderr('warning: --now not given; using the wall clock, output is not reproducible\n');
        }
        const result = await runEvaluate({
          rules: options.rules,
          evidence: options.evidence,
          now: options.now,
          format: options.format,
          output: options.output,
          failOn: options.failOn,
        });
        io.stdout(result.rendered);
        state.exitCode = result.exitCode;
      },
    );

  program
    .command('validate')
    .description('Validate rule files without evaluating anything.')
    .requiredOption('-r, --rules <path...>', 'rule file(s) or directories')
    .action(async (options: { rules: string[] }) => {
      const rules = (await Promise.all(options.rules.map((target) => loadRules(target)))).flat();
      for (const rule of rules) {
        io.stdout(
          `ok  ${rule.id}@v${rule.version}  trigger=${rule.trigger.type}  expectations=${rule.expectations.length}\n`,
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

/** Run the CLI; returns the process exit code instead of exiting. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const state: CliState = { exitCode: 0 };
  const program = buildProgram(io, state);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
