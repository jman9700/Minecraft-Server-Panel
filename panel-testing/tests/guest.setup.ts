import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Logs in the low-privilege `guest` account once and saves its
 * storageState, so guest.spec.ts can reuse it instead of logging in per
 * test. The panel rate-limits /api/login to ~10/min per IP, so keeping
 * login count down matters for suite stability (especially with CI
 * retries).
 *
 * Mirrors auth.setup.ts; see that file for why the login flow looks the
 * way it does (SPA, JWT in localStorage, id-based input locators).
 */
const authFile = path.resolve(__dirname, '..', 'playwright/.auth/guest.json');

const USER = process.env.PANEL_GUEST_USER || 'guest';
const PASS = process.env.PANEL_GUEST_PASS;

if (!PASS) {
  throw new Error(
    'PANEL_GUEST_PASS must be set: panel-testing/.env locally, or a ' +
      'repository Actions secret in CI'
  );
}

setup('authenticate as guest', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-user').fill(USER);
  await page.locator('#login-pass').fill(PASS);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#user-display')).toHaveText(new RegExp(`^${USER}$`, 'i'));

  const token = await page.evaluate(() => localStorage.getItem('mcp_token'));
  expect(token, 'expected mcp_token in localStorage after guest login').toBeTruthy();

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
