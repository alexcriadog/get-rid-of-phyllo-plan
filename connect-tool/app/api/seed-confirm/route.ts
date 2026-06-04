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
  clampProductsToScope,
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

  const session = await getSimpleSession(parsed.data.sessionId);
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
  // Clamp to this connection's signed product scope (if any). A tampered
  // productIds body can never widen past it; the POC seedAccount() still
  // re-enforces the workspace ceiling on top of this.
  const scope = session.ctx?.connectionProducts?.[session.platform];
  const products = clampProductsToScope(
    Array.from(new Set([...required, ...parsed.data.productIds])),
    scope,
  );

  // Prefer the context captured on the session at the OAuth callback (works
  // inside a third-party iframe). Fall back to the cookie for the legacy
  // top-level popup flow.
  const contextSessionId = getContextCookie(req);
  const context =
    session.ctx ??
    (contextSessionId ? await getOAuthContextSession(contextSessionId) : null);

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
    // LinkedIn: organization accounts ride the same confirmation. Failures
    // are collected, not fatal — the member account is already seeded.
    const extraResults: Array<{ account_id: string; handle?: string }> = [];
    const extraErrors: string[] = [];
    for (const extra of session.extraSeedBodies ?? []) {
      try {
        const r = await postToPocSeed({
          ...extra,
          metadata: { ...(extra.metadata ?? {}), products },
          ...(context
            ? {
                workspace_id: context.workspaceId,
                end_user_id: context.endUserId,
                ...(context.environment === 'test' ? { is_test: true } : {}),
              }
            : {}),
        });
        extraResults.push({ account_id: r.account_id, handle: extra.handle });
      } catch (err) {
        extraErrors.push(
          `${extra.handle ?? extra.canonical_user_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    await dropSession(parsed.data.sessionId);
    const response = NextResponse.json({
      account_id: seeded.account_id,
      sync_jobs_created: seeded.sync_jobs_created,
      products,
      platform: session.platform,
      preview: session.preview,
      opener_origin: context?.openerOrigin ?? null,
      ...(extraResults.length > 0 ? { extra_accounts: extraResults } : {}),
      ...(extraErrors.length > 0 ? { extra_errors: extraErrors } : {}),
    });
    if (contextSessionId) {
      await dropSession(contextSessionId);
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
