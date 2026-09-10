#!/usr/bin/env node
/**
 * Waits for the box to actually be running the commit CI just staged.
 *
 * The panel fingerprints its own source at boot and serves it at
 * /api/version. We compute the same fingerprint from this checkout and
 * poll until they agree -- which proves the box is running *this code*,
 * not merely that it is reachable. Without this the suite would race the
 * poller and fail against whatever was deployed before.
 *
 * Lives here rather than inline in the workflow so the JSON handling and
 * the error messages aren't fighting YAML and shell quoting.
 *
 * Env: PANEL_URL, PANEL_TEST_USER, PANEL_TEST_PASS, DEPLOY_WAIT_SECONDS,
 *      DEPLOY_REF (for the failure message only).
 */
const { panelFingerprint, DEFAULT_PANEL_DIR } = require("./panel-fingerprint");

const PANEL_URL = (process.env.PANEL_URL || "").replace(/\/+$/, "");
const USER = process.env.PANEL_TEST_USER;
const PASS = process.env.PANEL_TEST_PASS;
const WAIT_SECONDS = Number(process.env.DEPLOY_WAIT_SECONDS || 600);
const DEPLOY_REF = process.env.DEPLOY_REF || "deploy";
const POLL_MS = 15000;

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function login() {
  let res;
  try {
    res = await fetch(`${PANEL_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
  } catch (e) {
    fail(`Could not reach the panel at ${PANEL_URL}: ${e.message}. Is the box online?`);
  }
  if (res.status !== 200) {
    fail(
      `Login to ${PANEL_URL} returned ${res.status}. Are the 'test' environment ` +
        `secrets current? (PANEL_TEST_USER / PANEL_TEST_PASS)`
    );
  }
  const { token } = await res.json();
  if (!token) fail("Login succeeded but returned no token.");
  return token;
}

async function readVersion(token) {
  try {
    const res = await fetch(`${PANEL_URL}/api/version`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return "no-/api/version";
    if (!res.ok) return `http-${res.status}`;
    return (await res.json()).version || "unknown";
  } catch {
    return "unreachable";
  }
}

(async () => {
  if (!PANEL_URL) fail("PANEL_URL is not set.");
  if (!USER || !PASS) fail("PANEL_TEST_USER / PANEL_TEST_PASS are not set.");

  const expected = panelFingerprint(DEFAULT_PANEL_DIR);
  console.log(`Waiting for the panel to report ${expected} (up to ${WAIT_SECONDS}s).`);

  const token = await login();
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let last = "";

  while (Date.now() < deadline) {
    last = await readVersion(token);
    if (last === expected) {
      console.log(`::notice::Box is running ${expected}.`);
      return;
    }
    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`  reports ${last} -- waiting (${remaining}s left)`);
    await sleep(POLL_MS);
  }

  if (last === "no-/api/version") {
    fail(
      `The panel has no /api/version endpoint, so it predates this check. Deploy ` +
        `server.js to the box and restart the panel process (server.js is only read ` +
        `at boot -- copying the file is not enough).`
    );
  }
  fail(
    `Box never picked up the staged commit: wanted ${expected}, still ${last} after ` +
      `${WAIT_SECONDS}s. Most likely the poller is deferring because Minecraft is ` +
      `running -- it will not restart the panel mid-session. Otherwise check that ` +
      `scripts/deploy-poll.ps1 is scheduled on the box and tracking '${DEPLOY_REF}'.`
  );
})();
