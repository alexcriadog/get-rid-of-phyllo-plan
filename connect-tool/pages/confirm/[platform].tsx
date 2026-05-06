// Confirmation page shown after the OAuth callback for TikTok / Threads /
// YouTube. Renders an account preview + product checkboxes; on submit POSTs
// to /api/seed-confirm and redirects to /success.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getSimpleSession } from '../../lib/session';
import {
  PRODUCT_CATALOG,
  defaultSelectedProducts,
  type ProductDef,
} from '../../lib/products';
import type { PlatformKey } from '../../lib/platforms';

type Preview = {
  handle?: string;
  name?: string;
  extras?: Record<string, unknown>;
};

type PageProps = {
  sessionId: string;
  platform: PlatformKey;
  preview: Preview;
  products: ProductDef[];
  defaultIds: string[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const sessionId =
    typeof ctx.query.session === 'string' ? ctx.query.session : '';
  const platform = ctx.params?.platform as PlatformKey | undefined;
  if (!sessionId || !platform || !PRODUCT_CATALOG[platform]) {
    return {
      redirect: {
        destination: '/?error=' + encodeURIComponent('Missing session or platform'),
        permanent: false,
      },
    };
  }
  const session = getSimpleSession(sessionId);
  if (!session) {
    return {
      redirect: {
        destination:
          '/?error=' +
          encodeURIComponent(
            'Session expired (10 minutes) — restart the OAuth flow.',
          ),
        permanent: false,
      },
    };
  }
  if (session.platform !== platform) {
    return {
      redirect: {
        destination: '/?error=' + encodeURIComponent('Session/platform mismatch'),
        permanent: false,
      },
    };
  }
  return {
    props: {
      sessionId,
      platform,
      preview: session.preview,
      products: PRODUCT_CATALOG[platform],
      defaultIds: defaultSelectedProducts(platform),
    },
  };
};

export default function ConfirmPage({
  sessionId,
  platform,
  preview,
  products,
  defaultIds,
}: PageProps) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaultIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string, locked: boolean) => {
    if (locked) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/seed-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, productIds: Array.from(picked) }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      const params = new URLSearchParams({
        platform,
        accounts: json.account_id ?? '',
        summary: JSON.stringify({
          handle: preview.handle ?? preview.name ?? '',
          products: (json.products ?? []).length,
          sync_jobs_created: (json.sync_jobs_created ?? []).length,
        }),
      });
      router.push(`/success?${params.toString()}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => products.length, [products]);

  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">
            ← Back
          </Link>
          <span className="v-eyebrow">{platform} confirm</span>
        </header>

        <h1 className="v-display size-secondary">Pick what to sync.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 24 }}>
          OAuth succeeded. Select which products to enable on this account
          before we hand the token to the POC. You can change cadence and
          enable / disable individual products later from the admin UI.
        </p>

        <div
          className="v-summary"
          style={{
            marginBottom: 24,
            gridTemplateColumns: '160px 1fr',
            display: 'grid',
            gap: 8,
          }}
        >
          <span className="v-meta">Handle</span>
          <span className="v-row-val">{preview.handle ?? '—'}</span>
          {preview.name && (
            <>
              <span className="v-meta">Name</span>
              <span className="v-row-val">{preview.name}</span>
            </>
          )}
          {preview.extras &&
            Object.entries(preview.extras).map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}>
                <span className="v-meta">{k}</span>
                <span className="v-row-val">
                  {Array.isArray(v) ? v.join(', ') : String(v ?? '—')}
                </span>
              </span>
            ))}
        </div>

        {err && <div className="v-banner danger">↯ {err}</div>}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span className="v-kicker mint">Products</span>
          <span className="v-meta">
            {picked.size}/{total} selected
          </span>
        </div>

        <div className="v-pages">
          {products.map((p) => {
            const checked = picked.has(p.id);
            const locked = !!p.required;
            return (
              <label
                key={p.id}
                className={'v-page-row ' + (checked ? 'picked' : '')}
                style={{
                  cursor: locked ? 'default' : 'pointer',
                  opacity: locked ? 0.85 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id, locked)}
                  disabled={locked}
                />
                <div className="v-page-meta">
                  <div className="v-page-name">
                    {p.label}
                    {locked && (
                      <span className="v-meta" style={{ marginLeft: 8 }}>
                        required
                      </span>
                    )}
                  </div>
                  {p.hint && <div className="v-page-id">{p.hint}</div>}
                </div>
                <span className="v-meta">{p.id}</span>
              </label>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 24,
          }}
        >
          <button
            className="v-pill-primary"
            disabled={busy || picked.size === 0}
            onClick={onSubmit}
          >
            {busy
              ? 'Connecting…'
              : `Connect with ${picked.size} product${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
