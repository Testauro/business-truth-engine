import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rules = path.join(repoRoot, 'rules');
const invalid = (name: string): string =>
  path.join(repoRoot, 'examples', 'fixtures', 'invalid', name);
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

/**
 * Failure scenarios for the CLI contract: every "could not evaluate" condition
 * must exit 2 with a precise message, never produce a verdict, and never be
 * mistaken for a passing gate.
 */
describe('CLI failure scenarios', () => {
  it('malformed evidence line: exit 2 with file and line number, no verdicts', async () => {
    const { code, out, err } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      invalid('bad-evidence.ndjson'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toMatch(/^error: .*bad-evidence\.ndjson:3: invalid JSON/);
  });

  it('evidence violating the contract: exit 2 naming the offending field', async () => {
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('normal'),
      '-e',
      invalid('bad-evidence.ndjson'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('bad-evidence.ndjson:3');
  });

  it('invalid rule file: exit 2 listing every schema issue', async () => {
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      invalid('bad-rule.yaml'),
      '-e',
      fixture('normal'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('rule does not match the schema');
    expect(err).toContain('expectations.0.window.within');
    expect(err).toContain('expectations.0.cardinality');
    const validate = await invoke(['validate', '-r', invalid('bad-rule.yaml')]);
    expect(validate.code).toBe(2);
  });

  it('rules directory without rules: exit 2', async () => {
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      path.join(repoRoot, 'docs'),
      '-e',
      fixture('normal'),
      '--now',
      '2026-01-15T10:03:00Z',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('no rules found');
  });

  it('missing required options: exit 2 with usage text on stderr', async () => {
    const { code, err } = await invoke(['evaluate', '-e', fixture('normal')]);
    expect(code).toBe(2);
    expect(err).toContain("required option '-r, --rules <path...>' not specified");
    const unknownCommand = await invoke(['frobnicate']);
    expect(unknownCommand.code).toBe(2);
  });

  it('evidence with no trigger events: exit 0, zero verdicts, markdown says nothing was evaluated', async () => {
    const dir = path.join(repoRoot, 'examples', 'fixtures');
    const { code, out } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      path.join(dir, 'invalid', 'README.md'),
      '--now',
      '2026-01-15T10:03:00Z',
      '-f',
      'markdown',
    ]);
    // README.md lines are not JSON, so this must fail as evidence, not pass silently.
    expect(code).toBe(2);
    expect(out).toBe('');
  });

  it('gate escalation: UNKNOWN exits 0 by default, 1 with --fail-on unknown; PENDING only with --fail-on pending', async () => {
    const base = ['evaluate', '-r', rules, '--now', '2026-01-15T10:03:00Z'];
    expect((await invoke([...base, '-e', fixture('unavailable-source')])).code).toBe(0);
    expect(
      (await invoke([...base, '-e', fixture('unavailable-source'), '--fail-on', 'unknown'])).code,
    ).toBe(1);
    expect(
      (await invoke([...base, '-e', fixture('source-lagging'), '--fail-on', 'unknown'])).code,
    ).toBe(0);
    expect(
      (await invoke([...base, '-e', fixture('source-lagging'), '--fail-on', 'pending'])).code,
    ).toBe(1);
  });

  it('writes junit and markdown files alongside the JSON report and announces them on stderr', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-reports-'));
    const junit = path.join(dir, 'bte.junit.xml');
    const markdown = path.join(dir, 'bte.md');
    const json = path.join(dir, 'bte.json');
    const { code, err } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('missing-invoice'),
      '--now',
      '2026-01-15T10:03:00Z',
      '-o',
      json,
      '--junit',
      junit,
      '--markdown',
      markdown,
    ]);
    expect(code).toBe(1);
    expect(err).toBe(`wrote ${json}\nwrote ${junit}\nwrote ${markdown}\n`);
    expect(await readFile(junit, 'utf8')).toContain(
      '<failure message="FAIL: MISSING_EXPECTED_OUTCOME" type="FAIL">',
    );
    expect(await readFile(markdown, 'utf8')).toContain('gate failed');
    expect(JSON.parse(await readFile(json, 'utf8'))).toMatchObject({
      exitCode: 1,
      schemaVersion: 2,
    });
  });
});
