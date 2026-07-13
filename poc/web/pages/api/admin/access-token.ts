// GET /api/admin/access-token?id=<accountId>&product=page|ads
//
// Server-side proxy for the operator "Show page token" debug action.
//
// The upstream route /admin/accounts/:id/access-token returns a plaintext
// OAuth token, so it is guarded by ConnectToolGuard: callers must be
// loopback OR present `Authorization: Bearer ${CONNECT_TOOL_SECRET}`. The
// admin dashboard runs in the browser → its request reaches the API through
// Caddy (non-loopback) without the bearer, so a direct browser call always
// 401s ("connect-tool bearer token missing or invalid").
//
// This handler closes that gap the secure way: the browser calls this Next
// API route (gated by the web middleware's operator session, AND re-checked
// in-handler below since it returns plaintext tokens), and the Next *server*
// forwards to the API on the internal docker network with the bearer attached.
// CONNECT_TOOL_SECRET never leaves the server — it is read from server-only
// env, never the NEXT_PUBLIC_* bundle.

import type { NextApiRequest, NextApiResponse } from 'next';
import { gateStatus } from '@/lib/session-gate';

// Server-only API base: in prod this is http://api:3000 (docker network),
// NOT the public NEXT_PUBLIC_CONNECTOR_API_URL (which would loop back out
// through Caddy and hit the auth gate again).
const API_BASE =
  process.env.CONNECTOR_API_URL ||
  process.env.NEXT_PUBLIC_CONNECTOR_API_URL ||
  'http://localhost:3000';

const ALLOWED_PRODUCTS = new Set(['page', 'ads']);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  // Defense in depth: require a valid operator session in-handler, not just at
  // the middleware/edge layer — this route returns plaintext OAuth tokens.
  if ((await gateStatus(req)) !== 200) {
    res.status(401).json({ message: 'unauthorized' });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ message: 'method_not_allowed' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ message: 'id query param must be a numeric account id' });
    return;
  }

  const product =
    typeof req.query.product === 'string' && ALLOWED_PRODUCTS.has(req.query.product)
      ? req.query.product
      : 'page';

  const secret = process.env.CONNECT_TOOL_SECRET;
  const headers: Record<string, string> = {};
  // When the secret is configured, attach it so the upstream guard passes
  // for non-loopback (proxied) calls. When unset, the upstream guard is
  // permissive anyway (local dev) — so omitting the header is fine.
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const upstreamUrl = `${API_BASE}/admin/accounts/${id}/access-token?product=${product}`;

  try {
    const upstream = await fetch(upstreamUrl, { method: 'GET', headers });
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    res.status(502).json({
      message: 'upstream_unreachable',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
