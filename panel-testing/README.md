# mc-panel-tests

Playwright end-to-end tests for the Minecraft server management panel.

## Setup

```bash
git init
npm install
npx playwright install --with-deps chromium
cp .env.example .env   # fill in a real test account, not your main login
```

Run tests:

```bash
npm test              # headless, all tests
npm run test:headed   # watch the browser actually do it
npm run test:ui       # Playwright's interactive UI mode -- start here
npm run test:debug    # step through with the inspector
```

View the last HTML report:

```bash
npm run report
```

## Why this structure

- **`playwright.config.ts`** -- one place for base URL, timeouts, and
  which browsers to run against. `PANEL_URL` env var lets you point
  the same suite at local dev vs. the live `mc-panel.servegame.com`
  box behind Caddy.
- **`auth.setup.ts`** -- logs in once, saves the session (cookies +
  localStorage) to `playwright/.auth/user.json`, and every other spec
  reuses it. Without this, every single test would re-submit the
  login form, which is slow and also means a login bug breaks every
  test at once rather than just the login tests.
- **`login.spec.ts`** -- the one place that *doesn't* reuse the saved
  session, since it's testing the login flow itself.
- **`file-browser.spec.ts` / `audit-log.spec.ts`** -- feature tests
  against your panel's actual surface area (file listing, upload,
  download, audit trail).

## Core Playwright concepts to know

- **Locators are lazy.** `page.getByRole(...)` doesn't find anything
  until you act on it or assert against it, and it auto-retries/waits
  for the element to appear. This is why you rarely need manual
  `sleep()`/`waitForTimeout()` calls.
- **Prefer role/label/text locators over CSS classes.** `getByRole`,
  `getByLabel`, `getByText` mirror how a user or screen reader sees
  the page, and they don't break when you rename a CSS class.
- **`expect(...).toBeVisible()` etc. auto-wait and auto-retry** up to
  the test timeout, polling the assertion instead of failing instantly.
- **Traces are your debugging superpower.** With `trace: 'on-first-retry'`
  in the config, a failing test leaves a `trace.zip` you can open with
  `npx playwright show-trace` to get a full timeline, DOM snapshots,
  console logs, and network requests for that run.
- **`test.describe` / `test.beforeEach`** group related tests and
  share setup (like navigating to `/files` before each file-browser test).

## Next steps once this is running

1. Adjust every locator in the spec files to match your panel's real
   markup -- I wrote these based on plausible element names/roles for
   a login + file-browser + audit-log panel, not your actual DOM.
2. Add a fixture file at `tests/fixtures/test-config.yml` for the
   upload test.
3. Wire `auth.setup.ts` into `playwright.config.ts` as a `setup`
   project (see the comment block at the top of that file) so
   `file-browser.spec.ts` and `audit-log.spec.ts` start pre-authed.
4. Consider a GitHub Actions workflow that runs `npm test` on push,
   using repo secrets for `PANEL_TEST_USER`/`PANEL_TEST_PASS`.
