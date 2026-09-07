import { test, expect } from '@playwright/test';

test.describe('Audit log', () => {
  test('records a file action as an audit entry', async ({ page }) => {
    // Trigger something auditable first -- here, navigating the file
    // browser, which your panel logs.
    await page.goto('/files');
    await page.getByRole('link', { name: /plugins/i }).first().click();

    // Then check the audit log picked it up.
    await page.goto('/audit-log');
    const latestEntry = page.getByRole('row').first();
    await expect(latestEntry).toContainText(/plugins/i);
    await expect(latestEntry).toContainText(process.env.PANEL_TEST_USER!);
  });

  test('audit log is read-only for non-admin roles', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('button', { name: /delete|clear log/i })).toHaveCount(0);
  });
});
