// /api/client/proxy/[...path]
//
// The client dashboard never touches the connector API directly — it
// would expose the bearer to the browser. Instead the dashboard fetches
// /api/client/proxy/v1/accounts (or whatever path), this handler reads
// the HttpOnly session cookie, attaches the bearer, and streams the
// upstream response through.

import type { NextApiRequest, NextApiResponse } from 'next';
import { CONNECTOR_API_URL } from '../../../../lib/api';
import { readApiKeyFromRequest } from '../../../../lib/client-session';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE', 'PATCH', 'PUT']);
// Only /v1/* — the public, workspace-scoped SaaS surface. The /internal/*
// zone is service-to-service (bearer-guarded) and must never be reachable
// from a browser, so this proxy refuses to tunnel to it. Block everything
// else so the proxy can't be turned into a tunnel for /admin/* either.
const ALLOWED_PREFIXES = ['v1/'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (!ALLOWED_METHODS.has(req.method ?? '')) {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const apiKey = readApiKeyFromRequest(req);
  if (!apiKey) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const parts = Array.isArray(req.query.path) ? req.query.path : [];
  const path = parts.join('/');
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    res.status(403).json({ error: 'path_not_allowed', path });
    return;
  }

  // Preserve query string (Next strips the path[] portion into req.query;
  // everything else lives in req.url).
  const queryStart = (req.url ?? '').indexOf('?');
  const queryStr = queryStart >= 0 ? (req.url ?? '').slice(queryStart) : '';
  const upstreamUrl = `${CONNECTOR_API_URL}/${path}${queryStr}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const contentType = req.headers['content-type'];
  if (contentType && req.method !== 'GET' && req.method !== 'DELETE') {
    headers['Content-Type'] = Array.isArray(contentType)
      ? contentType[0]
      : contentType;
  }

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });
    // Forward rate-limit + caching headers from connector → browser so the
    // client UI can render countdowns / cache hints later.
    for (const h of [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.status(upstream.status);
    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) res.setHeader('Content-Type', upstreamContentType);
    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: 'upstream_unreachable',
      message: (err as Error).message,
    });
  }
}
