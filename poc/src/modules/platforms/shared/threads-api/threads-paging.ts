// Threads cursor pagination helper. Mirrors meta-graph/graph-paging.ts but
// strips the Threads `/v1.0/` version prefix instead of `/v22.0/`.
//
// Threads' `paging.next` returns an absolute URL with the access token still
// in the query string; we strip both the version segment and the token so
// callers can replay the request through the same chokepoint client.

const THREADS_VERSION = 'v1.0';

export function parseThreadsNextUrl(absoluteUrl: string): {
  endpoint: string;
  params: Record<string, string | number | undefined>;
} {
  try {
    const u = new URL(absoluteUrl);
    let endpoint = u.pathname;
    const versionPrefix = `/${THREADS_VERSION}`;
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
