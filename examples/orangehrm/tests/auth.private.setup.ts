import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/login.page.js';
import { projectDir, readEnv } from '../src/fixtures.js';

setup('log in to the private OrangeHRM instance', async ({ page }) => {
  const env = readEnv('ORANGEHRM_PRIVATE');
  setup.skip(
    env.baseUrl === '' || env.username === '' || env.password === '',
    'ORANGEHRM_PRIVATE_* are not set; state-changing tests only run on a private instance',
  );
  const login = new LoginPage(page);
  await login.goto();
  await login.login(env.username, env.password);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const file = path.resolve(projectDir, '.auth/private-session.json');
  await mkdir(path.dirname(file), { recursive: true });
  await page.context().storageState({ path: file });
});
