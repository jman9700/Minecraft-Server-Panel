import { test, expect } from '@playwright/test';

/**
 * The panel is a single-page app with no client-side routing: the server
 * returns index.html for every path, and views switch by clicking the
 * buttons in #tab-bar -- the URL never changes. So these tests click the
 * "Files" tab rather than navigating to "/files".
 *
 * File entries render as <span class="fname"> inside <tr>s in
 * #file-tbody, each with an inline onclick that calls loadFiles().
 * Neither those nor the breadcrumb buttons are links or ARIA "row"s, so
 * getByRole('link'|'row') does not apply.
 *
 * Back-navigation here uses the ".." row rather than the breadcrumb:
 * renderDirectory() builds the breadcrumb with `bc.innerHTML += ...` in
 * a loop, which re-parses the container each iteration and drops the
 * click handlers already attached to earlier crumb buttons -- so every
 * crumb button except the last is inert. The ".." row uses an inline
 * onclick attribute and is unaffected.
 *
 * Every test starts already logged in via the storageState saved by
 * auth.setup.ts (see playwright.config.ts).
 *
 * NOTE: relies on the index.html fix that stopped setupTabs() from
 * force-hiding the #tab-files content div. Against a panel build that
 * still has that bug, the tab renders but stays display:none and these
 * fail.
 */
test.describe('File browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app-screen')).toBeVisible();

    await page.getByRole('button', { name: 'Files' }).click();
    await expect(page.locator('#tab-files')).toBeVisible();
    // The Files tab lazy-loads its listing on click.
    await expect(page.locator('#file-tbody tr').first()).toBeVisible();
  });

  test('lists server files and folders', async ({ page }) => {
    await expect(page.locator('#file-tbody tr')).not.toHaveCount(0);
    await expect(
      page.locator('#file-tbody').getByText(/world|plugins|server\.properties|\.jar/i).first()
    ).toBeVisible();
  });

  test('navigates into a folder and back', async ({ page }) => {
    // Directories sort first and show "📁"; grab the first one.
    const folder = page.locator('#file-tbody tr').filter({ hasText: '📁' })
      .first().locator('span.fname');
    const name = (await folder.innerText()).trim().replace(/^📁\s*/, '');
    await folder.click();

    // Breadcrumb grew past the lone "root" crumb and names the folder;
    // a ".." row appears.
    await expect(page.locator('#breadcrumb button')).not.toHaveCount(1);
    await expect(page.locator('#breadcrumb')).toContainText(name);
    const parent = page.locator('#file-tbody span.fname', { hasText: /^\.\.$/ });
    await expect(parent).toBeVisible();

    // Go back up via "..".
    await parent.click();
    await expect(page.locator('#breadcrumb button')).toHaveCount(1);
    await expect(page.locator('#file-tbody span.fname', { hasText: /^\.\.$/ })).toHaveCount(0);
    await expect(page.locator('#file-tbody span.fname', { hasText: name })).toBeVisible();
  });

  test('previews a text file', async ({ page }) => {
    // server.js returns text file contents inline; renderFile() drops
    // them into #file-preview with #preview-filename set to the bare
    // basename (no icon).
    const entry = page.locator('#file-tbody span.fname')
      .filter({ hasText: /\.(properties|txt|log|json|ya?ml|toml|cfg|conf|ini)\b/i })
      .first();
    if (await entry.count() === 0) {
      test.skip(true, 'no obvious text file in this server directory');
    }
    const entryText = (await entry.innerText()).trim();
    await entry.click();

    await expect(page.locator('#file-preview')).toBeVisible();
    const previewName = (await page.locator('#preview-filename').innerText()).trim();
    expect(previewName).not.toEqual('');
    // The tbody span text is "<icon> <name>", so the preview's bare
    // basename must be a substring of it.
    expect(entryText).toContain(previewName);
  });
});
