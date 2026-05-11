// In-memory session store. Holds the freshly-exchanged YouTube tokens
// between the OAuth callback and the /verified/{session} page that
// demonstrates each scope.
//
// TTL is 10 minutes. After expiration the session is dropped and the
// reviewer must restart OAuth. We deliberately never persist to disk —
// this app is single-purpose and stateless.

import { randomBytes } from 'crypto';

const TTL_MS = 10 * 60 * 1000;

export interface YoutubeSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
  createdAt: number;
}

// Anchor the Map on globalThis so module-level state survives the
// webpack-chunk split that Next.js applies to API routes vs Pages in
// `output: 'standalone'`. Same pattern as connect-tool/lib/session.ts.
const GLOBAL_KEY = '__verify_youtube_sessions__';
type GlobalStore = { [GLOBAL_KEY]?: Map<string, YoutubeSession> };
const g = globalThis as unknown as GlobalStore;
const store: Map<string, YoutubeSession> =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new Map<string, YoutubeSession>());

export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}

export function putSession(session: Omit<YoutubeSession, 'createdAt'>): string {
  pruneExpired();
  const id = newSessionId();
  store.set(id, { ...session, createdAt: Date.now() });
  return id;
}

export function getSession(id: string): YoutubeSession | null {
  pruneExpired();
  const hit = store.get(id);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return hit;
}

export function dropSession(id: string): void {
  store.delete(id);
}

function pruneExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of store.entries()) {
    if (s.createdAt < cutoff) store.delete(id);
  }
}
