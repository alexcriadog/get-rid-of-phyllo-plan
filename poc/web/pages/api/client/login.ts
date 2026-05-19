// POST /api/client/login
//
// Body: { apiKey: string }
// Smoke-tests the key by hitting /v1/accounts on the connector API; if
// the connector accepts it (200), we sign + set the HttpOnly cookie and
// return 200. Anything else maps to 401.

import type { NextApiRequest, NextApiResponse } from 'next';
import { CONNECTOR_API_URL } from '../../../lib/api';
import { setSessionCookie, signApiKey } from '../../../lib/client-session';

type Body = { apiKey?: unknown };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = (req.body ?? {}) as Body;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey || !apiKey.startsWith('cmlk_')) {
    res
      .status(400)
      .json({
        error: 'invalid_key',
        message: 'API key must start with cmlk_(live|test)_',
      });
    return;
  }

  try {
    const probe = await fetch(`${CONNECTOR_API_URL}/v1/accounts?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (probe.status === 401) {
      res.status(401).json({ error: 'invalid_or_revoked' });
      return;
    }
    if (!probe.ok) {
      res.status(502).json({
        error: 'upstream_error',
        message: `Connector returned HTTP ${probe.status}`,
      });
      return;
    }
  } catch (err) {
    res.status(502).json({
      error: 'upstream_unreachable',
      message: (err as Error).message,
    });
    return;
  }

  setSessionCookie(res, signApiKey(apiKey));
  res.status(200).json({
    ok: true,
    environment: apiKey.startsWith('cmlk_test_') ? 'test' : 'live',
  });
}
