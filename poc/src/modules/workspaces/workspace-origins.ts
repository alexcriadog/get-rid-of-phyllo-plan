// Sec-4: per-workspace origin allow-list helpers.
//
// An "origin" here is a browser web origin — scheme://host[:port], no path,
// query, fragment or credentials — matching exactly what a browser reports as
// `window.location.origin` and what the SDK sends as `?origin=`. We canonicalise
// admin-entered values on write so the stored allow-list compares byte-for-byte
// against the runtime origin in connect-tool (mirror: connect-tool/lib/origin-allowlist.ts).

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Canonicalise a user-entered origin to `scheme://host[:port]` (lowercased
 * scheme + host, default ports dropped, no trailing slash). Returns null when
 * the input is not a valid http(s) origin or carries a path/query/fragment/
 * credentials — those are not part of an origin and almost always indicate a
 * mistake we'd rather reject loudly than silently strip.
 */
export function normalizeOrigin(raw: string): string | null {
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
  // URL normalises a bare origin to pathname "/"; anything else is a path.
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  // A trailing-dot host (e.g. "https://app.example.com.") is a distinct,
  // technically-valid origin the URL parser preserves — but no browser ever
  // reports it as window.location.origin, so storing one would silently block
  // every real user of that host. Reject it loudly so the admin gets an error.
  if (url.hostname.endsWith('.')) return null;

  // url.origin is already canonical: lowercase scheme+host, default ports
  // (80/443) elided, no trailing slash.
  return url.origin;
}

/**
 * Validate + canonicalise + de-duplicate a list of admin-entered origins.
 * Throws with the offending value on the first invalid entry so the admin
 * gets a precise error instead of a silently-shrunk list.
 */
export function normalizeOrigins(raw: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const origin = normalizeOrigin(value);
    if (origin === null) {
      throw new Error(
        `Invalid origin "${value}". Use scheme://host[:port] with no path, e.g. https://app.example.com`,
      );
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}
