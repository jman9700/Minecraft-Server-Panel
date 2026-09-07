import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Playwright's recommended pattern for auth: log in ONCE here, save the
 * resulting storage state (cookies + localStorage) to a file, then have
 * the "chromium" project reuse that file instead of re-logging-in for
 * every single test.
 *
 * This is already wired up in playwright.config.ts:
 *
 *   { name: 'setup', testMatch: /auth\.setup\.ts/ },
 *   {
 *     name: 'chromium',
 *     testIgnore: /login\.spec\.ts/,
 *     use: { ...devices['Desktop Chrome'], storageState: authFile },
 *     dependencies: ['setup'],
 *   },
 *
 * The panel keeps its session as a JWT in localStorage["mcp_token"] --
 * there are no auth cookies -- so the saved storageState is really just
 * that one localStorage entry. On the next page load the panel's boot
 * script reads the token and calls showApp() automatically.
 */
const authFile = path.resolve(__dirname, '..', 'playwright/.auth/user.json');

const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;

if (!USER || !PASS) {
  throw new Error(
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set in panel-testing/.env'
  );
}

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  // The <label>s in the login box aren't associated with their inputs
  // (no `for`, not wrapping), so target the inputs by id like
  // login.spec.ts does.
  await page.locator('#login-user').fill(USER);
  await page.locator('#login-pass').fill(PASS);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // The panel is a single-page app: doLogin() stores the JWT and calls
  // showApp(), which flips #login-screen to display:none and #app-screen
  // to block. The URL never changes, so assert on the screen swap.
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#user-display')).toHaveText(
    new RegExp(`^${USER}$`, 'i')
  );

  // Sanity-check the token actually landed before we snapshot state.
  const token = await page.evaluate(() => localStorage.getItem('mcp_token'));
  expect(token, 'expected mcp_token in localStorage after login').toBeTruthy();

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
