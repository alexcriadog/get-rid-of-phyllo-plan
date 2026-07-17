// Regression tests for the /data-guide operator-session guard.
//
// AUTH_SECRET is only wired in tools/docker-compose.prod.yml — it is absent
// from connect-tool/.env and from the base poc/docker-compose.yml. Without it
// `getToken` THROWS MissingSecret the moment a session cookie is present (it
// returns null when there is no cookie), so a logged-in operator got a blank
// 500 while anonymous requests redirected normally — which hid the fault.
// See ./data-guide-guard.integration.test.ts, which pins that library
// behaviour against the real next-auth rather than the mock used here.
//
// The guard must never crash the middleware:
//  - missing secret → explicit 503 with a diagnosable message (no crash)
//  - getToken throwing → treated as unauthenticated (redirect to login)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));

import { guardDataGuide } from './data-guide-guard';

function req(cookie?: string): NextRequest {
  return new NextRequest('https://smconnector.example.com/data-guide', {
    headers: cookie ? { cookie } : {},
  });
}

describe('guardDataGuide', () => {
  const origSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    getTokenMock.mockReset();
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (origSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = origSecret;
    vi.restoreAllMocks();
  });

  it('allows the request when the session token is valid', async () => {
    getTokenMock.mockResolvedValue({ sub: 'operator@example.com' });
    const res = await guardDataGuide(req('__Secure-authjs.session-token=x'));
    expect(res).toBeNull();
  });

  it('redirects to /login when there is no session', async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await guardDataGuide(req());
    expect(res).not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(300);
    expect(res!.status).toBeLessThan(400);
    const location = res!.headers.get('location')!;
    expect(location).toContain('/login');
    expect(location).toContain('callbackUrl=/data-guide');
  });

  it('returns an explicit 503 (never a crash) when AUTH_SECRET is missing', async () => {
    delete process.env.AUTH_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await guardDataGuide(req('__Secure-authjs.session-token=x'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('AUTH_SECRET');
    expect(errorSpy).toHaveBeenCalled();
    // getToken must not even be attempted without a secret — it throws.
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('treats an empty-string AUTH_SECRET as missing (compose ${VAR} fallback)', async () => {
    process.env.AUTH_SECRET = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await guardDataGuide(req('__Secure-authjs.session-token=x'));
    expect(res!.status).toBe(503);
  });

  it('redirects to /login when getToken throws (fail-safe, no 500)', async () => {
    getTokenMock.mockRejectedValue(new Error('JWEDecryptionFailed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await guardDataGuide(req('__Secure-authjs.session-token=broken'));
    expect(res).not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(300);
    expect(res!.status).toBeLessThan(400);
    expect(res!.headers.get('location')).toContain('/login');
    expect(errorSpy).toHaveBeenCalled();
  });
});
