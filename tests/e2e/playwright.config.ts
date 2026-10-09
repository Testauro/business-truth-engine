import { defineConfig, devices } from '@playwright/test';

/**
 * Each worker starts its own in-process demo server on a free port with a
 * controllable clock (see fixtures/demo-server.ts), so tests run fully in
 * parallel without sharing fault state. Set BTE_E2E_BASE_URL to run against an
 * external demo started with BTE_DEMO_CLOCK=manual (then use --workers=1).
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  ...(process.env['CI'] ? { workers: 2 } : {}),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: '../../bte-report/e2e-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../../bte-report/e2e-html' }],
    ['junit', { outputFile: '../../bte-report/e2e-junit.xml' }],
  ],
  // The @demonstration spec fails on purpose (that is the point of the demo); run it with
  // `pnpm test:e2e:demonstration` rather than as part of the gate.
  ...(process.env['BTE_E2E_INCLUDE_DEMONSTRATION'] ? {} : { grepInvert: /@demonstration/ }),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
