import { test, expect } from '@playwright/test';

/**
 * The console writes straight to the Minecraft server process's stdin,
 * and many of its commands take paths -- so a relative path containing
 * ".." can reach files outside config.serverDir, which is the only
 * directory this panel is supposed to touch. server.js rejects ".."
 * outright (see the "Console command guard" block there).
 *
 * Driven through the HTTP API: that's where the check lives, and it's
 * the layer an attacker would actually hit. Going through the UI would
 * only prove the browser is polite.
 *
 * Runs in the `server-running` project, which depends on
 * server-start.setup.ts -- so the Minecraft server is up and an allowed
 * command genuinely reaches its stdin rather than bouncing off
 * "Server is not running".
 *
 * Needs an account with the `console` permission (PANEL_TEST_USER has
 * it); logs in inline rather than reusing storageState because this is a
 * pure request/response check.
 */
const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;

if (!USER || !PASS) {
  throw new Error(
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set: panel-testing/.env locally, ' +
      'or repository Actions secrets in CI'
  );
}

const TRAVERSAL_ERROR = /"\.\." is not allowed/i;

test.describe('Console command guard', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: USER, password: PASS },
    });
    expect(res.status(), 'login for console-guard tests').toBe(200);
    token = (await res.json()).token;
  });

  const send = (request, command: unknown) =>
    request.post('/api/server/command', {
      headers: { Authorization: `Bearer ${token}` },
      data: { command },
    });

  for (const command of [
    '../../../etc/passwd',
    'execute run ..\\..\\secrets.txt',
    'datapack enable "file/../../outside"',
  ]) {
    test(`rejects ".." in: ${command}`, async ({ request }) => {
      const res = await send(request, command);
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toMatch(TRAVERSAL_ERROR);
    });
  }

  test('lets a command without ".." through to the server', async ({ request }) => {
    const res = await send(request, 'say hello from playwright');
    // server-start.setup.ts guarantees the server is up, so this should
    // actually reach its stdin -- not just avoid the traversal branch.
    expect(
      res.status(),
      `expected the command to be accepted, got: ${await res.text()}`
    ).toBe(200);
  });

  test('rejects an empty command without calling it a traversal', async ({ request }) => {
    const res = await send(request, '');
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/command required/i);
    expect(error).not.toMatch(TRAVERSAL_ERROR);
  });
});
