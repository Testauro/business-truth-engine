import { defineConfig, devices } from '@playwright/test';

const demoBaseUrl =
  process.env['ORANGEHRM_BASE_URL'] ?? 'https://opensource-demo.orangehrmlive.com';
const privateBaseUrl = process.env['ORANGEHRM_PRIVATE_BASE_URL'] ?? '';
process.env['ORANGEHRM_SESSION_FILE'] ??= '.auth/session.json';

/**
 * Projects:
 *   setup           logs in to the public demo and saves the session (tracing OFF so credentials
 *                   never appear in traces); demo tests reuse the saved storage state
 *   demo            read-only tests against the public demo
 *   contract        adapter contract tests against a local stub (no network)
 *   offline         synthetic fixture replays through BTE (no network)
 *   setup-private / private   state-changing leave workflow on a private instance only
 */
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { baseURL: demoBaseUrl, trace: 'off', screenshot: 'off' },
    },
    {
      name: 'demo',
      testDir: './tests/demo',
      dependencies: ['setup'],
      use: { baseURL: demoBaseUrl, storageState: process.env['ORANGEHRM_SESSION_FILE'] },
    },
    { name: 'contract', testDir: './tests/contract' },
    { name: 'offline', testDir: './tests/offline' },
    {
      name: 'setup-private',
      testMatch: /auth\.private\.setup\.ts/,
      use: { baseURL: privateBaseUrl || 'http://127.0.0.1:1', trace: 'off', screenshot: 'off' },
    },
    {
      name: 'private',
      testDir: './tests/private',
      dependencies: ['setup-private'],
      use: {
        baseURL: privateBaseUrl || 'http://127.0.0.1:1',
        storageState: '.auth/private-session.json',
      },
    },
  ],
});
