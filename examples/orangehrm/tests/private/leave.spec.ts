import { attestation } from '@bte/sdk';
import { expect, test } from '@playwright/test';
import { createBte, loadBteWorkerState } from '@bte/playwright';
import { ApplyLeavePage, LeaveListPage } from '../../src/pages/leave.pages.js';
import { projectDir, readEnv, uiObservation } from '../../src/fixtures.js';

/**
 * Leave approval workflow. Runs ONLY against a private OrangeHRM instance (ORANGEHRM_PRIVATE_*).
 * It applies for leave as the configured employee, approves it as the logged-in admin, and lets
 * BTE verify the request became Scheduled and the entitlement recorded the usage, from the API.
 * Uses unique future dates per run; cancellation/cleanup is manual on the private instance.
 */
const env = readEnv('ORANGEHRM_PRIVATE');
const empNumber = Number(process.env['ORANGEHRM_PRIVATE_EMP_NUMBER'] ?? '0');
const leaveTypeName = process.env['ORANGEHRM_PRIVATE_LEAVE_TYPE'] ?? '';
const leaveTypeId = Number(process.env['ORANGEHRM_PRIVATE_LEAVE_TYPE_ID'] ?? '0');
const employeeName = process.env['ORANGEHRM_PRIVATE_EMPLOYEE_NAME'] ?? '';

test.skip(
  env.baseUrl === '' ||
    empNumber === 0 ||
    leaveTypeName === '' ||
    leaveTypeId === 0 ||
    employeeName === '',
  'private instance not configured (ORANGEHRM_PRIVATE_BASE_URL, _EMP_NUMBER, _LEAVE_TYPE, _LEAVE_TYPE_ID, _EMPLOYEE_NAME)',
);

test('apply -> approve -> BTE verifies Scheduled status and entitlement usage from the API', async ({
  page,
}, testInfo) => {
  // Unique dates: a weekday 30-60 days ahead, offset by the run's second-of-day.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30 + (Math.floor(Date.now() / 1000) % 30));
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6)
    start.setUTCDate(start.getUTCDate() + 1);
  const fromDate = start.toISOString().slice(0, 10);
  const toDate = fromDate;
  const requestKey = `${empNumber}:${fromDate}:${toDate}`;

  const apply = new ApplyLeavePage(page);
  await apply.goto();
  await apply.submit(leaveTypeName, fromDate, toDate);

  const list = new LeaveListPage(page);
  await list.goto();
  await list.approve(employeeName, fromDate);

  process.env['ORANGEHRM_BASE_URL'] = env.baseUrl;
  process.env['ORANGEHRM_SESSION_FILE'] = '.auth/private-session.json';
  const state = await loadBteWorkerState({ config: { cwd: projectDir } });
  const bte = createBte(state, {}, testInfo);
  bte.correlate({ empNumber, fromDate, toDate, requestKey });
  bte.addRecords([
    ...uiObservation('leave.request.submitted', `ui:leave:${requestKey}`, {
      requestKey,
      empNumber,
      leaveTypeId,
      fromDate,
      toDate,
    }),
    attestation('orangehrm-ui', Date.now(), { completeThrough: Date.now() }),
  ]);
  const approved = await bte.expectInvariant('leave-request-approved', requestKey);
  const scheduled = approved.expectations[0]?.observations[0];
  expect(scheduled?.eventId).toMatch(/^leave-scheduled:\d+$/);
  // Usage: the rule compares daysUsed with the request's own lengthDays, whatever the policy computed.
  await bte.expectInvariant('leave-usage-recorded', `${empNumber}:${leaveTypeId}`);
});
