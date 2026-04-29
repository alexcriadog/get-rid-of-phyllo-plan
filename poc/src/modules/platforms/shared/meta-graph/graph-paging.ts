// Graph cursor pagination helpers. Phase A3 of the platform refactor.
// See docs/platform-refactor.md §7.
//
// Meta returns absolute URLs in `paging.next`. We strip the version prefix
// and the access_token query parameter so callers can reuse the platform's
// shared axios instance (consistent timeouts, metrics, validateStatus).

const GRAPH_VERSION = 'v22.0';

export function parseNextUrl(absoluteUrl: string): {
  endpoint: string;
  params: Record<string, string | number | undefined>;
} {
  try {
    const u = new URL(absoluteUrl);
    let endpoint = u.pathname;
    const versionPrefix = `/${GRAPH_VERSION}`;
    if (endpoint.startsWith(versionPrefix)) {
      endpoint = endpoint.slice(versionPrefix.length) || '/';
    }
    const params: Record<string, string | number | undefined> = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (k === 'access_token') continue;
      params[k] = v;
    }
    return { endpoint, params };
  } catch {
    return { endpoint: '', params: {} };
  }
}
