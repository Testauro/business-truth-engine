import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresEvidenceStore } from '@bte/evidence-postgres';
import { runCli } from '../src/index.js';

const url = process.env['BTE_TEST_POSTGRES_URL'];
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

describe.skipIf(url === undefined || url === '')('bte ingest / evaluate --postgres', () => {
  const schema = `bte_cli_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const dbUrl = url ?? '';

  afterAll(async () => {
    const store = PostgresEvidenceStore.connect(dbUrl, { schema });
    await store.destroy();
    await store.close();
  });

  it('ingests NDJSON idempotently and reports counts without leaking the password', async () => {
    const first = await invoke([
      'ingest',
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '-e',
      fixture('missing-invoice'),
    ]);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(
      /ingested 3 record\(s\) into postgres(ql)?:\/\/[^@\s]*\*\*\*@|ingested 3 record\(s\) into postgres(ql)?:\/\/[^:@\s]+(:\d+)?\//,
    );
    expect(first.out).toContain('events +1 (0 already present), sources +2 (0 already present)');
    const second = await invoke([
      'ingest',
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '-e',
      fixture('missing-invoice'),
    ]);
    expect(second.out).toContain('events +0 (1 already present), sources +0 (2 already present)');
    expect(second.out).not.toContain('bte:bte@');
  });

  it('evaluates from the store with the documented verdict and exit code', async () => {
    const { code, out } = await invoke([
      'evaluate',
      '-r',
      rules,
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '--now',
      '2026-01-15T10:03:00Z',
      '-f',
      'json',
    ]);
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      verdicts: { verdict: string; reasons: { code: string }[] }[];
      inputs: { evidence: string[] };
    };
    expect(report.verdicts.map((v) => v.verdict)).toEqual(['FAIL']);
    expect(report.verdicts[0]?.reasons.map((r) => r.code)).toEqual(['MISSING_EXPECTED_OUTCOME']);
    expect(report.inputs.evidence[0]).toContain(`schema ${schema}`);
    expect(report.inputs.evidence[0]).not.toContain('bte:bte@');
  });

  it('as-of evaluation: before the deadline the same store yields PENDING', async () => {
    const { code, out } = await invoke([
      'evaluate',
      '-r',
      rules,
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '--now',
      '2026-01-15T10:01:00Z',
      '-f',
      'json',
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(out) as {
      verdicts: { verdict: string; reasons: { code: string }[] }[];
    };
    // Only rows collected by 10:01 are used: the 10:03 attestations are not yet visible.
    expect(report.verdicts[0]?.verdict).toBe('UNKNOWN');
    expect(report.verdicts[0]?.reasons.map((r) => r.code)).toContain('SOURCE_STATUS_MISSING');
    const explicit = await invoke([
      'evaluate',
      '-r',
      rules,
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '--now',
      '2026-01-15T10:01:00Z',
      '--collected-until',
      '2026-01-15T10:03:00Z',
      '-f',
      'json',
    ]);
    const later = JSON.parse(explicit.out) as { verdicts: { verdict: string }[] };
    expect(later.verdicts[0]?.verdict).toBe('PENDING');
  });

  it('combines NDJSON files with the store', async () => {
    const { out } = await invoke([
      'evaluate',
      '-r',
      rules,
      '-e',
      fixture('normal'),
      '--postgres',
      dbUrl,
      '--postgres-schema',
      schema,
      '--now',
      '2026-01-15T10:03:00Z',
      '-f',
      'json',
    ]);
    const report = JSON.parse(out) as {
      verdicts: { verdict: string }[];
      inputs: { evidence: string[] };
    };
    expect(report.inputs.evidence).toHaveLength(2);
    expect(report.verdicts).toHaveLength(1);
  });

  it('requires some evidence source', async () => {
    const { code, err } = await invoke(['evaluate', '-r', rules, '--now', '2026-01-15T10:03:00Z']);
    expect(code).toBe(2);
    expect(err).toContain('no evidence given');
  });
});
