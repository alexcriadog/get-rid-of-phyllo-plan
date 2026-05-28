// Handler invoked by the /confirm/{platform} pages (TikTok/Threads/YouTube).
// Reads the simple-platform session that the OAuth callback stashed, takes
// the operator's product selection, and posts the seed to the POC.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  dropSession,
  getOAuthContextSession,
  getSimpleSession,
} from '../../../lib/session';
import { postToPocSeed } from '../../../lib/seed-client';
import {
  fetchProductsCatalog,
  requiredProducts,
} from '../../../lib/workspace-config';
import {
  getContextCookie,
  setContextCookie,
} from '../../../lib/oauth-context';

const Body = z
  .object({
    sessionId: z.string().min(8),
    productIds: z.array(z.string()).min(1),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const session = getSimpleSession(parsed.data.sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'session expired or unknown — restart OAuth' },
      { status: 410 },
    );
  }

  const catalog = await fetchProductsCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: 'catalog temporarily unavailable' },
      { status: 503 },
    );
  }
  const required = requiredProducts(catalog, session.platform);
  const products = Array.from(
    new Set([...required, ...parsed.data.productIds]),
  );

  // Prefer the context captured on the session at the OAuth callback (works
  // inside a third-party iframe). Fall back to the cookie for the legacy
  // top-level popup flow.
  const contextSessionId = getContextCookie(req);
  const context =
    session.ctx ??
    (contextSessionId ? getOAuthContextSession(contextSessionId) : null);

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
    const response = NextResponse.json({
      account_id: seeded.account_id,
      sync_jobs_created: seeded.sync_jobs_created,
      products,
      platform: session.platform,
      preview: session.preview,
      opener_origin: context?.openerOrigin ?? null,
    });
    if (contextSessionId) {
      dropSession(contextSessionId);
      setContextCookie(response, null);
    }
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'POC seed failed', message },
      { status: 502 },
    );
  }
}
