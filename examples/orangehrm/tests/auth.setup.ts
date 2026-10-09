import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page.js';
import { projectDir, readEnv } from '../src/fixtures.js';

/** Logs in once and saves the session. This project runs with tracing and screenshots off. */
setup('log in to OrangeHRM and save the session', async ({ page }) => {
  const env = readEnv();
  setup.skip(
    env.username === '' || env.password === '',
    'ORANGEHRM_USERNAME / ORANGEHRM_PASSWORD are not set',
  );
  const login = new LoginPage(page);
  await login.goto();
  await login.login(env.username, env.password);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const file = path.resolve(
    projectDir,
    process.env['ORANGEHRM_SESSION_FILE'] ?? '.auth/session.json',
  );
  await mkdir(path.dirname(file), { recursive: true });
  await page.context().storageState({ path: file });
});
