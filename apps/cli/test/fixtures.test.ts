import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runEvaluate } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixturesDir = path.join(repoRoot, 'examples', 'fixtures');

const CatalogueSchema = z.object({
  rule: z.string(),
  cases: z.array(
    z.object({
      name: z.string(),
      now: z.string(),
      expected: z.array(
        z.object({
          correlationValue: z.string(),
          verdict: z.enum(['PASS', 'FAIL', 'PENDING', 'UNKNOWN']),
          reasons: z.array(z.string()),
        }),
      ),
    }),
  ),
});

const CATALOGUES = ['examples/fixtures/cases.json', 'examples/fixtures/aggregates/cases.json'];
const catalogues = await Promise.all(
  CATALOGUES.map(async (file) => ({
    file,
    dir: path.dirname(path.join(repoRoot, file)),
    catalogue: CatalogueSchema.parse(JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'))),
  })),
);
const primary = catalogues[0];
if (primary === undefined) throw new Error('no catalogues');
const catalogue = primary.catalogue;

describe.each(catalogues.map((c) => [c.file, c] as const))('catalogue %s', (_file, entry) => {
  it.each(entry.catalogue.cases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
    const result = await runEvaluate({
      rules: [path.join(repoRoot, entry.catalogue.rule)],
      evidence: [path.join(entry.dir, `${testCase.name}.ndjson`)],
      now: testCase.now,
      format: 'json',
      failOn: 'fail',
    });
    const actual = result.report.verdicts.map((v) => ({
      correlationValue: v.correlationValue,
      verdict: v.verdict,
      reasons: v.reasons.map((r) => r.code),
    }));
    expect(actual).toEqual(testCase.expected);
    expect(result.exitCode).toBe(testCase.expected.some((e) => e.verdict === 'FAIL') ? 1 : 0);
  });
});

describe('fixture catalogue', () => {
  it('covers every verdict', () => {
    const verdicts = new Set(catalogue.cases.flatMap((c) => c.expected.map((e) => e.verdict)));
    expect([...verdicts].sort()).toEqual(['FAIL', 'PASS', 'PENDING', 'UNKNOWN']);
  });

  it.each(catalogue.cases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
    const result = await runEvaluate({
      rules: [path.join(repoRoot, catalogue.rule)],
      evidence: [path.join(fixturesDir, `${testCase.name}.ndjson`)],
      now: testCase.now,
      format: 'json',
      failOn: 'fail',
    });
    const actual = result.report.verdicts.map((v) => ({
      correlationValue: v.correlationValue,
      verdict: v.verdict,
      reasons: v.reasons.map((r) => r.code),
    }));
    expect(actual).toEqual(testCase.expected);
    expect(result.exitCode).toBe(testCase.expected.some((e) => e.verdict === 'FAIL') ? 1 : 0);
    for (const verdict of result.report.verdicts) {
      expect(verdict.ruleId).toBe('invoice-created-once');
      for (const reason of verdict.reasons) expect(reason.message.length).toBeGreaterThan(10);
    }
  });

  it('produces byte-identical JSON on repeated runs', async () => {
    const options = {
      rules: [path.join(repoRoot, catalogue.rule)],
      evidence: [path.join(fixturesDir, 'duplicate-invoice.ndjson')],
      now: '2026-01-15T10:03:00Z',
      format: 'json' as const,
      failOn: 'fail' as const,
    };
    const first = await runEvaluate(options);
    const second = await runEvaluate(options);
    expect(second.rendered).toBe(first.rendered);
    expect(first.report.evaluatedAt).toBe('2026-01-15T10:03:00.000Z');
  });

  it('gates on UNKNOWN and PENDING when asked', async () => {
    const base = {
      rules: [path.join(repoRoot, catalogue.rule)],
      now: '2026-01-15T10:03:00Z',
      format: 'text' as const,
    };
    const unknown = path.join(fixturesDir, 'unavailable-source.ndjson');
    const pending = path.join(fixturesDir, 'source-lagging.ndjson');
    expect((await runEvaluate({ ...base, evidence: [unknown], failOn: 'fail' })).exitCode).toBe(0);
    expect((await runEvaluate({ ...base, evidence: [unknown], failOn: 'unknown' })).exitCode).toBe(
      1,
    );
    expect((await runEvaluate({ ...base, evidence: [pending], failOn: 'unknown' })).exitCode).toBe(
      0,
    );
    expect((await runEvaluate({ ...base, evidence: [pending], failOn: 'pending' })).exitCode).toBe(
      1,
    );
  });
});
