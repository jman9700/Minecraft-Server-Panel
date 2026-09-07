import { test, expect } from '@playwright/test';
 
/**
 * These tests hit the login flow directly. No stored auth state here,
 * since the whole point is to exercise the login form itself.
 */
 
// Read these once, at module scope. Because they're `const`, TypeScript
// keeps the narrowing from the guard below alive inside the test
// callbacks -- so no `!` needed further down. Reading
// `process.env.PANEL_TEST_USER` directly inside each test would stay
// `string | undefined` no matter what you check up here.
const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;
 
if (!USER || !PASS) {
  throw new Error(
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set in panel-testing/.env'
  );
}
 
test.describe('Login', () => {
  test('shows the login form when logged out', async ({ page }) => {
    await page.goto('/login');
 
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-pass')).toBeVisible();
  });
 
  test('rejects bad credentials with an error message', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-user').fill('not-a-real-user');
    await page.locator('#login-pass').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
 
    await expect(page.getByText('Session expired')).toBeVisible();
    // Still on the login page -- didn't accidentally get in
    await expect(page).toHaveURL(/login/);
  });
 
  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-user').fill(USER);
    await page.locator('#login-pass').fill(PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
 
    // The panel is a single-page app: doLogin() calls showApp(), which
    // just flips #login-screen to display:none and #app-screen to block.
    // The URL never changes, so asserting on it can't work here.
    await expect(page.locator('#login-screen')).toBeHidden();
    await expect(page.locator('#app-screen')).toBeVisible();
 
    // The topbar button reads "Sign out", not "Log out".
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
 
    // Case-insensitive: the server matches usernames case-insensitively
    // but echoes back the canonical casing from its user record, which
    // may not match what you typed into .env.
    await expect(page.locator('#user-display')).toHaveText(
      new RegExp(`^${USER}$`, 'i')
    );
  });
});