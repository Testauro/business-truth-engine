import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rules = path.join(repoRoot, 'rules');
const fixture = (name: string): string =>
  path.join(repoRoot, 'examples', 'fixtures', `${name}.ndjson`);

async function invoke(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runCli(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe('bte CLI', () => {
  it('evaluate renders text verdicts and exits 1 on FAIL', async () => {
    const { code, out, err } = await invoke([
      'evaluate',
      '--rules',
      rules,
      '--evidence',
      fixture('duplicate-invoice'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(1);
    expect(err).toBe('');
    expect(out).toContain('FAIL    invoice-created-once@v1  orderId="ord_1001"');
    expect(out).toContain('DUPLICATE_OUTCOME');
    expect(out).toContain('summary: PASS=0 FAIL=1 PENDING=0 UNKNOWN=0');
  });

  it('evaluate --format json writes a report file and exits 0 on PASS', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-cli-'));
    const output = path.join(dir, 'nested', 'report.json');
    const { code, out } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('normal'),
      '--now',
      '2026-01-15T10:03:00Z',
      '-f',
      'json',
      '-o',
      output,
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(out) as { schemaVersion: number; summary: Record<string, number> };
    expect(report.schemaVersion).toBe(2);
    expect(report.summary).toEqual({ PASS: 1, FAIL: 0, PENDING: 0, UNKNOWN: 0 });
    expect(await readFile(output, 'utf8')).toBe(out);
  });

  it('warns when --now is omitted', async () => {
    const { code, err } = await invoke(['evaluate', '-r', rules, '-e', fixture('normal')]);
    expect(code).toBe(0);
    expect(err).toContain('--now not given');
  });

  it('rejects bad option values with exit code 2 and no stack trace', async () => {
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('normal'),
      '--now',
      'yesterday',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('ISO-8601');
    const bad = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('normal'),
      '--fail-on',
      'always',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('fail, unknown, pending');
  });

  it('returns 2 for runtime errors such as a missing evidence file', async () => {
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('does-not-exist'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(2);
    expect(err).toMatch(/^error: /);
  });

  it('validate lists rules; schema prints JSON schema', async () => {
    const valid = await invoke(['validate', '-r', rules]);
    expect(valid.code).toBe(0);
    expect(valid.out).toContain('ok  invoice-created-once@v1');
    const schema = await invoke(['schema']);
    expect(schema.code).toBe(0);
    expect(JSON.parse(schema.out)).toHaveProperty('type', 'object');
  });

  it('--help exits 0', async () => {
    const { code, out } = await invoke(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('evaluate');
  });
});
