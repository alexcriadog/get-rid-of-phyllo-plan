// POST /api/client/mcp-authorize
//
// The OAuth consent "Allow" action. The logged-in client (cmlk_* session) has
// already consented on /client/connect; here we (server-side):
//   1. resolve the session key -> workspaceId via the connector's internal
//      endpoint (the raw key never reaches the browser),
//   2. sign a short-lived handoff JWT { req, workspace_id } with the shared
//      CONNECT_TOOL_SECRET, and
//   3. 302-redirect the browser to the connector's /mcp/oauth/grant, which
//      mints the authorization code and returns the user to the AI assistant.

import type { NextApiRequest, NextApiResponse } from 'next';
import { CONNECTOR_API_URL } from '../../../lib/api';
import { readApiKeyFromRequest } from '../../../lib/client-session';
import { signHandoffJwt, handoffSecret } from '../../../lib/oauth-handoff';

const PUBLIC_BASE_URL =
  process.env.MCP_PUBLIC_BASE_URL || 'https://smconnector.camaleonicanalytics.com';
const HANDOFF_TTL_SECONDS = 120;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = (req.body ?? {}) as { req?: unknown };
  const reqToken =
    typeof body.req === 'string'
      ? body.req
      : typeof req.query.req === 'string'
        ? req.query.req
        : '';
  if (!reqToken) {
    res.status(400).json({ error: 'missing_req' });
    return;
  }

  const apiKey = readApiKeyFromRequest(req);
  if (!apiKey) {
    const back = `/client/connect?req=${encodeURIComponent(reqToken)}`;
    res.redirect(302, `/client/login?return_to=${encodeURIComponent(back)}`);
    return;
  }

  let workspaceId: string;
  try {
    const r = await fetch(`${CONNECTOR_API_URL}/internal/mcp/resolve-workspace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${handoffSecret()}`,
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!r.ok) {
      res.status(502).json({ error: 'resolve_failed', status: r.status });
      return;
    }
    const j = (await r.json()) as { workspace_id?: string };
    if (!j.workspace_id) {
      res.status(502).json({ error: 'resolve_no_workspace' });
      return;
    }
    workspaceId = j.workspace_id;
  } catch (err) {
    res
      .status(502)
      .json({ error: 'resolve_unreachable', message: (err as Error).message });
    return;
  }

  const handoff = signHandoffJwt(
    { req: reqToken, workspace_id: workspaceId },
    handoffSecret(),
    HANDOFF_TTL_SECONDS,
  );
  res.redirect(
    302,
    `${PUBLIC_BASE_URL}/mcp/oauth/grant?handoff=${encodeURIComponent(handoff)}`,
  );
}
