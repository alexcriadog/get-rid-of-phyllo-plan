// Confirmation page shown after the OAuth callback for TikTok / Threads /
// YouTube / Twitch. Server Component does the session lookup + redirect
// gating; ConfirmClient handles the interactive picker UI.

import { redirect } from 'next/navigation';
import { getSimpleSession } from '../../../lib/session';
import {
  PRODUCT_CATALOG,
  defaultSelectedProducts,
} from '../../../lib/products';
import type { PlatformKey } from '../../../lib/platforms';
import { ConfirmClient } from './client';

type Search = { session?: string | string[]; embed?: string | string[]; origin?: string | string[] };

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ platform: rawPlatform }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
  const platform = rawPlatform as PlatformKey;
  const sessionId = first(sp.session);
  const embed = first(sp.embed);
  const origin = first(sp.origin);

  if (!sessionId || !PRODUCT_CATALOG[platform]) {
    redirect('/?error=' + encodeURIComponent('Missing session or platform'));
  }
  const session = getSimpleSession(sessionId);
  if (!session) {
    redirect(
      '/?error=' +
        encodeURIComponent(
          'Session expired (10 minutes) — restart the OAuth flow.',
        ),
    );
  }
  if (session.platform !== platform) {
    redirect('/?error=' + encodeURIComponent('Session/platform mismatch'));
  }

  return (
    <ConfirmClient
      sessionId={sessionId}
      platform={platform}
      preview={session.preview}
      products={PRODUCT_CATALOG[platform]}
      defaultIds={defaultSelectedProducts(platform)}
      embed={embed === '1'}
      origin={typeof origin === 'string' ? origin : ''}
    />
  );
}
