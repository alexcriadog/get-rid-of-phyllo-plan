// Sec-4: per-workspace origin allow-list enforcement (connect-tool side).
//
// The minted SDK token carries a signed `origins` claim (from
// workspace.allowedOrigins). connect-tool uses these helpers to decide whether
// the popup's `?origin` — the host page that embedded the SDK — is one the
// workspace authorised. Only an allowed origin is ever used as a postMessage
// target, so a leaked token can't be turned into a cross-origin data leak.
//
// normalizeOrigin mirrors poc/src/modules/workspaces/workspace-origins.ts so a
// value stored by the admin compares byte-for-byte against the runtime origin.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Canonicalise an origin to `scheme://host[:port]` (lowercase scheme+host,
 * default ports elided, no trailing slash). Returns null for anything that
 * isn't a bare http(s) origin (path/query/fragment/credentials → rejected).
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  // Trailing-dot hosts ("https://app.example.com.") are never emitted by a
  // browser as window.location.origin — reject so stored and runtime forms
  // can't diverge. Mirrors poc/src/modules/workspaces/workspace-origins.ts.
  if (url.hostname.endsWith('.')) return null;

  return url.origin;
}

/**
 * Is `origin` permitted given the token's `origins` claim?
 *
 * - allowList absent or empty → no restriction configured → ALLOWED
 *   (backward-compatible with workspaces that never set an allow-list).
 * - allowList present → `origin` must canonicalise to a member.
 *
 * The "empty = allow" semantics live here so every call site enforces the
 * allow-list identically; callers that want to *require* a configured list
 * should check `allowList?.length` themselves.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowList: ReadonlyArray<string> | undefined,
): boolean {
  if (!allowList || allowList.length === 0) return true;
  const candidate = normalizeOrigin(origin);
  if (candidate === null) return false;
  for (const entry of allowList) {
    if (normalizeOrigin(entry) === candidate) return true;
  }
  return false;
}

/**
 * Fail-closed variant: an ABSENT or EMPTY allow-list means DENY (not "allow
 * all"). Use this where leaving the list unconfigured must not silently open
 * the door — e.g. production embedder-origin enforcement. A configured list is
 * checked exactly like `isOriginAllowed`.
 */
export function isOriginAllowedStrict(
  origin: string | null | undefined,
  allowList: ReadonlyArray<string> | undefined,
): boolean {
  if (!allowList || allowList.length === 0) return false;
  return isOriginAllowed(origin, allowList);
}

/**
 * Whether the embedder-origin allow-list must be CONFIGURED (fail-closed) for
 * this environment. True in production: a workspace with no allowed origins is
 * denied rather than wide-open. Non-production stays lenient so local/dev
 * workspaces without an allow-list keep working. Mirrors the env-gated pattern
 * of `shouldRequireHttps` in the webhook validator.
 */
export function shouldRequireAllowList(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === 'production';
}
