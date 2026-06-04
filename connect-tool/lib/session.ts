// Redis-backed session store for OAuth flows that need a confirmation
// step (product picker for all 5 platforms; page picker for FB).
//
// Why: between the OAuth callback (which has the freshly-exchanged
// access token) and the seed POST (where the operator confirms which
// products to enable) we need to remember the token + preview info. But
// we MUST NOT persist it to disk — it's a transient bridge.
//
// TTL is 10 minutes (Redis-native PX expiry); the operator should pick
// within that window. After expiration the key is gone and the operator
// must restart OAuth.
//
// Why Redis (not the old in-memory Map): connect-tool must be stateless
// so it can run behind a load balancer — the OAuth callback may land on
// a different instance than the one that started the flow. The shared
// Redis (same instance POC uses) gives every instance the same view.

import { randomBytes } from 'node:crypto';
import type { SeedBody } from './seed-client';
import { getRedis } from './redis';

const TTL_MS = 10 * 60 * 1000;
const KEY_PREFIX = 'session:';

export interface FbPageInSession {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

/**
 * Tenant context captured at /api/oauth/start and copied onto the result
 * session at the callback. Lets the seed handlers read workspace/end-user
 * WITHOUT depending on the context cookie — which is withheld when the
 * connect-ui runs inside a third-party iframe (SameSite=Lax).
 */
export interface SessionContext {
  workspaceId: string;
  endUserId: string;
  environment?: 'live' | 'test';
  openerOrigin?: string;
  workspaceSlug?: string;
  /** Per-connection product scope from the SDK token; clamps the seed enrol. */
  connectionProducts?: Record<string, ReadonlyArray<string>>;
}

/** FB sessions are special — they need a Page picker before seeding. */
export interface FbSession {
  kind: 'fb';
  userToken: string;
  pages: FbPageInSession[];
  ctx?: SessionContext;
  createdAt: number;
}

/**
 * "Simple" sessions for TikTok/Threads/YouTube/Instagram — the OAuth
 * flow already discovered a single account; we just need the operator
 * to pick which products to seed before posting to POC.
 *
 * `seedBody` is the body that will be sent to /admin/connect/seed once
 * the operator confirms; the picker injects `metadata.products`.
 */
export interface SimpleSession {
  kind: 'simple';
  platform: 'tiktok' | 'threads' | 'youtube' | 'instagram' | 'twitch' | 'linkedin';
  seedBody: SeedBody;
  /**
   * LinkedIn: organization accounts discovered via organizationAcls,
   * seeded alongside the member account with the same product selection.
   */
  extraSeedBodies?: SeedBody[];
  preview: {
    handle?: string;
    name?: string;
    extras?: Record<string, unknown>;
  };
  ctx?: SessionContext;
  createdAt: number;
}

/**
 * Per-OAuth-flow tenant context, populated at /api/oauth/start when the
 * popup is launched via the Camaleonic Connect SDK (carries ?ws=<slug>&
 * token=<jwt>). Stashed under a fresh sessionId stored on a cookie so the
 * downstream /api/seed-confirm + /api/seed-pages handlers can inject
 * workspace_id + end_user_id into the POC seed body without the operator
 * having to plumb them through the picker URL.
 *
 * Absent → legacy single-tenant flow continues (account lands on the
 * "demo" workspace via the backend's default).
 */
export interface OAuthContextSession {
  kind: 'oauth-context';
  workspaceId: string;
  workspaceSlug: string;
  endUserId: string;
  allowedPlatforms?: ReadonlyArray<string>;
  /** Per-connection product scope (SDK token `products` claim). */
  connectionProducts?: Record<string, ReadonlyArray<string>>;
  /** Test-mode flag derived from the SDK token; threaded into the seed POST. */
  environment?: 'live' | 'test';
  /**
   * Origin of the page that opened the popup, used to scope the
   * `postMessage` reply on the success page. When absent we fall back to
   * `*` (less strict, but the only option when an operator opened the
   * page directly).
   */
  openerOrigin?: string;
  /** True when the OAuth window was launched from the embedded iframe modal.
   *  Drives the callback to redirect to the /oauth/complete relay page. */
  embedded?: boolean;
  createdAt: number;
}

export type Session = FbSession | SimpleSession | OAuthContextSession;

export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}

function redisKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

// Distributive omit so the discriminated union stays intact (TS doesn't
// preserve discrimination through a vanilla Omit<Session, ...>).
type PutSessionInput =
  | Omit<FbSession, 'createdAt'>
  | Omit<SimpleSession, 'createdAt'>
  | Omit<OAuthContextSession, 'createdAt'>;

export async function putSession(session: PutSessionInput): Promise<string> {
  const id = newSessionId();
  const payload: Session = { ...session, createdAt: Date.now() } as Session;
  await getRedis().set(redisKey(id), JSON.stringify(payload), 'PX', TTL_MS);
  return id;
}

export async function getSession(id: string): Promise<Session | null> {
  if (!id) return null;
  const raw = await getRedis().get(redisKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    // Defensive: a value with no recognised discriminator is corrupt.
    if (
      parsed.kind === 'fb' ||
      parsed.kind === 'simple' ||
      parsed.kind === 'oauth-context'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convenience: returns the session only if it's of the FB shape. */
export async function getFbSession(id: string): Promise<FbSession | null> {
  const s = await getSession(id);
  return s && s.kind === 'fb' ? s : null;
}

/** Convenience: returns the session only if it's a simple-platform shape. */
export async function getSimpleSession(
  id: string,
): Promise<SimpleSession | null> {
  const s = await getSession(id);
  return s && s.kind === 'simple' ? s : null;
}

/** Convenience: returns the session only if it's the SDK OAuth context shape. */
export async function getOAuthContextSession(
  id: string,
): Promise<OAuthContextSession | null> {
  const s = await getSession(id);
  return s && s.kind === 'oauth-context' ? s : null;
}

export async function dropSession(id: string): Promise<void> {
  if (!id) return;
  await getRedis().del(redisKey(id));
}

/**
 * Copy the tenant context onto a result (simple/fb) session. Called at the
 * OAuth callback (which still runs top-level in the popup, so the context
 * cookie is readable there) so the seed handlers can read workspace/end-user
 * from the session id — not the cookie, which a third-party iframe withholds.
 *
 * Read-modify-write preserving the remaining TTL: we re-SET with KEEPTTL so
 * attaching context never resets the 10-minute expiry window.
 */
export async function attachContext(
  id: string,
  ctx: SessionContext,
): Promise<void> {
  const s = await getSession(id);
  if (s && (s.kind === 'simple' || s.kind === 'fb')) {
    const updated: Session = { ...s, ctx };
    await getRedis().set(redisKey(id), JSON.stringify(updated), 'KEEPTTL');
  }
}
