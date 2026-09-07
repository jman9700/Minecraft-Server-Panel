import { defineConfig, devices } from '@playwright/test';

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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment as needed once the core suite is stable
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
