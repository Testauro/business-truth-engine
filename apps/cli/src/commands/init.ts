import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface InitOptions {
  cwd: string;
  /** Overwrite existing files. */
  force?: boolean | undefined;
  /** Logical name of the first evidence source. */
  source?: string | undefined;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

const CONFIG_TEMPLATE = (source: string): string => `import { defineConfig } from '@bte/sdk';

/**
 * Business Truth Engine configuration.
 * - rules: YAML (or TypeScript via defineRule) business invariants, relative to this file.
 * - sources: where evidence comes from. Secrets stay in the environment: \${VAR} is resolved at
 *   load time from the process environment or a git-ignored .env file next to this file.
 * Validate with \`bte rules validate\`, run with \`bte verify\`, inspect one verdict with \`bte explain\`.
 */
export default defineConfig({
  rules: ['bte/rules'],
  sources: [
    {
      type: 'http',
      name: '${source}',
      baseUrl: '\${APP_BASE_URL}',
      auth: { type: 'bearer', token: '\${APP_API_TOKEN}' },
      // 'snapshot' means a successful read reflects current state (absence can be proven);
      // use 'none' for feeds that cannot promise completeness.
      completeness: 'snapshot',
      requests: [
        {
          url: 'api/things', // relative to baseUrl; \${correlation.key} placeholders are allowed
          mapping: {
            type: 'thing.created', // event type referred to by rules
            items: 'data', // path to the array in the response (omit if the body is the array)
            eventId: { template: 'thing:\${id}' },
            occurredAt: 'createdAt', // ISO-8601 or epoch millis
            payload: { thingId: 'id', amount: 'amount' },
          },
        },
      ],
    },
  ],
  gate: { failOn: 'fail' }, // fail | unknown | pending
  report: { dir: 'bte-report' },
});
`;

const RULE_TEMPLATE = (
  source: string,
): string => `# Example business invariant. Replace with your own; keep the id stable and bump version on change.
id: thing-processed-once
version: 1
description: Every created thing is processed exactly once within 2 minutes.
trigger:
  type: thing.created
  source: ${source}
  correlationKey: thingId
expectations:
  - id: processed
    type: thing.processed
    source: ${source}
    window:
      within: 120s
    cardinality: exactly-one
    assertions:
      - field: amount
        op: equals
        expected: { trigger: amount }
`;

const ENV_TEMPLATE = `# Copy to .env (git-ignored) or set in CI. Referenced from bte.config.ts as \${VAR}.
APP_BASE_URL=http://127.0.0.1:3000
APP_API_TOKEN=replace-me
`;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Scaffold bte.config.ts, bte/rules/example.yaml and .env.example without touching anything else. */
export async function runInit(options: InitOptions): Promise<InitResult> {
  const source = options.source ?? 'app';
  const files: [string, string][] = [
    ['bte.config.ts', CONFIG_TEMPLATE(source)],
    [path.join('bte', 'rules', 'thing-processed-once.yaml'), RULE_TEMPLATE(source)],
    ['.env.example', ENV_TEMPLATE],
  ];
  const result: InitResult = { written: [], skipped: [] };
  for (const [relative, body] of files) {
    const file = path.join(options.cwd, relative);
    if (!options.force && (await exists(file))) {
      result.skipped.push(relative);
      continue;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, 'utf8');
    result.written.push(relative);
  }
  // Keep secrets out of git: make sure .env is ignored if a .gitignore exists.
  const gitignore = path.join(options.cwd, '.gitignore');
  if (await exists(gitignore)) {
    const text = await readFile(gitignore, 'utf8');
    if (!/^\.env$/m.test(text)) {
      await writeFile(
        gitignore,
        `${text.endsWith('\n') || text === '' ? text : `${text}\n`}.env\n`,
        'utf8',
      );
      result.written.push('.gitignore (+ .env)');
    }
  }
  return result;
}
