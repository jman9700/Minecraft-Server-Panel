import { test, expect } from '@playwright/test';

/**
 * The audit log is a single plain-text <div id="audit-log">: loadAudit()
 * fetches /api/audit and sets el.textContent to data.lines.join("\n").
 * It is not a table, so there are no ARIA rows to query.
 *
 * Auditable actions in server.js: LOGIN_OK / LOGIN_FAILED, SERVER_*,
 * CONSOLE_CMD, USER_*. Browsing files is NOT audited.
 *
 * auth.setup.ts logs in on every run, which appends a fresh
 * "<user>: LOGIN_OK" line -- that's the entry asserted on below. Each
 * line is written as: `[<ISO timestamp>] <username>: <ACTION> <detail>`.
 *
 * Starts logged in via the storageState from auth.setup.ts.
 */
const USER = process.env.PANEL_TEST_USER!;

test.describe('Audit log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app-screen')).toBeVisible();

    await page.getByRole('button', { name: 'Audit Log' }).click();
    await expect(page.locator('#tab-audit')).toBeVisible();
    // loadAudit() replaces the "Loading..." placeholder once it resolves.
    await expect(page.locator('#audit-log')).not.toHaveText('Loading...');
  });

  test("records this session's login", async ({ page }) => {
    await expect(page.locator('#audit-log')).toContainText(
      new RegExp(`${USER}: LOGIN_OK`, 'i')
    );
  });

  // Not sure if the method that this is using is thourough enough to catch all destructive controls, but it should be good enough for now.
  // in the furture, a more exhaustive list of destructive controls should be maintained and checked against, but for now this is a good start.
  test('exposes no destructive controls', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /delete|clear log|purge/i })
    ).toHaveCount(0);

    // Need to check for links too, since the audit log is a <div> and not a table.
    await expect(
      page.getByRole('link', { name: /delete|clear log|purge/i })
    ).toHaveCount(0);
  });
});
