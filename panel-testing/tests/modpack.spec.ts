import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Modpack download, and the permission gates around it and the Demo tab.
 *
 * Both are behind permissions AND behind login. That distinction matters:
 * demo media used to live under public/, which the panel serves
 * unauthenticated, so the files were fetchable by URL with no account at
 * all -- a permission on the tab alone would not have closed it. The
 * "without any token" case below is the regression test for that.
 *
 * The modpack export is manifest-only (project/file IDs plus config
 * overrides, no mod jars), so hosting it raises no redistribution
 * question. Details shown in the UI are parsed out of manifest.json by a
 * dependency-free zip reader in server.js.
 *
 * Runs logged-out because it compares several accounts.
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

test.describe('Demo media is not public', () => {
  test('demo media cannot be fetched without a token at all', async ({ request }) => {
    // The regression that matters: this used to be served from public/
    // and returned 200 to anyone.
    const res = await request.get('/demo-files/anything.png');
    expect(res.status(), 'unauthenticated demo media must not be served').toBe(401);
  });

  test('an account without view_demo is refused demo media and its listing', async ({ request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(s.permissions.includes('view_demo'), `${GUEST_USER} has view_demo`);

    expect((await request.get('/api/demo/media', { headers: auth(s) })).status()).toBe(403);
    expect((await request.get('/demo-files/anything.png', { headers: auth(s) })).status()).toBe(403);
  });

  test('the Demo tab is hidden from an account without view_demo', async ({ page, request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(s.permissions.includes('view_demo'), `${GUEST_USER} has view_demo`);

    await page.goto('/login');
    await page.locator('#login-user').fill(GUEST_USER);
    await page.locator('#login-pass').fill(GUEST_PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#app-screen')).toBeVisible();
    await expect(page.locator('#tab-demo-btn')).toBeHidden();
  });
});

test.describe('Modpack download', () => {
  test('an account without download_pack is refused', async ({ request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(s.permissions.includes('download_pack'), `${GUEST_USER} has download_pack`);

    const list = await request.get('/api/packs', { headers: auth(s) });
    expect(list.status()).toBe(403);
    const dl = await request.get('/api/packs/anything.zip/download', { headers: auth(s) });
    expect(dl.status()).toBe(403);
  });

  test('the Modpack tab is hidden without download_pack', async ({ page, request }) => {
    const s = await signIn(request, GUEST_USER, GUEST_PASS);
    test.skip(s.permissions.includes('download_pack'), `${GUEST_USER} has download_pack`);

    await page.goto('/login');
    await page.locator('#login-user').fill(GUEST_USER);
    await page.locator('#login-pass').fill(GUEST_PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#app-screen')).toBeVisible();
    await expect(page.locator('#tab-pack-btn')).toBeHidden();
  });

  test('the listing reports what the manifest says', async ({ request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(
      !s.permissions.includes('download_pack'),
      `${USER} lacks download_pack -- grant it on the panel to cover this`
    );

    const res = await request.get('/api/packs', { headers: auth(s) });
    expect(res.status()).toBe(200);
    const { packs } = await res.json();
    expect(Array.isArray(packs)).toBe(true);

    for (const p of packs) {
      expect(p.name).toMatch(/\.zip$/i);
      expect(p.sizeBytes).toBeGreaterThan(0);
      // A readable CurseForge export yields a version and a mod count. If
      // the manifest could not be parsed the reason is surfaced instead of
      // the fields silently coming back null.
      if (!p.manifestError) {
        expect(p.minecraft, `${p.name} should report a Minecraft version`).toBeTruthy();
        expect(p.modCount, `${p.name} should report a mod count`).toBeGreaterThan(0);
      }
    }
  });

  test('a pack downloads intact, and traversal is refused', async ({ request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(!s.permissions.includes('download_pack'), `${USER} lacks download_pack`);

    const { packs } = await (await request.get('/api/packs', { headers: auth(s) })).json();
    test.skip(packs.length === 0, 'no modpack export on this panel');

    const pack = packs[0];
    const res = await request.get(`/api/packs/${encodeURIComponent(pack.name)}/download`, {
      headers: auth(s),
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain(pack.name);
    // Byte count matches the listing, so the file is served whole.
    expect((await res.body()).length).toBe(pack.sizeBytes);

    // basename() strips the directory part, so this can never reach
    // config.json next door.
    const traversal = await request.get(
      `/api/packs/${encodeURIComponent('../config.json')}/download`,
      { headers: auth(s) }
    );
    expect(traversal.status(), 'traversal must not resolve').toBe(400);
  });

  test('drift is reported against the server mods directory', async ({ request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(!s.permissions.includes('download_pack'), `${USER} lacks download_pack`);

    const { packs } = await (await request.get('/api/packs', { headers: auth(s) })).json();
    test.skip(packs.length === 0, 'no modpack export on this panel');

    const drift = packs[0].drift;
    expect(drift, 'every pack should carry a drift verdict').toBeTruthy();

    if (!drift.checked) {
      // Can't see mods/ -- must say so rather than implying the pack is fine.
      expect(drift.reason).toBeTruthy();
      expect(drift.stale).toBeUndefined();
      return;
    }

    expect(typeof drift.stale).toBe('boolean');
    expect(drift.serverModCount).toBeGreaterThanOrEqual(0);
    expect(drift.message).toBeTruthy();

    // Staleness comes from timestamps, never from comparing counts: a pack
    // carries client-only mods the server never has, so the two differing
    // must not on its own mark it stale.
    if (drift.changedSinceExport === 0) {
      expect(drift.stale, 'nothing changed since export, so not stale').toBe(false);
    } else {
      expect(drift.stale).toBe(true);
      expect(drift.changedFiles.length).toBeGreaterThan(0);
      for (const f of drift.changedFiles) expect(f).toMatch(/\.jar$/i);
    }
  });

  test('the tab shows a drift verdict beside the pack', async ({ page, request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(!s.permissions.includes('download_pack'), `${USER} lacks download_pack`);

    await page.goto('/login');
    await page.locator('#login-user').fill(USER);
    await page.locator('#login-pass').fill(PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#app-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Modpack' }).click();
    await expect(page.locator('#tab-pack')).not.toHaveAttribute('data-pack-state', 'loading');

    const state = await page.locator('#tab-pack').getAttribute('data-pack-state');
    test.skip(state !== 'ready', 'no modpack export on this panel');

    const bar = page.locator('.drift-bar').first();
    await expect(bar).toBeVisible();
    // Whatever the verdict, it must be an actual verdict -- never blank.
    await expect(bar).not.toHaveText('');
  });

  test('the Modpack tab shows the pack with details from the manifest', async ({ page, request }) => {
    const s = await signIn(request, USER, PASS);
    test.skip(!s.permissions.includes('download_pack'), `${USER} lacks download_pack`);

    await page.goto('/login');
    await page.locator('#login-user').fill(USER);
    await page.locator('#login-pass').fill(PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#app-screen')).toBeVisible();

    await page.getByRole('button', { name: 'Modpack' }).click();
    await expect(page.locator('#tab-pack')).not.toHaveAttribute('data-pack-state', 'loading');

    const state = await page.locator('#tab-pack').getAttribute('data-pack-state');
    if (state === 'empty') {
      await expect(page.locator('#pack-list')).toContainText(/No modpack export here yet/i);
      return;
    }
    await expect(page.locator('.pack-card').first()).toBeVisible();
    await expect(page.locator('.pack-card').first().getByRole('button', { name: 'Download' }))
      .toBeVisible();
  });
});
