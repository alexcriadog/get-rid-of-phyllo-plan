// Page picker shown after the Facebook OAuth callback. Server Component
// loads the in-memory session + product catalog; FacebookPagesClient
// renders the interactive picker.

import { redirect } from 'next/navigation';
import { getFbSession } from '../../../lib/session';
import {
  PRODUCT_CATALOG,
  defaultSelectedProducts,
} from '../../../lib/products';
import { fetchWorkspaceProducts, displayProducts } from '../../../lib/workspace-config';
import { FacebookPagesClient } from './client';

type Search = {
  session?: string | string[];
  embed?: string | string[];
  origin?: string | string[];
  theme?: string | string[];
  accent?: string | string[];
};

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

export default async function FacebookPagesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const sessionId = first(sp.session);
  const embed = first(sp.embed);
  const origin = first(sp.origin);
  const theme = first(sp.theme) === 'dark' ? 'dark' : 'light';
  const accent = first(sp.accent);
  if (!sessionId) {
    redirect('/?error=' + encodeURIComponent('Missing session id'));
  }
  const session = getFbSession(sessionId);
  if (!session) {
    redirect(
      '/?error=' +
        encodeURIComponent(
          'Session expired (10 minutes) — restart Facebook OAuth.',
        ),
    );
  }

  const wsSlug = session?.ctx?.workspaceSlug ?? null;
  const cfg = wsSlug ? await fetchWorkspaceProducts(wsSlug) : null;
  const lockedFb = displayProducts(cfg, 'facebook');   // string[] | null
  const lockedIg = displayProducts(cfg, 'instagram');  // string[] | null

  return (
    <FacebookPagesClient
      sessionId={sessionId}
      pages={session.pages.map((p) => ({
        id: p.id,
        name: p.name,
        ig_business_account_id: p.instagram_business_account?.id ?? null,
      }))}
      fbProducts={PRODUCT_CATALOG.facebook}
      fbDefaults={defaultSelectedProducts('facebook')}
      igProducts={PRODUCT_CATALOG.instagram}
      igDefaults={defaultSelectedProducts('instagram')}
      lockedFb={lockedFb}
      lockedIg={lockedIg}
      embed={embed === '1'}
      origin={typeof origin === 'string' ? origin : ''}
      theme={theme}
      accent={accent}
    />
  );
}
