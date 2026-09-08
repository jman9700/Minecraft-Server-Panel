import { test, expect } from '@playwright/test';

/**
 * Exercises the panel's account-lockout: server.js counts failed logins
 * per username (in memory) and, once the count reaches
 * PANEL_LOGIN_MAX_ATTEMPTS, returns HTTP 423 ("Account locked...") for
 * that username -- checked before the password, so even correct
 * credentials are refused until it expires.
 *
 * Driven through the HTTP API rather than the UI: it's a pure
 * request/response check and keeps the login count (and wall time) down.
 *
 * Each run targets a fresh throwaway username, so the only lasting effect
 * on the server is one extra locked entry in its in-memory map (cleared
 * on restart, or when PANEL_LOGIN_LOCKOUT_MINUTES elapses). Set
 * PANEL_LOGIN_LOCKOUT_MINUTES low on the test deployment to keep that
 * tidy.
 *
 * Needs PANEL_LOGIN_RATE_MAX raised on the panel: this fires
 * MAX_ATTEMPTS + 1 login requests, which with the default per-IP cap of
 * 10/min would 429 partway through when combined with the rest of the
 * suite.
 */
const MAX_ATTEMPTS = Number(process.env.PANEL_LOGIN_MAX_ATTEMPTS || 5);

test.describe('Account lockout', () => {
  test.skip(
    !Number.isInteger(MAX_ATTEMPTS) || MAX_ATTEMPTS < 1 || MAX_ATTEMPTS > 20,
    `PANEL_LOGIN_MAX_ATTEMPTS=${process.env.PANEL_LOGIN_MAX_ATTEMPTS} is missing or out of the sane 1-20 range`
  );

  test(`locks a username after ${MAX_ATTEMPTS} failed attempts`, async ({ request }) => {
    const username = `lockme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const creds = { username, password: 'definitely-wrong' };

    const post = () => request.post('/api/login', { data: creds });

    // Up to the limit: rejected as bad credentials, not yet locked.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await post();
      if (res.status() === 429) {
        throw new Error(
          'Hit the per-IP login rate limit (429) before reaching the lockout. ' +
            'Raise PANEL_LOGIN_RATE_MAX on the panel under test.'
        );
      }
      expect(res.status(), `attempt ${attempt} should be a plain rejection`).toBe(401);
    }

    // One more: now locked, with a distinct status and message.
    const locked = await post();
    expect(locked.status(), 'attempt past the limit should be locked').toBe(423);
    expect((await locked.json()).error).toMatch(/locked/i);
  });
});
