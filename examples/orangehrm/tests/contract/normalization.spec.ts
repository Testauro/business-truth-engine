import { expect, test } from '@playwright/test';
import { EvidenceRecordSchema, mapItems } from '@bte/sdk';
import {
  employeeRecordMapping,
  leaveEntitlementMapping,
  leaveScheduledMapping,
} from '../../bte/adapters/orangehrm.js';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');

test.describe('evidence normalization (OrangeHRM JSON -> BTE records)', () => {
  test('employee record', () => {
    const body = {
      data: {
        empNumber: 185,
        lastName: 'Chk',
        firstName: '12345',
        middleName: '',
        employeeId: '0386',
        terminationId: null,
      },
      meta: [],
      rels: [],
    };
    const { events, problems } = mapItems(employeeRecordMapping, body, {
      source: 'orangehrm-api',
      collectedAt: NOW,
    });
    expect(problems).toEqual([]);
    expect(events).toHaveLength(1);
    expect(EvidenceRecordSchema.safeParse(events[0]).success).toBe(true);
    expect(events[0]?.payload).toEqual({
      empNumber: 185,
      employeeId: '0386',
      firstName: '12345',
      lastName: 'Chk',
      middleName: '',
    });
  });

  test('leave request: only Scheduled requests become leave.request.scheduled, keyed by employee and dates', () => {
    const body = {
      data: [
        {
          id: 11,
          dates: { fromDate: '2026-06-10', toDate: '2026-06-11' },
          leaveBreakdown: [{ id: 2, name: 'Scheduled', lengthDays: 2 }],
          leaveType: { id: 3, name: 'Annual' },
          employee: { empNumber: 7 },
        },
        {
          id: 12,
          dates: { fromDate: '2026-06-12', toDate: '2026-06-12' },
          leaveBreakdown: [{ id: 1, name: 'Pending Approval', lengthDays: 1 }],
          leaveType: { id: 3, name: 'Annual' },
          employee: { empNumber: 7 },
        },
      ],
    };
    const { events, problems } = mapItems(leaveScheduledMapping, body, {
      source: 'orangehrm-leave-api',
      collectedAt: NOW,
    });
    expect(problems).toEqual([]);
    expect(events.map((e) => e.eventId)).toEqual(['leave-scheduled:11']);
    expect(events[0]?.payload).toMatchObject({
      requestKey: '7:2026-06-10:2026-06-11',
      entitlementKey: '7:3',
      lengthDays: 2,
      leaveTypeId: 3,
    });
  });

  test('entitlement snapshot', () => {
    const body = {
      data: [
        { id: 5, entitlement: 10, daysUsed: 2.5, leaveType: { id: 3 }, employee: { empNumber: 7 } },
      ],
    };
    const { events, problems } = mapItems(leaveEntitlementMapping, body, {
      source: 'orangehrm-leave-api',
      collectedAt: NOW,
    });
    expect(problems).toEqual([]);
    expect(events[0]).toMatchObject({
      eventId: 'entitlement:5:2.5',
      payload: { entitlementKey: '7:3', daysUsed: 2.5, entitlement: 10 },
    });
  });

  test('negative: missing fields are reported per item and nothing is defaulted', () => {
    const { events, problems } = mapItems(
      employeeRecordMapping,
      { data: { lastName: 'NoNumber' } },
      { source: 'orangehrm-api', collectedAt: NOW },
    );
    expect(events).toEqual([]);
    expect(problems.map((p) => p.field)).toEqual([
      'eventId',
      'payload.empNumber',
      'payload.employeeId',
      'payload.firstName',
      'payload.middleName',
    ]);
  });

  test('negative: an empty or absent data node yields no events and no problems (absence is for attestations to judge)', () => {
    expect(
      mapItems(leaveScheduledMapping, { data: [] }, { source: 's', collectedAt: NOW }),
    ).toEqual({ events: [], problems: [] });
    expect(mapItems(employeeRecordMapping, {}, { source: 's', collectedAt: NOW })).toEqual({
      events: [],
      problems: [],
    });
  });
});
