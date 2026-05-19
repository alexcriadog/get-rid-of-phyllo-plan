// Handler invoked by the FB Page picker UI. Reads the session that was
// stashed by the FB OAuth callback, and for each picked Page runs:
//   - one seed call as platform=facebook
//   - optionally a second seed call as platform=instagram (if the operator
//     wants the IG business account, AND the Page actually has one)

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import {
  dropSession,
  getFbSession,
  getOAuthContextSession,
} from '../../lib/session';
import {
  buildFacebookSeeds,
  type PlatformKey,
} from '../../lib/platforms';
import { postToPocSeed } from '../../lib/seed-client';
import { defaultSelectedProducts } from '../../lib/products';
import {
  getContextCookie,
  setContextCookie,
} from '../../lib/oauth-context';

const Body = z
  .object({
    sessionId: z.string().min(8),
    pageIds: z.array(z.string()).min(1),
    includeInstagram: z.record(z.boolean()).optional(),
    productsFb: z.array(z.string()).optional(),
    productsIg: z.array(z.string()).optional(),
  })
  .strict();

interface PerPageResult {
  page_id: string;
  page_name: string;
  facebook_account_id: string | null;
  instagram_account_id: string | null;
  errors: Array<{ platform: PlatformKey; message: string }>;
}

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

  const session = getFbSession(parsed.data.sessionId);
  if (!session) {
    res.status(410).json({
      error: 'session expired or unknown — restart Facebook OAuth',
    });
    return;
  }

  const productsFb = parsed.data.productsFb?.length
    ? parsed.data.productsFb
    : defaultSelectedProducts('facebook');
  const productsIg = parsed.data.productsIg?.length
    ? parsed.data.productsIg
    : defaultSelectedProducts('instagram');

  // SDK-launched popup carries tenant context in a cookie.
  const contextSessionId = getContextCookie(req);
  const context = contextSessionId
    ? getOAuthContextSession(contextSessionId)
    : null;
  const tenantFields = context
    ? { workspace_id: context.workspaceId, end_user_id: context.endUserId }
    : {};

  const results: PerPageResult[] = [];
  for (const pageId of parsed.data.pageIds) {
    const page = session.pages.find((p) => p.id === pageId);
    if (!page) {
      results.push({
        page_id: pageId,
        page_name: '<unknown>',
        facebook_account_id: null,
        instagram_account_id: null,
        errors: [{ platform: 'facebook', message: 'page not in session' }],
      });
      continue;
    }
    const includeIg = !!parsed.data.includeInstagram?.[pageId];
    const seeds = buildFacebookSeeds(page, session.userToken, includeIg).map(
      (seed) => ({
        ...seed,
        metadata: {
          ...(seed.metadata ?? {}),
          products: seed.platform === 'instagram' ? productsIg : productsFb,
        },
        ...tenantFields,
      }),
    );

    const result: PerPageResult = {
      page_id: page.id,
      page_name: page.name,
      facebook_account_id: null,
      instagram_account_id: null,
      errors: [],
    };
    for (const seed of seeds) {
      try {
        const seeded = await postToPocSeed(seed);
        if (seed.platform === 'facebook') {
          result.facebook_account_id = seeded.account_id;
        } else if (seed.platform === 'instagram') {
          result.instagram_account_id = seeded.account_id;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ platform: seed.platform, message });
      }
    }
    results.push(result);
  }

  // Drop the session so the user_token doesn't linger in memory.
  dropSession(parsed.data.sessionId);
  if (contextSessionId) {
    dropSession(contextSessionId);
    setContextCookie(res, null);
  }

  res.status(200).json({
    results,
    opener_origin: context?.openerOrigin ?? null,
  });
}
