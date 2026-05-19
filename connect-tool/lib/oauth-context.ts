// Verify the SDK JWT against the POC backend and manage the per-popup
// cookie that carries the OAuth-context sessionId from /api/oauth/start
// through the platform OAuth round-trip and into the final seed POST.
//
// The cookie is HttpOnly (so client JS can't read it) and SameSite=Lax
// (so it survives the OAuth redirect chain from external providers).
// It's deliberately short-lived to match session.ts TTL.

import axios from 'axios';
import type { NextRequest, NextResponse } from 'next/server';

export const CONNECT_CONTEXT_COOKIE = 'camaleonic_connect_session';
const COOKIE_TTL_SECONDS = 10 * 60;

export interface SdkTokenClaims {
  /** Workspace id (opaque internal ref). */
  ws: string;
  /** Workspace slug — matches the `?ws=<slug>` popup URL. */
  ws_slug: string;
  sub: string;
  platforms?: ReadonlyArray<string>;
  /** 'test' → account will be marked is_test on seed (no webhooks). */
  env?: 'live' | 'test';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Posts the JWT to POC's /internal/sdk-tokens/verify and returns the
 * decoded claims. Throws on tamper/expiry/missing-claim.
 */
export async function verifySdkToken(token: string): Promise<SdkTokenClaims> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) {
    throw new Error('POC_API_URL is not configured for connect-tool');
  }
  const res = await axios.post<{ claims: SdkTokenClaims }>(
    `${baseUrl}/internal/sdk-tokens/verify`,
    { token },
    {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
      // Bypass any HTTPS_PROXY env — see seed-client.ts for the rationale.
      proxy: false,
      // Don't auto-throw on non-2xx; we want to surface the upstream message.
      validateStatus: () => true,
    },
  );
  if (res.status !== 200) {
    const upstream =
      (res.data as unknown as { message?: string })?.message ??
      `HTTP ${res.status}`;
    throw new Error(`SDK token verify failed: ${upstream}`);
  }
  return res.data.claims;
}

/**
 * Set the connect-context cookie on the response. Pass `null` to clear it
 * (e.g. on legacy single-tenant flows that explicitly disown any prior
 * SDK context).
 */
export function setContextCookie(
  res: NextResponse,
  sessionId: string | null,
): void {
  if (sessionId === null) {
    res.cookies.set(CONNECT_CONTEXT_COOKIE, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 0,
    });
    return;
  }
  res.cookies.set(CONNECT_CONTEXT_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_TTL_SECONDS,
  });
}

/**
 * Read the connect-context sessionId from the request cookie. Returns
 * null when the header is absent or the cookie was cleared.
 */
export function getContextCookie(req: NextRequest): string | null {
  const v = req.cookies.get(CONNECT_CONTEXT_COOKIE)?.value;
  return v && v.length > 0 ? v : null;
}
