import type { NextApiRequest, NextApiResponse } from 'next';
import { loadShowroomCards } from '@/lib/showroom-server';

/**
 * Bounded, searchable account page for the showroom. Gated by the web
 * middleware (`/api/showroom/*`). Returns at most `limit` cards plus a
 * keyset `nextCursor`, never a full-collection scan.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  try {
    const result = await loadShowroomCards({
      workspace: String(req.query.workspace ?? ''),
      search: String(req.query.search ?? ''),
      limit: Number(req.query.limit) || undefined,
      cursor: String(req.query.cursor ?? '') || undefined,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[showroom] accounts route failed:', (err as Error).message);
    res.status(502).json({ error: 'account registry unavailable' });
  }
}
