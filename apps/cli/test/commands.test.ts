import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function invoke(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runCli(args, {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
  });
  return { code, out, err };
}

describe('bte init', () => {
  it('scaffolds config, an example rule and .env.example, never overwriting without --force, and git-ignores .env', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-init-'));
    await writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    const first = await invoke(['init', '--cwd', dir, '--source', 'lms']);
    expect(first.code).toBe(0);
    expect(first.out).toContain('created bte.config.ts');
    expect(first.out).toContain('created bte/rules/thing-processed-once.yaml');
    expect(first.out).toContain('created .gitignore (+ .env)');
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.env\n');
    expect(await readFile(path.join(dir, 'bte.config.ts'), 'utf8')).toContain("name: 'lms'");
    const second = await invoke(['init', '--cwd', dir]);
    expect(second.out).toContain('kept    bte.config.ts (exists; use --force to overwrite)');
    // The scaffolded rule validates as-is.
    const validate = await invoke(['rules', 'validate', '-r', path.join(dir, 'bte', 'rules')]);
    expect(validate.code).toBe(0);
    expect(validate.out).toContain('ok  thing-processed-once@v1  trigger=thing.created');
  });
});

describe('bte rules validate never needs source secrets', () => {
  it('validates the configured rules even when the config references unset environment variables', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-rules-'));
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: [path.join(repoRoot, 'rules')],
        sources: [
          {
            type: 'http',
            name: 'a',
            baseUrl: '${SECRET_URL_NOT_SET}',
            requests: [
              { url: 'x', mapping: { type: 't', eventId: 'id', occurredAt: 'at', payload: {} } },
            ],
          },
        ],
      }),
    );
    const { code, out, err } = await invoke(['rules', 'validate', '--cwd', dir]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('ok  invoice-created-once@v1');
    await writeFile(path.join(dir, 'bte.config.json'), JSON.stringify({ rules: [], sources: [] }));
    const bad = await invoke(['rules', 'validate', '--cwd', dir]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('"rules" must be a non-empty array of paths');
  });
});

describe('bte verify / explain (config-driven)', () => {
  async function project(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-verify-'));
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: [path.join(repoRoot, 'rules')],
        now: '2026-01-15T10:03:00Z',
        gate: { failOn: 'fail' },
        report: { dir: 'out' },
        sources: [
          {
            type: 'ndjson',
            name: 'fixtures',
            files: [path.join(repoRoot, 'examples', 'fixtures', 'mixed-orders.ndjson')],
          },
        ],
      }),
    );
    return dir;
  }

  it('verify collects, evaluates, gates and writes reports into the configured directory', async () => {
    const dir = await project();
    const { code, out, err } = await invoke(['verify', '--cwd', dir]);
    expect(code).toBe(1);
    expect(out).toContain('FAIL    invoice-created-once@v1  orderId="ord_1001"');
    expect(out).toContain('PASS    invoice-created-once@v1  orderId="ord_2002"');
    expect(err).toContain(path.join(dir, 'out', 'bte.junit.xml'));
    const json = JSON.parse(await readFile(path.join(dir, 'out', 'bte.json'), 'utf8')) as {
      inputs: { evidence: string[] };
      summary: Record<string, number>;
    };
    expect(json.inputs.evidence).toEqual(['ndjson:fixtures']);
    expect(json.summary).toEqual({ PASS: 1, FAIL: 1, PENDING: 0, UNKNOWN: 0 });
  });

  it('verify --correlation narrows the output; --fail-on overrides the config gate; --no-reports writes nothing', async () => {
    const dir = await project();
    const narrowed = await invoke([
      'verify',
      '--cwd',
      dir,
      '--correlation',
      'orderId=ord_2002',
      '--no-reports',
      '-f',
      'json',
    ]);
    expect(narrowed.code).toBe(0);
    const report = JSON.parse(narrowed.out) as { verdicts: { correlationValue: string }[] };
    expect(report.verdicts.map((v) => v.correlationValue)).toEqual(['"ord_2002"']);
    expect(narrowed.err).toBe('');
    const pending = await invoke([
      'verify',
      '--cwd',
      dir,
      '--now',
      '2026-01-15T10:01:00Z',
      '--fail-on',
      'pending',
      '--no-reports',
    ]);
    expect(pending.code).toBe(1);
  });

  it('verify reports an unavailable source as a warning and UNKNOWN, never as success', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-verify-'));
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: [path.join(repoRoot, 'rules')],
        now: '2026-01-15T10:03:00Z',
        sources: [
          {
            type: 'ndjson',
            name: 'orders',
            files: [path.join(repoRoot, 'examples', 'fixtures', 'missing-invoice.ndjson')],
          },
          {
            type: 'http',
            name: 'invoicing-live',
            baseUrl: 'http://127.0.0.1:9',
            timeoutMs: 300,
            requests: [
              {
                url: 'x',
                mapping: {
                  type: 'invoice.created',
                  eventId: 'id',
                  occurredAt: 'at',
                  payload: { orderId: 'orderId' },
                },
              },
            ],
          },
        ],
      }),
    );
    const { code, err } = await invoke(['verify', '--cwd', dir, '--no-reports']);
    expect(err).toContain('warning: source "invoicing-live" unavailable');
    expect(code).toBe(1); // the fixture's own complete invoicing attestation proves the invoice missing
  });

  it('explain prints the full decision for one verdict and exits 1 on FAIL, 2 when nothing matches', async () => {
    const dir = await project();
    const fail = await invoke(['explain', 'invoice-created-once', 'ord_1001', '--cwd', dir]);
    expect(fail.code).toBe(1);
    expect(fail.out).toContain('FAIL  invoice-created-once@v1  orderId="ord_1001"');
    expect(fail.out).toContain('expectation invoice (invoice.created from invoicing): FAIL');
    expect(fail.out).toContain('- MISSING_EXPECTED_OUTCOME');
    const pass = await invoke(['explain', 'invoice-created-once', 'ord_2002', '--cwd', dir]);
    expect(pass.code).toBe(0);
    expect(pass.out).toContain('observation evt-inv-6001-created: in-window');
    const none = await invoke(['explain', 'invoice-created-once', 'ord_9999', '--cwd', dir]);
    expect(none.code).toBe(2);
    expect(none.out).toContain('known correlations: "ord_1001", "ord_2002"');
    const badRule = await invoke(['explain', 'nope', 'x', '--cwd', dir]);
    expect(badRule.code).toBe(2);
    expect(badRule.out).toContain('unknown rule "nope"; configured rules: invoice-created-once');
  });

  it('reports configuration errors with exit 2 and the precise issue', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-cfg-'));
    const missing = await invoke(['verify', '--cwd', dir]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('no BTE configuration found');
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: ['r'],
        sources: [
          {
            type: 'http',
            name: 'a',
            baseUrl: '${NOT_SET_ANYWHERE}',
            requests: [
              { url: 'x', mapping: { type: 't', eventId: 'id', occurredAt: 'at', payload: {} } },
            ],
          },
        ],
      }),
    );
    const env = await invoke(['verify', '--cwd', dir]);
    expect(env.code).toBe(2);
    expect(env.err).toContain(
      'NOT_SET_ANYWHERE (set it in the environment or in a git-ignored .env file)',
    );
  });
});

describe('bte explain renders chains, aggregates and trigger-source assessments', () => {
  it('chain fixture', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-explain-'));
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: [path.join(repoRoot, 'examples', 'rules', 'ledger-posting-per-invoice.yaml')],
        now: '2026-04-01T08:15:00Z',
        sources: [
          {
            type: 'ndjson',
            name: 'f',
            files: [path.join(repoRoot, 'examples', 'fixtures', 'chain', 'posted-once.ndjson')],
          },
        ],
      }),
    );
    const { code, out } = await invoke([
      'explain',
      'ledger-posting-per-invoice',
      'ord_4001',
      '--cwd',
      dir,
    ]);
    expect(code).toBe(0);
    expect(out).toContain('trigger source orders: trusted');
    expect(out).toContain(
      'correlation: orderId -> invoice.created[1] -> invoiceId; keys "inv_7001"',
    );
    expect(out).toContain('observation evt-post-9001: in-window');
  });

  it('aggregate fixture', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-explain-'));
    await writeFile(
      path.join(dir, 'bte.config.json'),
      JSON.stringify({
        rules: [path.join(repoRoot, 'examples', 'rules', 'refunds-within-payment.yaml')],
        now: '2026-03-05T00:00:00Z',
        sources: [
          {
            type: 'ndjson',
            name: 'f',
            files: [
              path.join(repoRoot, 'examples', 'fixtures', 'aggregates', 'refunds-exceed.ndjson'),
            ],
          },
        ],
      }),
    );
    const { code, out } = await invoke([
      'explain',
      'refunds-within-payment',
      'ord_3001',
      '--cwd',
      dir,
    ]);
    expect(code).toBe(1);
    expect(out).toContain('aggregate sum(amount) lte: fail = 85.5');
  });
});
