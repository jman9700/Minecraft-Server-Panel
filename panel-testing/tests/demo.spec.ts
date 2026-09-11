import { test, expect } from '@playwright/test';

/**
 * The Demo tab: a gallery of screenshots read from `demoDir`
 * (config.json, defaulting to public/demo).
 *
 * Gated behind `view_demo`, and the media itself is served through an
 * authenticated route rather than from public/ -- see modpack.spec.ts for
 * the tests covering those refusals. Because the media needs a bearer
 * token, the client fetches each image as a blob and points the <img> at
 * an object URL, so the rendered src is blob: rather than the /demo-files
 * path.
 *
 * These run against whatever the deployed panel actually has in its demo
 * directory, which may legitimately be empty. The empty state is asserted
 * unconditionally; navigation only makes sense with media present, so
 * those tests skip with a message rather than failing on a bare install.
 *
 * Starts authenticated from auth.setup.ts's storageState.
 */
test.describe('Demo tab', () => {
  test.beforeEach(async ({ page, request }) => {
    // storageState's account needs view_demo for any of this to render.
    const login = await request.post('/api/login', {
      data: { username: process.env.PANEL_TEST_USER, password: process.env.PANEL_TEST_PASS },
    });
    const perms = (await login.json()).permissions || [];
    test.skip(
      !perms.includes('view_demo'),
      `${process.env.PANEL_TEST_USER} lacks view_demo -- grant it on the panel to cover this`
    );

    await page.goto('/');
    await expect(page.locator('#app-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Demo' }).click();
    await expect(page.locator('#tab-demo')).toBeVisible();
    // loadDemo() settles data-demo-state to ready | empty | error, which
    // beats guessing whether the fetch has come back.
    await expect(page.locator('#tab-demo')).not.toHaveAttribute('data-demo-state', 'loading');
  });

  test('is reachable with view_demo', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Demo' })).toBeVisible();
    await expect(page.locator('#tab-demo')).toBeVisible();
  });

  test('lists only image files', async ({ page }) => {
    // Read the rendered thumbnails rather than page internals, so this
    // keeps working if the client variables get renamed.
    const thumbs = await page.locator('#gallery-thumbs img').all();
    for (const thumb of thumbs) {
      const name = await thumb.getAttribute('alt');
      expect(name, `${name} should be an image`).toMatch(/\.(png|jpe?g)$/i);
    }
    // README.md sits in that directory by design and must never be listed.
    const names = await page.locator('#gallery-thumbs img').evaluateAll(
      els => els.map(e => e.getAttribute('alt') || '')
    );
    expect(names.some(n => /\.md$/i.test(n))).toBe(false);
  });

  test('shows either a gallery or an explicit empty state', async ({ page }) => {
    const count = await page.locator('#gallery-thumbs img').count();
    if (count === 0) {
      await expect(page.locator('#gallery')).toBeHidden();
      await expect(page.locator('#gallery-empty')).toBeVisible();
      await expect(page.locator('#gallery-empty')).toContainText(/No demo media yet/i);
    } else {
      await expect(page.locator('#gallery')).toBeVisible();
      await expect(page.locator('#gallery-img')).toBeVisible();
      await expect(page.locator('#gallery-count')).toHaveText(`1 / ${count}`);
      await expect(page.locator('#gallery-thumbs img')).toHaveCount(count);
    }
  });

  test('the displayed image actually loads', async ({ page }) => {
    const count = await page.locator('#gallery-thumbs img').count();
    test.skip(count === 0, 'no demo media on this panel');

    // naturalWidth stays 0 for an image that failed to load, so this
    // catches a broken /demo-files route that a visibility check would not
    // -- including the token never reaching the authenticated fetch.
    await expect
      .poll(() => page.locator('#gallery-img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    // Proof the bytes came through the authenticated fetch rather than a
    // plain <img src> hitting a public path.
    await expect(page.locator('#gallery-img')).toHaveAttribute('src', /^blob:/);
  });

  test('arrows and thumbnails move through the gallery', async ({ page }) => {
    const count = await page.locator('#gallery-thumbs img').count();
    test.skip(count < 2, 'needs at least two items to navigate between');

    const name = page.locator('#gallery-name');
    const first = await name.innerText();

    await page.locator('#gallery-next').click();
    await expect(page.locator('#gallery-count')).toHaveText(`2 / ${count}`);
    await expect(name).not.toHaveText(first);

    await page.locator('#gallery-prev').click();
    await expect(page.locator('#gallery-count')).toHaveText(`1 / ${count}`);
    await expect(name).toHaveText(first);

    // Wraps backwards off the first item rather than dead-ending.
    await page.locator('#gallery-prev').click();
    await expect(page.locator('#gallery-count')).toHaveText(`${count} / ${count}`);

    await page.locator('#gallery-thumbs img').first().click();
    await expect(page.locator('#gallery-count')).toHaveText(`1 / ${count}`);
    await expect(page.locator('#gallery-thumbs img').first()).toHaveClass(/active/);
  });

  test('left and right arrow keys move through the gallery', async ({ page }) => {
    const count = await page.locator('#gallery-thumbs img').count();
    test.skip(count < 2, 'needs at least two items to navigate between');

    await page.locator('#gallery-img').click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#gallery-count')).toHaveText(`2 / ${count}`);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#gallery-count')).toHaveText(`1 / ${count}`);
  });
});
