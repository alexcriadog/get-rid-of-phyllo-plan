import type { NextApiRequest, NextApiResponse } from 'next';
import { gateStatus } from '@/lib/session-gate';

/**
 * Session probe for Caddy `forward_auth`. Returns 200 if the caller carries a
 * valid Auth.js session cookie, 401 otherwise. Caddy only proxies to the
 * backend admin API on a 2xx, so this gates `/api/poc/admin/*` with the same
 * operator session the browser uses everywhere else.
 *
 * Lives at `/api/gate` (NOT `/api/auth/gate`) — the Auth.js catch-all owns the
 * whole `/api/auth/*` namespace and would otherwise swallow it.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  res.status(await gateStatus(req)).end();
}
