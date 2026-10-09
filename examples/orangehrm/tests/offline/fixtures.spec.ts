import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { EvidenceSet, FixedClock, evaluateRules, loadRules, readAllEvidence } from '@bte/sdk';
import { projectDir } from '../../src/fixtures.js';

/**
 * SYNTHETIC fixtures. They demonstrate BTE's four verdicts on OrangeHRM-shaped evidence; the FAIL
 * cases are seeded inconsistencies in the fixture files, not OrangeHRM product defects.
 */
const cases = [
  {
    file: 'employee-consistent.ndjson',
    now: '2026-06-01T09:05:00Z',
    rule: 'employee-identity-consistent',
    verdict: 'PASS',
    reasons: ['OUTCOME_CONFIRMED'],
  },
  {
    file: 'employee-mismatch.ndjson',
    now: '2026-06-01T09:05:00Z',
    rule: 'employee-identity-consistent',
    verdict: 'FAIL',
    reasons: ['ASSERTION_MISMATCH'],
  },
  {
    file: 'employee-api-unavailable.ndjson',
    now: '2026-06-01T09:15:00Z',
    rule: 'employee-identity-consistent',
    verdict: 'UNKNOWN',
    reasons: ['SOURCE_UNAVAILABLE'],
  },
  {
    file: 'leave-approved.ndjson',
    now: '2026-06-02T10:00:00Z',
    rule: 'leave-request-approved',
    verdict: 'PASS',
    reasons: ['OUTCOME_CONFIRMED'],
  },
  {
    file: 'leave-pending.ndjson',
    now: '2026-06-01T12:00:00Z',
    rule: 'leave-request-approved',
    verdict: 'PENDING',
    reasons: ['WINDOW_OPEN'],
  },
  {
    file: 'leave-never-approved.ndjson',
    now: '2026-06-03T10:00:00Z',
    rule: 'leave-request-approved',
    verdict: 'FAIL',
    reasons: ['MISSING_EXPECTED_OUTCOME'],
  },
  {
    file: 'leave-usage-recorded.ndjson',
    now: '2026-06-02T10:00:00Z',
    rule: 'leave-usage-recorded',
    verdict: 'PASS',
    reasons: ['OUTCOME_CONFIRMED'],
  },
  {
    file: 'leave-usage-not-recorded.ndjson',
    now: '2026-06-02T10:00:00Z',
    rule: 'leave-usage-recorded',
    verdict: 'FAIL',
    reasons: ['ASSERTION_MISMATCH'],
  },
] as const;

test.describe('offline replay through BTE (synthetic fixtures)', () => {
  for (const c of cases) {
    test(`${c.file} -> ${c.verdict}`, async () => {
      const rules = await loadRules(path.join(projectDir, 'bte', 'rules'));
      const records = await readAllEvidence([path.join(projectDir, 'fixtures', c.file)]);
      const verdicts = evaluateRules(rules, EvidenceSet.from(records), {
        clock: new FixedClock(c.now),
      }).filter((v) => v.ruleId === c.rule);
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]?.verdict).toBe(c.verdict);
      expect(
        verdicts[0]?.reasons
          .map((r) => r.code)
          .filter((code) => code !== 'REDELIVERY_DEDUPLICATED'),
      ).toEqual(c.reasons);
    });
  }

  test('the installed bte CLI replays a fixture with the documented exit code', async () => {
    const run = promisify(execFile);
    const bin = path.join(projectDir, 'node_modules', '.bin', 'bte');
    const args = [
      'evaluate',
      '-r',
      path.join(projectDir, 'bte', 'rules'),
      '-e',
      path.join(projectDir, 'fixtures', 'employee-mismatch.ndjson'),
      '--now',
      '2026-06-01T09:05:00Z',
    ];
    const result = await run(bin, args).then(
      (ok) => ({ stdout: ok.stdout, code: 0 }),
      (e: { stdout: string; code: number }) => ({ stdout: e.stdout, code: e.code }),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    employee-identity-consistent@v1  empNumber=185');
    expect(result.stdout).toContain('"lastName" is "Chk"');
  });
});
