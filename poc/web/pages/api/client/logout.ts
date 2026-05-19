import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookie } from '../../../lib/client-session';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): void {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
