// In-memory session store for OAuth flows that need a confirmation step
// (product picker for all 5 platforms; page picker for FB).
//
// Why: between the OAuth callback (which has the freshly-exchanged
// access token) and the seed POST (where the operator confirms which
// products to enable) we need to remember the token + preview info. But
// we MUST NOT persist it to disk — it's a transient bridge.
//
// TTL is 10 minutes; the operator should pick within that window. After
// expiration the session is dropped and the operator must restart OAuth.

import { randomBytes } from 'node:crypto';
import type { SeedBody } from './seed-client';

const TTL_MS = 10 * 60 * 1000;

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
  platform: 'tiktok' | 'threads' | 'youtube' | 'instagram' | 'twitch';
  seedBody: SeedBody;
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

// Singleton in-process map. The connect-tool runs as a single Next.js
// server, so there's only ever one instance.
//
// IMPORTANT: Next.js in production (`output: 'standalone'`) bundles API
// routes and Page SSR into SEPARATE webpack chunks. Module-level state
// is therefore duplicated across bundles even though they run in the
// same Node process — a session put from /api/oauth/callback/facebook
// would be invisible from /facebook/pages getServerSideProps. Anchoring
// the Map on globalThis dedupes it back to a single instance.
//
// If we ever scale horizontally, replace with Redis or move to encrypted
// cookies.
const GLOBAL_KEY = '__connect_tool_oauth_sessions__';
type GlobalStore = { [GLOBAL_KEY]?: Map<string, Session> };
const g = globalThis as unknown as GlobalStore;
const store: Map<string, Session> =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new Map<string, Session>());

export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}

// Distributive omit so the discriminated union stays intact (TS doesn't
// preserve discrimination through a vanilla Omit<Session, ...>).
type PutSessionInput =
  | Omit<FbSession, 'createdAt'>
  | Omit<SimpleSession, 'createdAt'>
  | Omit<OAuthContextSession, 'createdAt'>;

export function putSession(session: PutSessionInput): string {
  pruneExpired();
  const id = newSessionId();
  store.set(id, { ...session, createdAt: Date.now() } as Session);
  return id;
}

export function getSession(id: string): Session | null {
  pruneExpired();
  const hit = store.get(id);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return hit;
}

/** Convenience: returns the session only if it's of the FB shape. */
export function getFbSession(id: string): FbSession | null {
  const s = getSession(id);
  return s && s.kind === 'fb' ? s : null;
}

/** Convenience: returns the session only if it's a simple-platform shape. */
export function getSimpleSession(id: string): SimpleSession | null {
  const s = getSession(id);
  return s && s.kind === 'simple' ? s : null;
}

/** Convenience: returns the session only if it's the SDK OAuth context shape. */
export function getOAuthContextSession(id: string): OAuthContextSession | null {
  const s = getSession(id);
  return s && s.kind === 'oauth-context' ? s : null;
}

export function dropSession(id: string): void {
  store.delete(id);
}

/**
 * Copy the tenant context onto a result (simple/fb) session. Called at the
 * OAuth callback (which still runs top-level in the popup, so the context
 * cookie is readable there) so the seed handlers can read workspace/end-user
 * from the session id — not the cookie, which a third-party iframe withholds.
 */
export function attachContext(id: string, ctx: SessionContext): void {
  const s = store.get(id);
  if (s && (s.kind === 'simple' || s.kind === 'fb')) {
    s.ctx = ctx;
  }
}

function pruneExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of store.entries()) {
    if (s.createdAt < cutoff) store.delete(id);
  }
}
