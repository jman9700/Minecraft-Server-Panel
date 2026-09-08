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
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set: panel-testing/.env locally, ' +
      'or repository Actions secrets in CI'
  );
}
 
test.describe('Login', () => {
  test('shows the login form when logged out', async ({ page }) => {
    await page.goto('/login');
 
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-pass')).toBeVisible();
  });
 
  test('rejects bad credentials with an error message', async ({ page }) => {
    // Use a throwaway username unique to this run. The panel locks an
    // account after N failed attempts (in-memory, per username), and a
    // fixed name like "not-a-real-user" accumulates failures across runs
    // until it trips the lockout and this test starts seeing the
    // "Account locked" message instead. A fresh name each run gets
    // exactly one failed attempt.
    const bogusUser = `nobody-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto('/login');
    await page.locator('#login-user').fill(bogusUser);
    await page.locator('#login-pass').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Assert the outcome, not a specific server string: an error shows
    // and we're still logged out.
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#app-screen')).toBeHidden();
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