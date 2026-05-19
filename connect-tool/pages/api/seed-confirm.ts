// Handler invoked by the /confirm/{platform} pages (TikTok/Threads/YouTube).
// Reads the simple-platform session that the OAuth callback stashed, takes
// the operator's product selection, and posts the seed to the POC.

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import {
  dropSession,
  getOAuthContextSession,
  getSimpleSession,
} from '../../lib/session';
import { postToPocSeed } from '../../lib/seed-client';
import { requiredProducts } from '../../lib/products';
import {
  getContextCookie,
  setContextCookie,
} from '../../lib/oauth-context';

const Body = z
  .object({
    sessionId: z.string().min(8),
    productIds: z.array(z.string()).min(1),
  })
  .strict();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', issues: parsed.error.issues });
    return;
  }

  const session = getSimpleSession(parsed.data.sessionId);
  if (!session) {
    res
      .status(410)
      .json({ error: 'session expired or unknown — restart OAuth' });
    return;
  }

  // Force-include required products (operator can't disable them anyway).
  const required = requiredProducts(session.platform);
  const products = Array.from(
    new Set([...required, ...parsed.data.productIds]),
  );

  // SDK-launched popup: thread the verified workspace + end-user from the
  // OAuth context cookie into the seed body so the backend scopes the
  // account to the right tenant. Absent → legacy flow (demo workspace).
  const contextSessionId = getContextCookie(req);
  const context = contextSessionId
    ? getOAuthContextSession(contextSessionId)
    : null;

  const seedBody = {
    ...session.seedBody,
    metadata: {
      ...(session.seedBody.metadata ?? {}),
      products,
    },
    ...(context
      ? {
          workspace_id: context.workspaceId,
          end_user_id: context.endUserId,
          ...(context.environment === 'test' ? { is_test: true } : {}),
        }
      : {}),
  };

  try {
    const seeded = await postToPocSeed(seedBody);
    dropSession(parsed.data.sessionId);
    if (contextSessionId) {
      dropSession(contextSessionId);
      setContextCookie(res, null);
    }
    res.status(200).json({
      account_id: seeded.account_id,
      sync_jobs_created: seeded.sync_jobs_created,
      products,
      platform: session.platform,
      preview: session.preview,
      opener_origin: context?.openerOrigin ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'POC seed failed', message });
  }
}
