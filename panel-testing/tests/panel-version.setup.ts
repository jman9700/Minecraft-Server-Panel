import { test as setup, expect } from '@playwright/test';
import path from 'path';

/**
 * Gate: does the panel we're testing actually run the code in this repo?
 *
 * The suite talks to a self-hosted panel over the network, so the repo
 * routinely gets ahead of the deployment. When that happens every
 * panel-side assertion fails at once and the report reads like a pile of
 * unrelated bugs. This turns that into one legible failure that names the
 * cause and the fix.
 *
 * Every other project depends on this one (directly or through `setup` /
 * `server-start`), so a stale deployment skips the whole suite instead of
 * burying the reason. Notably it also runs before server-start, so a
 * stale box never gets a Minecraft server spun up for nothing.
 *
 * The expected fingerprint comes from scripts/panel-fingerprint.js, the
 * one implementation shared with the CI workflow that waits for a staged
 * deploy to land. server.js keeps its own copy on purpose -- it
 * fingerprints itself and must stay self-contained -- so the algorithm
 * lives in exactly two places, each with a note pointing at the other.
 *
 * Escape hatch: PANEL_SKIP_VERSION_CHECK=1 to run against a knowingly
 * stale panel (e.g. checking whether an auth fix survived a deploy).
 */
// Playwright compiles these specs to CommonJS, so require() reaches the
// plain .js helper outside panel-testing/ with no module juggling.
const {
  panelFingerprint,
  PANEL_SOURCE_FILES,
} = require(path.resolve(__dirname, '..', '..', 'scripts', 'panel-fingerprint.js'));

const PANEL_ROOT = path.resolve(__dirname, '..', '..', 'minecraft-panel');

const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;

if (!USER || !PASS) {
  throw new Error(
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set: panel-testing/.env locally, ' +
      'or repository Actions secrets in CI'
  );
}

function expectedVersion() {
  return panelFingerprint(PANEL_ROOT);
}

setup('panel matches this checkout', async ({ request }) => {
  setup.skip(
    process.env.PANEL_SKIP_VERSION_CHECK === '1',
    'PANEL_SKIP_VERSION_CHECK=1 -- running against a knowingly stale panel'
  );

  const login = await request.post('/api/login', {
    data: { username: USER, password: PASS },
  });
  expect(login.status(), 'login for version check').toBe(200);
  const token = (await login.json()).token;

  const res = await request.get('/api/version', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status() === 404) {
    throw new Error(
      'The panel has no /api/version endpoint, so it predates this check entirely. ' +
        'Deploy minecraft-panel/server.js to the box and restart the panel ' +
        'process (server.js is only read at boot -- copying the file is not enough).'
    );
  }
  expect(res.status(), 'GET /api/version').toBe(200);

  const deployed = (await res.json()).version;
  const expected = expectedVersion();

  expect(
    deployed,
    `PANEL IS OUT OF DATE.\n` +
      `  deployed: ${deployed}\n` +
      `  this repo: ${expected}\n` +
      `The panel under test is running different source than this checkout, so ` +
      `panel-side failures below would be about the deployed code, not this branch.\n` +
      `Fix: copy ${PANEL_SOURCE_FILES.join(' and ')} to the box and restart the panel ` +
      `process. Set PANEL_SKIP_VERSION_CHECK=1 to run anyway.`
  ).toBe(expected);
});
