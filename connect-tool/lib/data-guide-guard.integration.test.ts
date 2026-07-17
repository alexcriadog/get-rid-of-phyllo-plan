// The /data-guide guard against the REAL next-auth (no mock).
//
// data-guide-guard.test.ts mocks getToken, so it pins OUR logic but proves
// nothing about the library behaviour that caused the outage. These tests pin
// that behaviour directly, and would fail if a next-auth upgrade changed it:
//
//   cookie present + no secret → THROWS MissingSecret  ← the blank 500
//   no cookie      + no secret → returns null          ← why anon looked fine
//
// AUTH_SECRET only exists in tools/docker-compose.prod.yml, so every other
// environment hit the first case for any logged-in operator.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { guardDataGuide } from './data-guide-guard';

function req(cookie?: string): NextRequest {
  return new NextRequest('https://smconnector.example.com/data-guide', {
    headers: cookie ? { cookie } : {},
  });
}

describe('next-auth getToken — the behaviour that broke /data-guide', () => {
  it('throws MissingSecret when a session cookie is present and no secret is set', async () => {
    await expect(
      getToken({ req: req('authjs.session-token=abc'), secret: undefined }),
    ).rejects.toThrow(/secret/i);
  });

  it('returns null (never throws) when there is no cookie', async () => {
    await expect(getToken({ req: req(), secret: undefined })).resolves.toBeNull();
  });
});

describe('guardDataGuide contains that failure', () => {
  const origSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    delete process.env.AUTH_SECRET;
  });

  afterEach(() => {
    if (origSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = origSecret;
    vi.restoreAllMocks();
  });

  it('answers 503 instead of crashing when a logged-in operator arrives', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await guardDataGuide(req('authjs.session-token=abc'));
    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('AUTH_SECRET');
  });

  it('still answers (never crashes) for an anonymous visitor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await guardDataGuide(req());
    // Misconfigured, so we cannot authenticate anyone — 503 is honest here
    // too; what matters is that it is a real response, not a crash.
    expect(res).not.toBeNull();
    expect([503, 307, 302]).toContain(res!.status);
  });
});
