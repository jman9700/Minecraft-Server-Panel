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
    await expect(page.getByRole('heading', { name: /sign in|log in/i })).toBeVisible();
    await expect(page.getByLabel(/username|email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('rejects bad credentials with an error message', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/username|email/i).fill('not-a-real-user');
    await page.getByLabel(/password/i).fill('wrong-password');
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
    // Still on the login page -- didn't accidentally get in
    await expect(page).toHaveURL(/login/);
  });

  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/username|email/i).fill(process.env.PANEL_TEST_USER!);
    await page.getByLabel(/password/i).fill(process.env.PANEL_TEST_PASS!);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Adjust this to wherever your panel lands post-login,
    // e.g. a dashboard, server status page, etc.
    await expect(page).toHaveURL(/dashboard|home|servers/i);
    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();
  });
});
