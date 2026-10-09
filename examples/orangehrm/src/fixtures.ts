import { fileURLToPath } from 'node:url';
import type { EvidenceRecord } from '@bte/sdk';
import { attestation } from '@bte/sdk';
import { createBteFixtures, type Bte, type BteWorkerState } from '@bte/playwright';
import { test as base, expect } from '@playwright/test';
import { EmployeeDetailsPage } from './pages/employee-details.page.js';
import { EmployeeListPage } from './pages/employee-list.page.js';
import { LoginPage } from './pages/login.page.js';

export const projectDir = fileURLToPath(new URL('..', import.meta.url));

export interface OrangeHrmEnv {
  baseUrl: string;
  username: string;
  password: string;
  apiMode: string;
}

/** Read configuration from the environment; credentials are never written down in code. */
export function readEnv(prefix: 'ORANGEHRM' | 'ORANGEHRM_PRIVATE' = 'ORANGEHRM'): OrangeHrmEnv {
  const baseUrl =
    process.env[`${prefix}_BASE_URL`] ??
    (prefix === 'ORANGEHRM' ? 'https://opensource-demo.orangehrmlive.com' : '');
  return {
    baseUrl,
    username: process.env[`${prefix}_USERNAME`] ?? '',
    password: process.env[`${prefix}_PASSWORD`] ?? '',
    apiMode: process.env['ORANGEHRM_API_MODE'] ?? 'session',
  };
}

export const UI_SOURCE = 'orangehrm-ui';

/**
 * Records produced by the test itself: what the UI displayed. They are evidence of what was
 * shown, authoritative for that claim only; the invariant compares them with the API record.
 */
export function uiObservation(
  type: string,
  eventId: string,
  payload: Record<string, unknown>,
  now = Date.now(),
): EvidenceRecord[] {
  const at = new Date(now).toISOString();
  return [
    { kind: 'event', eventId, type, source: UI_SOURCE, occurredAt: at, collectedAt: at, payload },
    attestation(UI_SOURCE, now, { completeThrough: now, note: 'Playwright UI observation' }),
  ];
}

const bteFixtures = createBteFixtures({ config: { cwd: projectDir } });

export const test = base.extend<
  {
    env: OrangeHrmEnv;
    login: LoginPage;
    employeeList: EmployeeListPage;
    employeeDetails: EmployeeDetailsPage;
    bte: Bte;
  },
  { bteState: BteWorkerState }
>({
  bteState: bteFixtures.bteState,
  bte: bteFixtures.bte,
  env: async ({}, use) => {
    await use(readEnv());
  },
  login: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  employeeList: async ({ page }, use) => {
    await use(new EmployeeListPage(page));
  },
  employeeDetails: async ({ page }, use) => {
    await use(new EmployeeDetailsPage(page));
  },
});

export { expect };
