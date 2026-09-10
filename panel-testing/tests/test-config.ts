/**
 * Shared knobs for the test suite.
 */

/**
 * How long to wait for the Minecraft server to come up before giving up.
 *
 * server-start.setup.ts polls /api/status until it reports "running".
 * A modded pack is a lot slower to boot than vanilla, so this is
 * generous by default and overridable per environment via
 * PANEL_SERVER_STARTUP_SECONDS.
 */
export const SERVER_STARTUP_LENGTH_SECONDS = Number(
  process.env.PANEL_SERVER_STARTUP_SECONDS || 60
);

export const SERVER_STARTUP_LENGTH_MS = SERVER_STARTUP_LENGTH_SECONDS * 1000;

/** How often server-start.setup.ts re-checks /api/status while waiting. */
export const SERVER_STATUS_POLL_MS = 2000;

/** How long server-stop.teardown.ts waits for the server to actually stop. */
export const SERVER_SHUTDOWN_LENGTH_SECONDS = Number(
  process.env.PANEL_SERVER_SHUTDOWN_SECONDS || 60
);

export const SERVER_SHUTDOWN_LENGTH_MS = SERVER_SHUTDOWN_LENGTH_SECONDS * 1000;

/**
 * Where server-start.setup.ts records whether it was the one that started
 * the server, so server-stop.teardown.ts knows whether stopping it is its
 * business. Gitignored (see the repo root .gitignore).
 */
export const SERVER_STATE_FILE = 'playwright/.state/server.json';

export type ServerState = {
  /** True only when this run transitioned the server from stopped to running. */
  startedByTests: boolean;
};
