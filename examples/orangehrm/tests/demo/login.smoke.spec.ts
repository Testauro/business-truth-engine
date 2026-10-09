import { expect, test } from '../../src/fixtures.js';

test.describe('login smoke (public demo, read-only)', () => {
  test('the saved session opens the dashboard without re-entering credentials', async ({
    page,
  }) => {
    await page.goto('/web/index.php/dashboard/index');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PIM' })).toBeVisible();
  });

  test('a wrong password is rejected with a visible error', async ({ browser, env }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    try {
      await page.goto('/web/index.php/auth/login');
      await page.getByPlaceholder('Username').fill(env.username || 'nobody');
      await page.getByPlaceholder('Password').fill('definitely-not-the-password');
      await page.getByRole('button', { name: 'Login' }).click();
      await expect(page.getByRole('alert')).toContainText('Invalid credentials');
    } finally {
      await context.close();
    }
  });
});
