import { test, expect } from '@playwright/test';

/**
 * These tests hit the login flow directly. No stored auth state here,
 * since the whole point is to exercise the login form itself.
 */

test.describe('Login', () => {
  test('shows the login form when logged out', async ({ page }) => {
    await page.goto('/login');

    // Prefer role-based locators over CSS selectors -- they read
    // like a user's mental model and survive markup changes.
    //await expect(page.getByRole('heading', { name: /sign in|log in/i })).toBeVisible();
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
    await page.locator('#login-user').fill(process.env.PANEL_TEST_USER!);
    await page.locator('#login-pass').fill(process.env.PANEL_TEST_PASS!);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Adjust this to wherever your panel lands post-login,
    // e.g. a dashboard, server status page, etc.
    await expect(page).toHaveURL(/dashboard|home|servers/i);
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();
  });
});
