import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// Storage-state files produced by the *.setup.ts specs. Keep these paths
// in sync with the ones in those files.
const authFile = 'playwright/.auth/user.json';        // privileged Test_Account
const guestAuthFile = 'playwright/.auth/guest.json';  // low-privilege guest

/**
 * Playwright config for the Minecraft panel.
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI if you want, keep local parallel
  workers: process.env.CI ? 1 : undefined,

  reporter: 'html',

  use: {
    // Point this at your panel. Use an env var so you can swap
    // between local dev, staging, and mc-panel.servegame.com.
    baseURL: process.env.PANEL_URL || 'https://mc-panel.servegame.com',

    // Capture a trace only when a test fails, then inspect with
    // `npx playwright show-trace trace.zip`
    trace: 'on-first-retry',

    // Screenshot only on failure keeps the report readable
    screenshot: 'only-on-failure',

    // Since this is a self-hosted box behind Caddy with your own
    // DuckDNS domain, you likely have a valid cert already. If you
    // ever test against a self-signed cert locally, flip this on:
    // ignoreHTTPSErrors: true,
  },

  projects: [
    // Logs in once per account and writes the JWT (localStorage
    // ["mcp_token"]) to a storageState file. Matched by filename, so the
    // default *.spec.ts projects never pick these up.
    { name: 'setup', testMatch: /(auth|guest)\.setup\.ts/ },

    // Auth-surface specs that run logged OUT -- the login flow and the
    // account-lockout check. No storageState, no dependency on `setup`.
    {
      name: 'logged-out',
      testMatch: /(login|lockout|session-isolation|console-guard)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // Guest permission checks -- authenticated as the low-privilege guest
    // from guest.setup.ts.
    {
      name: 'guest',
      testMatch: /guest\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: guestAuthFile },
      dependencies: ['setup'],
    },

    // Everything else starts already authenticated as Test_Account.
    {
      name: 'chromium',
      testIgnore: /(login|guest|lockout|session-isolation|console-guard)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: authFile },
      dependencies: ['setup'],
    },
    // Uncomment as needed once the core suite is stable
    // { name: 'firefox', use: { ...devices['Desktop Firefox'], storageState: authFile }, dependencies: ['setup'] },
    // { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: authFile }, dependencies: ['setup'] },
  ],
});
