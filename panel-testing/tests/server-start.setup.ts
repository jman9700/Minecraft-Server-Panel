import { test as setup, expect, type APIRequestContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  SERVER_STARTUP_LENGTH_MS,
  SERVER_STARTUP_LENGTH_SECONDS,
  SERVER_STATUS_POLL_MS,
  SERVER_STATE_FILE,
  type ServerState,
} from './test-config';

/**
 * Brings the Minecraft server up so specs that need a live server can
 * run. Wired as the `server-start` project; anything depending on a
 * running server declares `dependencies: ['server-start']` in
 * playwright.config.ts (currently just console-guard.spec.ts).
 *
 * Paired with server-stop.teardown.ts via the project's `teardown`, so
 * the two bookend the dependent specs: start -> specs -> stop. Playwright
 * runs the teardown once this project and everything depending on it has
 * finished, pass or fail.
 *
 * If the server is already up this is a no-op, so it's safe to run
 * repeatedly. It records which of those two happened in
 * SERVER_STATE_FILE, so the teardown only stops a server this run
 * actually started -- see that file for why.
 *
 * mcStatus only flips to "running" when the server prints its
 * "Done (...)! For help, type ..." line, so a pack that doesn't print it
 * will sit in "starting" until SERVER_STARTUP_LENGTH_SECONDS runs out.
 * The timeout error includes the tail of the console output so you can
 * see how far it got.
 */
const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;

if (!USER || !PASS) {
  throw new Error(
    'PANEL_TEST_USER and PANEL_TEST_PASS must be set: panel-testing/.env locally, ' +
      'or repository Actions secrets in CI'
  );
}

const stateFile = path.resolve(__dirname, '..', SERVER_STATE_FILE);

function recordState(state: ServerState) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

type Status = { status: string; output: string[] };

async function readStatus(request: APIRequestContext, auth: Record<string, string>) {
  const res = await request.get('/api/status', { headers: auth });
  expect(res.status(), 'GET /api/status').toBe(200);
  return (await res.json()) as Status;
}

setup('minecraft server is running', async ({ request }) => {
  // The poll loop can legitimately run the full startup window.
  setup.setTimeout(SERVER_STARTUP_LENGTH_MS + 30_000);

  // Assume we didn't start it until we know otherwise -- a crash midway
  // through should never leave the teardown thinking it owns the server.
  recordState({ startedByTests: false });

  const login = await request.post('/api/login', {
    data: { username: USER, password: PASS },
  });
  expect(login.status(), 'login for server start').toBe(200);
  const auth = { Authorization: `Bearer ${(await login.json()).token}` };

  if ((await readStatus(request, auth)).status === 'running') {
    return; // Already up -- not ours to stop.
  }

  const start = await request.post('/api/server/start', { headers: auth });
  if (!start.ok()) {
    const { error } = await start.json();
    // Another run may have started it in the gap since we checked -- in
    // which case it isn't ours to stop either.
    if (!/already running/i.test(error ?? '')) {
      throw new Error(`Could not start the Minecraft server: ${error}`);
    }
    return;
  }

  recordState({ startedByTests: true });

  const deadline = Date.now() + SERVER_STARTUP_LENGTH_MS;
  let last: Status = { status: 'unknown', output: [] };

  while (Date.now() < deadline) {
    last = await readStatus(request, auth);
    if (last.status === 'running') return;

    // startServer() sets "starting"; the process dying puts it back to
    // "stopped", which means the launch failed rather than being slow.
    if (last.status === 'stopped') {
      throw new Error(
        `Minecraft server went back to "stopped" while starting. Last output:\n` +
          last.output.slice(-15).join('\n')
      );
    }
    await new Promise(resolve => setTimeout(resolve, SERVER_STATUS_POLL_MS));
  }

  throw new Error(
    `Minecraft server was still "${last.status}" after ` +
      `${SERVER_STARTUP_LENGTH_SECONDS}s. Raise PANEL_SERVER_STARTUP_SECONDS if the ` +
      `pack just needs longer. Last output:\n${last.output.slice(-15).join('\n')}`
  );
});
