import { test, expect } from '@playwright/test';

/**
 * Issue #10: signing in on a browser a more-privileged user just used
 * must not leave that user's data on screen.
 *
 * doLogout() used to hide #app-screen without wiping what the session
 * had rendered, and it's an SPA -- the "Sign out" button doesn't reload
 * the page. So if the next person signs in on that same page (no
 * refresh), showApp() didn't clear anything either: the previous
 * session's active tab and its contents were still there. A guest with
 * no permissions could read the admin's file browser, user list, etc.
 * (the API still refused actions, but the data was on screen).
 *
 * Repro must NOT navigate between the two logins -- that full reload
 * would mask the bug. Admin signs in, opens Files, clicks Sign out, then
 * the guest signs in on the same page instance.
 *
 * Uses the Files tab: Test_Account can browse files, the deployed guest
 * cannot.
 */
const ADMIN_USER = process.env.PANEL_TEST_USER;
const ADMIN_PASS = process.env.PANEL_TEST_PASS;
const GUEST_USER = process.env.PANEL_GUEST_USER || 'guest';
const GUEST_PASS = process.env.PANEL_GUEST_PASS;

if (!ADMIN_USER || !ADMIN_PASS || !GUEST_PASS) {
  throw new Error(
    'PANEL_TEST_USER / PANEL_TEST_PASS / PANEL_GUEST_PASS must be set: ' +
      'panel-testing/.env locally, or repository Actions secrets in CI'
  );
}

async function submitLogin(page, user: string, pass: string) {
  await page.locator('#login-user').fill(user);
  await page.locator('#login-pass').fill(pass);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#user-display')).toHaveText(new RegExp(`^${user}$`, 'i'));
}

test('a prior session leaves nothing on screen for the next sign-in', async ({ page }) => {
  await page.goto('/login');

  // Privileged session renders something the guest may not see.
  await submitLogin(page, ADMIN_USER, ADMIN_PASS);
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.locator('#tab-files')).toBeVisible();
  await expect(page.locator('#file-tbody tr').first()).toBeVisible();

  // Sign out via the button -- no navigation.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#login-screen')).toBeVisible();

  // Guest signs in on the very same page.
  await submitLogin(page, GUEST_USER, GUEST_PASS);

  // Nothing from the admin session survived.
  await expect(page.locator('#file-tbody')).toBeEmpty();
  await expect(page.locator('#tab-files')).not.toBeVisible();
  await expect(page.locator('#tab-files-btn')).toBeHidden();
  await expect(page.locator('#tab-console')).toBeVisible();
});
