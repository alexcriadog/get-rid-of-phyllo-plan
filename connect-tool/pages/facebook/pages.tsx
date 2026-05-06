// Page picker shown after the Facebook OAuth callback. Reads the session
// that holds the user_token + page list, and lets the operator tick
// which Pages to connect (and whether to also seed their IG business
// account, when they have one).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getFbSession } from '../../lib/session';
import {
  PRODUCT_CATALOG,
  defaultSelectedProducts,
  type ProductDef,
} from '../../lib/products';

type PageItem = {
  id: string;
  name: string;
  ig_business_account_id: string | null;
};

type PageProps = {
  sessionId: string;
  pages: PageItem[];
  fbProducts: ProductDef[];
  fbDefaults: string[];
  igProducts: ProductDef[];
  igDefaults: string[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const sessionId =
    typeof ctx.query.session === 'string' ? ctx.query.session : '';
  if (!sessionId) {
    return {
      redirect: {
        destination: '/?error=' + encodeURIComponent('Missing session id'),
        permanent: false,
      },
    };
  }
  const session = getFbSession(sessionId);
  if (!session) {
    return {
      redirect: {
        destination:
          '/?error=' +
          encodeURIComponent(
            'Session expired (10 minutes) — restart Facebook OAuth.',
          ),
        permanent: false,
      },
    };
  }
  return {
    props: {
      sessionId,
      pages: session.pages.map((p) => ({
        id: p.id,
        name: p.name,
        ig_business_account_id: p.instagram_business_account?.id ?? null,
      })),
      fbProducts: PRODUCT_CATALOG.facebook,
      fbDefaults: defaultSelectedProducts('facebook'),
      igProducts: PRODUCT_CATALOG.instagram,
      igDefaults: defaultSelectedProducts('instagram'),
    },
  };
};

type ResultRow = {
  page_id: string;
  page_name: string;
  facebook_account_id: string | null;
  instagram_account_id: string | null;
  errors: Array<{ platform: string; message: string }>;
};

export default function FacebookPagesPicker({
  sessionId,
  pages,
  fbProducts,
  fbDefaults,
  igProducts,
  igDefaults,
}: PageProps) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(pages.map((p) => p.id)),
  );
  const [withIg, setWithIg] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const p of pages) {
      if (p.ig_business_account_id) init[p.id] = true;
    }
    return init;
  });
  const [productsFb, setProductsFb] = useState<Set<string>>(
    () => new Set(fbDefaults),
  );
  const [productsIg, setProductsIg] = useState<Set<string>>(
    () => new Set(igDefaults),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleIg = (id: string) =>
    setWithIg((prev) => ({ ...prev, [id]: !prev[id] }));

  const submitDisabled = picked.size === 0 || busy;
  const igCount = useMemo(
    () =>
      pages.filter(
        (p) => picked.has(p.id) && withIg[p.id] && p.ig_business_account_id,
      ).length,
    [pages, picked, withIg],
  );

  const onSubmit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/seed-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pageIds: Array.from(picked),
          includeInstagram: withIg,
          productsFb: Array.from(productsFb),
          productsIg: Array.from(productsIg),
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const json = (await res.json()) as { results: ResultRow[] };
      setDone(true);
      const summary = encodeURIComponent(
        JSON.stringify({
          facebook_pages: json.results.length,
          facebook_accounts: json.results.filter((r) => r.facebook_account_id)
            .length,
          instagram_accounts: json.results.filter((r) => r.instagram_account_id)
            .length,
        }),
      );
      const accounts = json.results
        .flatMap((r) =>
          [r.facebook_account_id, r.instagram_account_id].filter(
            (x): x is string => !!x,
          ),
        )
        .join(',');
      setTimeout(
        () =>
          router.push(
            `/success?platform=facebook&accounts=${accounts}&summary=${summary}`,
          ),
        1200,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">
            ← Back
          </Link>
          <span className="v-eyebrow">Facebook page picker</span>
        </header>

        <h1 className="v-display size-secondary">Pick which to connect.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 24 }}>
          {pages.length} {pages.length === 1 ? 'Page' : 'Pages'} discovered.
          Tick a Page to seed it as a Facebook account on the POC. If the
          Page has an Instagram business account attached, the IG checkbox
          appears too — tick it to also seed IG with the same Page token.
        </p>

        {err && <div className="v-banner danger">↯ {err}</div>}

        {/* Product panels — apply to ALL chosen pages. Granularity per-page
            is intentionally avoided to keep the UX manageable. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: anyIgChecked(withIg, picked) ? '1fr 1fr' : '1fr',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <ProductsPanel
            title="Facebook products"
            subtitle="Applied to every Page you select"
            products={fbProducts}
            picked={productsFb}
            onToggle={(id) =>
              setProductsFb((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          {anyIgChecked(withIg, picked) && (
            <ProductsPanel
              title="Instagram products"
              subtitle="Applied to every IG account marked above"
              products={igProducts}
              picked={productsIg}
              onToggle={(id) =>
                setProductsIg((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          )}
        </div>

        <div className="v-pages">
          {pages.map((p) => (
            <label
              key={p.id}
              className={'v-page-row ' + (picked.has(p.id) ? 'picked' : '')}
            >
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={() => togglePicked(p.id)}
              />
              <div className="v-page-meta">
                <div className="v-page-name">{p.name}</div>
                <div className="v-page-id">#{p.id}</div>
              </div>
              {p.ig_business_account_id ? (
                <span
                  className="v-ig-toggle"
                  onClick={(e) => {
                    e.preventDefault();
                    toggleIg(p.id);
                  }}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={!!withIg[p.id]}
                    aria-label={`Include Instagram for ${p.name}`}
                  />
                  <span>+ IG ({p.ig_business_account_id.slice(-6)})</span>
                </span>
              ) : (
                <span className="v-meta">no IG attached</span>
              )}
            </label>
          ))}
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
            disabled={submitDisabled}
            onClick={onSubmit}
          >
            {busy
              ? 'Connecting…'
              : `Connect ${picked.size} Page${picked.size === 1 ? '' : 's'}` +
                (igCount > 0 ? ` + ${igCount} IG` : '')}
          </button>
          <span className="v-meta">{done ? '◉ done — redirecting…' : ''}</span>
        </div>
      </div>
    </div>
  );
}

function anyIgChecked(
  withIg: Record<string, boolean>,
  picked: Set<string>,
): boolean {
  for (const id of Array.from(picked)) {
    if (withIg[id]) return true;
  }
  return false;
}

function ProductsPanel({
  title,
  subtitle,
  products,
  picked,
  onToggle,
}: {
  title: string;
  subtitle: string;
  products: ProductDef[];
  picked: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="v-kicker mint">{title}</span>
        <span className="v-meta">
          {picked.size}/{products.length}
        </span>
      </div>
      <div className="v-meta" style={{ marginBottom: 10 }}>
        {subtitle}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {products.map((p) => {
          const locked = !!p.required;
          const on = picked.has(p.id);
          return (
            <label
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                borderRadius: 8,
                cursor: locked ? 'default' : 'pointer',
                opacity: locked ? 0.85 : 1,
                background: on ? 'rgba(60,255,208,0.06)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                onChange={() => !locked && onToggle(p.id)}
              />
              <span style={{ flex: 1, fontFamily: 'var(--v-sans)', fontSize: 14 }}>
                {p.label}
                {locked && (
                  <span className="v-meta" style={{ marginLeft: 6 }}>
                    required
                  </span>
                )}
              </span>
              <span className="v-meta" style={{ fontSize: 10 }}>
                {p.id}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
