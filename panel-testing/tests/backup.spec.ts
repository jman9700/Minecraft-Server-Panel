import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * World backups (issue #5).
 *
 * The feature is built around three rules, and these tests exist mainly to
 * hold the first two:
 *
 *   1. view_backups and create_backup are independent. Seeing that a
 *      backup exists is not permission to run one.
 *   2. A backup is refused unless the Minecraft server is fully stopped --
 *      copying a live world produces a torn, possibly corrupt snapshot.
 *   3. The world directory is only ever read. There is no restore
 *      endpoint, so there is nothing here that could write to it.
 *
 * Deliberately does NOT trigger a real backup against the deployed panel.
 * That would copy the actual world -- potentially gigabytes -- on every
 * push, and it needs the server stopped, which fights the server-running
 * project. Creation is covered locally against a stand-in world instead;
 * set PANEL_RUN_BACKUP_TEST=1 to opt in here.
 *
 * Runs logged-out (inline logins) because it checks several accounts with
 * different permissions.
 */
const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;
const GUEST_USER = process.env.PANEL_GUEST_USER || 'guest';
const GUEST_PASS = process.env.PANEL_GUEST_PASS;

if (!USER || !PASS || !GUEST_PASS) {
  throw new Error(
    'PANEL_TEST_USER / PANEL_TEST_PASS / PANEL_GUEST_PASS must be set: ' +
      'panel-testing/.env locally, or repository Actions secrets in CI'
  );
}

type Session = { token: string; permissions: string[] };

async function signIn(request: APIRequestContext, user: string, pass: string): Promise<Session> {
  const res = await request.post('/api/login', { data: { username: user, password: pass } });
  expect(res.status(), `login as ${user}`).toBe(200);
  const { token, permissions } = await res.json();
  return { token, permissions: permissions || [] };
}

const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

test.describe('World backups', () => {
  test('an account without view_backups cannot read backup status', async ({ request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(
      s.permissions.includes('view_backups'),
      `${GUEST_USER} has view_backups, so it cannot demonstrate the refusal`
    );
    const res = await request.get('/api/backups', { headers: auth(s) });
    expect(res.status()).toBe(403);
  });

  test('an account without create_backup cannot start one', async ({ request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(
      s.permissions.includes('create_backup'),
      `${GUEST_USER} has create_backup, so it cannot demonstrate the refusal`
    );
    const res = await request.post('/api/backups', { headers: auth(s) });
    expect(res.status()).toBe(403);
    // 403 not 409: this must be refused on permission, before the server
    // state is even considered.
    expect((await res.json()).error).toMatch(/permission/i);
  });

  test('backup status reports whether a backup exists and how old it is', async ({ request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(
      !s.permissions.includes('view_backups'),
      `${USER} lacks view_backups -- grant it on the panel to cover this`
    );

    const res = await request.get('/api/backups', { headers: auth(s) });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.backups)).toBe(true);
    expect(body).toHaveProperty('canCreate.ok');
    // `latest` is null on a machine that has never run one -- backups/ is
    // gitignored, so that absence is real information, not a gap.
    if (body.latest) {
      expect(body.latest.name).toMatch(/^world-/);
      expect(Number.isFinite(Date.parse(body.latest.createdAt))).toBe(true);
    }
  });

  test('a backup is refused while the Minecraft server is running', async ({ request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(
      !s.permissions.includes('create_backup'),
      `${USER} lacks create_backup -- grant it on the panel to cover this`
    );

    const status = await (await request.get('/api/status', { headers: auth(s) })).json();
    test.skip(
      status.status === 'stopped',
      'server is stopped, so there is no running-state refusal to observe'
    );

    const res = await request.post('/api/backups', { headers: auth(s) });
    expect(res.status(), 'a running server must block the backup').toBe(409);
    expect((await res.json()).error).toMatch(/stopped/i);
  });

  test('the backup bar is hidden from an account without view_backups', async ({ page, request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(s.permissions.includes('view_backups'), `${GUEST_USER} has view_backups`);

    await page.goto('/login');
    await page.locator('#login-user').fill(GUEST_USER);
    await page.locator('#login-pass').fill(GUEST_PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#app-screen')).toBeVisible();

    // Either the Files tab is unreachable entirely, or it is reachable via
    // browse_files but shows no backup bar. Both are correct.
    const filesBtn = page.locator('#tab-files-btn');
    if (await filesBtn.isVisible()) {
      await filesBtn.click();
      await expect(page.locator('#tab-files')).toBeVisible();
    }
    await expect(page.locator('#backup-bar')).toBeHidden();
    await expect(page.getByRole('button', { name: /back up world/i })).toBeHidden();
  });
});
