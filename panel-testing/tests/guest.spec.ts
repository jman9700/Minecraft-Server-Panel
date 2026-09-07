import { test, expect } from '@playwright/test';

/**
 * Issue #9: a guest account must not reach any privileged control.
 *
 * The panel has no "role" concept -- permissions are a flat array on the
 * user record, and both the UI (hasPerm) and the API (requirePermission)
 * gate on it. The deployed `guest` account currently holds only
 * `view_audit`, so it should see the Audit Log and nothing else
 * actionable:
 *
 *   - #control-buttons (Start / Restart / Stop / Force Kill): none render
 *   - #console-input-row: hidden (needs `console`)
 *   - Files / Users tab buttons: hidden (need browse_files / manage_users)
 *   - Console tab button: still shown (never perm-gated) but carries no
 *     controls for a guest
 *   - Audit Log tab button: shown (guest has view_audit)
 *
 * Starts from the storageState saved by guest.setup.ts -- not
 * auth.setup.ts, which is the privileged Test_Account.
 */
const USER = process.env.PANEL_GUEST_USER || 'guest';

test.describe('Guest account', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app-screen')).toBeVisible();
    await expect(page.locator('#user-display')).toHaveText(new RegExp(`^${USER}$`, 'i'));
  });

  test('has no server-control buttons', async ({ page }) => {
    await expect(page.locator('#control-buttons button')).toHaveCount(0);
    for (const label of ['Start', 'Restart', 'Stop', 'Force Kill']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('cannot send console commands', async ({ page }) => {
    await expect(page.locator('#console-input-row')).toBeHidden();
    await expect(page.locator('#console-input')).not.toBeVisible();
  });

  test('cannot reach the Files or Users tabs', async ({ page }) => {
    await expect(page.locator('#tab-files-btn')).toBeHidden();
    await expect(page.locator('#tab-users-btn')).toBeHidden();
    // "+ Add User" lives inside the Users tab and must not be reachable.
    await expect(page.getByRole('button', { name: /add user/i })).toBeHidden();
  });

  test('can view the audit log (its one permission)', async ({ page }) => {
    await expect(page.locator('#tab-audit-btn')).toBeVisible();
    await page.getByRole('button', { name: 'Audit Log' }).click();
    await expect(page.locator('#tab-audit')).toBeVisible();
    await expect(page.locator('#audit-log')).not.toHaveText('Loading...');
    // No destructive controls in that view either.
    await expect(
      page.getByRole('button', { name: /delete|clear log|purge/i })
    ).toHaveCount(0);
  });
});
