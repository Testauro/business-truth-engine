import { defineConfig, devices } from '@playwright/test';

const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// BTE's config reads these; the stub reads them too.
process.env['LMS_BASE_URL'] = BASE_URL;
process.env['LMS_API_TOKEN'] ??= 'lms-dev-token';

/** The consumer's own Playwright configuration. BTE does not replace or wrap it. */
export default defineConfig({
  testDir: './tests',
  workers: 1, // one shared stub with mutable faults
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node app/server.mjs',
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), LMS_API_TOKEN: process.env['LMS_API_TOKEN'] ?? 'lms-dev-token' },
  },
});
