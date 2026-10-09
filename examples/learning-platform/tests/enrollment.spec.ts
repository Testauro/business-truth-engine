import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from './fixtures.js';

const RULE = 'course-access-after-enrollment';
const PAST_DEADLINE_MS = 61_000;
const projectDir = fileURLToPath(new URL('..', import.meta.url));

/** The ordinary UI flow and its assertions: these pass whatever happens to course access. */
async function enrollViaUi(
  page: import('@playwright/test').Page,
  courseId: string,
): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Learner id').fill('learner-42');
  await page.getByLabel('Course').selectOption(courseId);
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByRole('status')).toContainText('Enrollment confirmed for learner-42');
  const id = await page.getByTestId('enrollment-id').textContent();
  if (id === null) throw new Error('no enrollment id');
  return id.trim();
}

test.describe('course access after enrollment (business truth)', () => {
  test('PASS: access is granted for the enrolled course within the deadline', async ({
    page,
    lms,
    bte,
  }) => {
    const enrollmentId = await enrollViaUi(page, 'course-ts-101');
    bte.correlate({ enrollmentId, learnerId: 'learner-42' });
    await lms.advance(PAST_DEADLINE_MS);
    const verdict = await bte.expectInvariant(RULE, enrollmentId);
    expect(verdict.reasons.map((r) => r.code)).toContain('OUTCOME_CONFIRMED');
    expect(verdict.expectations[0]?.observations[0]?.eventId).toMatch(/^access:acc_/);
  });

  test('FAIL: the UI confirms enrollment but access is never granted', async ({
    page,
    lms,
    bte,
  }) => {
    await lms.fault('missing-access');
    const enrollmentId = await enrollViaUi(page, 'course-ts-101');
    bte.correlate({ enrollmentId });
    await lms.advance(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE, enrollmentId, 'FAIL');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['MISSING_EXPECTED_OUTCOME']);
    await expect(bte.expectInvariant(RULE, enrollmentId)).rejects.toThrow(
      /expected BTE verdict PASS but got FAIL/,
    );
  });

  test('FAIL: access is granted, but to the wrong course', async ({ page, lms, bte }) => {
    await lms.fault('wrong-course');
    const enrollmentId = await enrollViaUi(page, 'course-pw-201');
    await lms.advance(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE, enrollmentId, 'FAIL');
    const mismatch = verdict.reasons.find((r) => r.code === 'ASSERTION_MISMATCH');
    expect(mismatch?.message).toContain(
      '"courseId" is "course-intro-to-nothing", expected equals "course-pw-201"',
    );
  });

  test('PENDING: before the 60s deadline the obligation is open, never PASS', async ({
    page,
    lms,
    bte,
  }) => {
    await lms.fault('delayed-access');
    const enrollmentId = await enrollViaUi(page, 'course-ts-101');
    await lms.advance(30_000);
    await bte.collect();
    const early = await bte.evaluate(RULE, enrollmentId);
    expect(early.verdict?.verdict).toBe('PENDING');
    expect(early.verdict?.reasons.map((r) => r.code)).toEqual(['WINDOW_OPEN']);
    // Once the delayed grant lands after the deadline, it is a late outcome: FAIL.
    await lms.advance(61_000);
    const late = await bte.expectVerdict(RULE, enrollmentId, 'FAIL');
    expect(late.reasons.map((r) => r.code)).toContain('LATE_OUTCOME');
  });

  test('UNKNOWN: the access system is unavailable, so nothing can be concluded', async ({
    page,
    lms,
    bte,
  }) => {
    await lms.fault('access-api-down');
    const enrollmentId = await enrollViaUi(page, 'course-ts-101');
    await lms.advance(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE, enrollmentId, 'UNKNOWN');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['SOURCE_UNAVAILABLE']);
    expect(verdict.expectations[0]?.source.status).toBe('unavailable');
    await expect(bte.expectInvariant(RULE, enrollmentId)).rejects.toThrow(/got UNKNOWN/);
  });
});

test.describe('the same verification from the CLI', () => {
  test('bte verify reads bte.config.ts, collects over HTTP and gates on FAIL', async ({
    page,
    lms,
  }) => {
    await lms.fault('missing-access');
    const enrollmentId = await enrollViaUi(page, 'course-ts-101');
    await lms.advance(PAST_DEADLINE_MS);
    const now = new Date(await lms.now()).toISOString();
    const bin = path.join(projectDir, 'node_modules', '.bin', 'bte');
    const run = promisify(execFile);
    let stdout = '';
    let code = 0;
    try {
      ({ stdout } = await run(
        bin,
        [
          'verify',
          '--cwd',
          projectDir,
          '--now',
          now,
          '--correlation',
          `enrollmentId=${enrollmentId}`,
        ],
        { env: process.env },
      ));
    } catch (error) {
      const failed = error as { stdout: string; code: number };
      stdout = failed.stdout;
      code = failed.code;
    }
    expect(code).toBe(1);
    expect(stdout).toContain(
      `FAIL    course-access-after-enrollment@v1  enrollmentId="${enrollmentId}"`,
    );
    expect(stdout).toContain('MISSING_EXPECTED_OUTCOME');
    const junit = await readFile(path.join(projectDir, 'bte-report', 'bte.junit.xml'), 'utf8');
    expect(junit).toContain('<failure message="FAIL: MISSING_EXPECTED_OUTCOME" type="FAIL">');
    const explain = await run(
      bin,
      ['explain', RULE, enrollmentId, '--cwd', projectDir, '--now', now],
      { env: process.env },
    ).catch((e: { stdout: string }) => e);
    expect(explain.stdout).toContain('expectation access (access.granted from lms-access): FAIL');
  });
});
