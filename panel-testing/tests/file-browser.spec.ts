import { test, expect } from '@playwright/test';

/**
 * These assume the 'chromium' project is configured with the saved
 * storageState from auth.setup.ts (see the note in that file), so
 * every test here starts already logged in.
 */

test.describe('File browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/files');
  });

  test('lists server files and folders', async ({ page }) => {
    // getByRole('row') works well if your file list is a <table>.
    // Swap for a different locator if it's a div-based grid.
    await expect(page.getByRole('row')).toHaveCount(await page.getByRole('row').count());
    await expect(page.getByText(/world|plugins|server\.properties/i).first()).toBeVisible();
  });

  test('navigates into a folder and back', async ({ page }) => {
    const folder = page.getByRole('link', { name: /plugins/i }).first();
    await folder.click();

    await expect(page).toHaveURL(/plugins/);

    // Breadcrumb / back navigation
    await page.getByRole('link', { name: /files|root|home/i }).first().click();
    await expect(page).toHaveURL(/\/files\/?$/);
  });

  test('uploads a file', async ({ page }) => {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /upload/i }).click();
    const fileChooser = await fileChooserPromise;

    // Point this at a small fixture file you keep in the repo,
    // e.g. tests/fixtures/test-config.yml
    await fileChooser.setFiles('tests/fixtures/test-config.yml');

    await expect(page.getByText('test-config.yml')).toBeVisible();
  });

  test('downloads a file', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('row', { name: /server\.properties/i })
      .getByRole('button', { name: /download/i })
      .click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('server.properties');
  });
});
