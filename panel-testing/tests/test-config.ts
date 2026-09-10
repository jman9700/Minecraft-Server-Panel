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
