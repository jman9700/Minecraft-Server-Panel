import { test as teardown, expect, type APIRequestContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  SERVER_SHUTDOWN_LENGTH_MS,
  SERVER_SHUTDOWN_LENGTH_SECONDS,
  SERVER_STATUS_POLL_MS,
  SERVER_STATE_FILE,
  type ServerState,
} from './test-config';

/**
 * The closing half of the start/stop bookend. playwright.config.ts hangs
 * this off the `server-start` project via `teardown:`, so Playwright runs
 * it once server-start and every project depending on it have finished --
 * whether those passed or failed.
 *
 * It only stops a server that server-start.setup.ts actually started
 * (recorded in SERVER_STATE_FILE). If the server was already up when the
 * run began, it stays up.
 *
 * That restraint is deliberate: this suite runs on every push, and the
 * panel points at a real game server. Unconditionally shutting it down at
 * teardown would kick players off a server the run never started. Leaving
 * things as we found them still stops it in the normal CI case, where the
 * server begins stopped.
 *
 * Stopping needs the `kill` permission, which PANEL_TEST_USER has.
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

function readState(): ServerState {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ServerState;
  } catch {
    // No marker means server-start never claimed ownership.
    return { startedByTests: false };
  }
}

async function readStatus(request: APIRequestContext, auth: Record<string, string>) {
  const res = await request.get('/api/status', { headers: auth });
  expect(res.status(), 'GET /api/status').toBe(200);
  return (await res.json()) as { status: string; output: string[] };
}

teardown('minecraft server is stopped', async ({ request }) => {
  teardown.setTimeout(SERVER_SHUTDOWN_LENGTH_MS + 30_000);

  const { startedByTests } = readState();
  fs.rmSync(stateFile, { force: true });

  if (!startedByTests) {
    teardown.skip(true, 'server was already running before this run -- leaving it up');
  }

  const login = await request.post('/api/login', {
    data: { username: USER, password: PASS },
  });
  expect(login.status(), 'login for server stop').toBe(200);
  const auth = { Authorization: `Bearer ${(await login.json()).token}` };

  if ((await readStatus(request, auth)).status === 'stopped') {
    return; // Already down -- it may have crashed during the run.
  }

  const stop = await request.post('/api/server/stop', { headers: auth });
  if (!stop.ok()) {
    const { error } = await stop.json();
    // Racing with a crash is fine; anything else is worth surfacing.
    if (!/not running/i.test(error ?? '')) {
      throw new Error(`Could not stop the Minecraft server: ${error}`);
    }
    return;
  }

  const deadline = Date.now() + SERVER_SHUTDOWN_LENGTH_MS;
  let last = { status: 'unknown', output: [] as string[] };

  while (Date.now() < deadline) {
    last = await readStatus(request, auth);
    if (last.status === 'stopped') return;
    await new Promise(resolve => setTimeout(resolve, SERVER_STATUS_POLL_MS));
  }

  throw new Error(
    `Minecraft server was still "${last.status}" ${SERVER_SHUTDOWN_LENGTH_SECONDS}s after ` +
      `the stop request. Raise PANEL_SERVER_SHUTDOWN_SECONDS if saving the world just ` +
      `takes longer. Last output:\n${last.output.slice(-15).join('\n')}`
  );
});
