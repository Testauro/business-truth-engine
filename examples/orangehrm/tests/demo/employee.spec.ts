import { uiObservation, expect, test } from '../../src/fixtures.js';

const RULE = 'employee-identity-consistent';

test.describe('PIM employee: UI validation and BTE invariant (public demo, read-only)', () => {
  test('A. traditional UI assertions: the employee list leads to matching personal details', async ({
    employeeList,
    employeeDetails,
  }) => {
    await employeeList.goto();
    const row = await employeeList.firstRow();
    await employeeDetails.waitLoaded();
    const details = await employeeDetails.read();
    expect(details.empNumber).toBe(row.empNumber);
    expect(details.lastName).toBe(row.lastName);
    expect(`${details.firstName} ${details.middleName}`.trim()).toBe(row.firstAndMiddle);
    // The user-facing Employee Id may legitimately be blank on the shared demo.
    expect(details.employeeId).toBe(row.employeeId);
  });

  test('B. BTE: the displayed employee agrees with the authoritative API record (PASS with authorized API, else UNKNOWN)', async ({
    employeeList,
    employeeDetails,
    bte,
    env,
  }) => {
    await employeeList.goto();
    const row = await employeeList.firstRow();
    await employeeDetails.waitLoaded();
    const details = await employeeDetails.read();

    // What the UI showed becomes the trigger; empNumber (the URL key) is the authoritative identifier.
    bte.correlate({ empNumber: details.empNumber });
    bte.addRecords(
      uiObservation('employee.observed', `ui:employee:${details.empNumber}:${Date.now()}`, {
        empNumber: details.empNumber,
        employeeId: details.employeeId,
        firstName: details.firstName,
        lastName: details.lastName,
        middleName: details.middleName,
      }),
    );

    if (env.apiMode === 'none') {
      const verdict = await bte.expectVerdict(RULE, details.empNumber, 'UNKNOWN');
      expect(verdict.reasons.map((r) => r.code)).toEqual(['SOURCE_UNAVAILABLE']);
      expect(verdict.reasons[0]?.message).toContain('no authorized OrangeHRM API access');
      return;
    }
    const verdict = await bte.expectInvariant(RULE, details.empNumber);
    expect(verdict.expectations[0]?.observations).toHaveLength(1);
    expect(verdict.expectations[0]?.observations[0]?.eventId).toBe(`employee:${details.empNumber}`);
    expect(verdict.reasons.map((r) => r.code)).toContain('OUTCOME_CONFIRMED');
  });

  test('C. without authorized API access, BTE says UNKNOWN rather than trusting the UI', async ({
    employeeList,
    employeeDetails,
    bteState,
    env,
  }, testInfo) => {
    // Same rules, but the API source is built in `none` mode: no token, no session.
    const { createBte } = await import('@bte/playwright');
    const { createOrangeHrmSource } = await import('../../bte/adapters/orangehrm.js');
    const noApi = createOrangeHrmSource({
      name: 'orangehrm-api',
      baseUrl: env.baseUrl,
      kind: 'employees',
      env: { ORANGEHRM_API_MODE: 'none' },
    });
    const bte = createBte({ rules: bteState.rules, sources: [noApi], loaded: null }, {}, testInfo);

    await employeeList.goto();
    const row = await employeeList.firstRow();
    await employeeDetails.waitLoaded();
    const details = await employeeDetails.read();
    expect(details.empNumber).toBe(row.empNumber);
    bte.correlate({ empNumber: details.empNumber });
    bte.addRecords(
      uiObservation('employee.observed', `ui:employee:${details.empNumber}:${Date.now()}`, {
        ...details,
      }),
    );
    const verdict = await bte.expectVerdict(RULE, details.empNumber, 'UNKNOWN');
    expect(verdict.expectations[0]?.source.status).toBe('unavailable');
    const unavailable = verdict.reasons.find((r) => r.code === 'SOURCE_UNAVAILABLE');
    expect(unavailable?.message).toContain('no authorized OrangeHRM API access');
    await expect(bte.expectInvariant(RULE, details.empNumber)).rejects.toThrow(/got UNKNOWN/);
  });
});
