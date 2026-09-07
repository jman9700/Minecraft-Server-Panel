import { test as setup, expect } from '@playwright/test';

/**
 * Playwright's recommended pattern for auth: log in ONCE here, save the
 * resulting cookies/localStorage to a file, then have every other test
 * project reuse that file instead of re-logging-in every single test.
 *
 * Wire this up in playwright.config.ts as its own project:
 *
 *   projects: [
 *     { name: 'setup', testMatch: /auth\.setup\.ts/ },
 *     {
 *       name: 'chromium',
 *       use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
 *       dependencies: ['setup'],
 *     },
 *   ]
 */
const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username|email/i).fill(process.env.PANEL_TEST_USER!);
  await page.getByLabel(/password/i).fill(process.env.PANEL_TEST_PASS!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/dashboard|home|servers/i);

  await page.context().storageState({ path: authFile });
});
