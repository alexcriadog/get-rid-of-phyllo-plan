'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProductDef } from '../../../lib/products';
import { useEmbedAutosize } from '../../../lib/useEmbedAutosize';

interface PageItem {
  id: string;
  name: string;
  ig_business_account_id: string | null;
}

interface Props {
  sessionId: string;
  pages: PageItem[];
  fbProducts: ProductDef[];
  fbDefaults: string[];
  igProducts: ProductDef[];
  igDefaults: string[];
  embed: boolean;
  origin: string;
  theme: 'light' | 'dark';
  accent: string | null;
}

interface ResultRow {
  page_id: string;
  page_name: string;
  facebook_account_id: string | null;
  instagram_account_id: string | null;
  errors: Array<{ platform: string; message: string }>;
}

export function FacebookPagesClient({
  sessionId,
  pages,
  fbProducts,
  fbDefaults,
  igProducts,
  igDefaults,
  embed,
  origin,
  theme,
  accent,
}: Props) {
  const router = useRouter();
  useEmbedAutosize(embed, origin);
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
      const json = (await res.json()) as {
        results: ResultRow[];
        opener_origin?: string | null;
      };
      setDone(true);
      const summary = encodeURIComponent(
        JSON.stringify({
          facebook_pages: json.results.length,
          facebook_accounts: json.results.filter((r) => r.facebook_account_id)
            .length,
          instagram_accounts: json.results.filter(
            (r) => r.instagram_account_id,
          ).length,
        }),
      );
      const accounts = json.results
        .flatMap((r) =>
          [r.facebook_account_id, r.instagram_account_id].filter(
            (x): x is string => !!x,
          ),
        )
        .join(',');
      const openerOrigin =
        typeof json.opener_origin === 'string' && json.opener_origin.length > 0
          ? `&opener_origin=${encodeURIComponent(json.opener_origin)}`
          : '';
      setTimeout(
        () =>
          router.push(
            `/success?platform=facebook&accounts=${accounts}&summary=${summary}${openerOrigin}${embed ? '&embed=1' : ''}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}${embed ? `&theme=${theme}` : ''}${accent ? `&accent=${encodeURIComponent(accent)}` : ''}`,
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
    <div
      className={embed ? 'v-canvas v-canvas--embed' : 'v-canvas'}
      data-theme={embed ? theme : undefined}
      style={embed && accent ? ({ ['--e-accent']: accent, ['--e-on-accent']: '#ffffff' } as React.CSSProperties) : undefined}
    >
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">
            ← Back
          </Link>
          <span className="v-eyebrow">Almost done</span>
        </header>

        <h1 className="v-display size-secondary">Choose your Pages</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 24 }}>
          {pages.length} {pages.length === 1 ? 'Page' : 'Pages'} found. Select the
          ones you’d like to connect. If a Page has an Instagram business account
          linked, tick “+ IG” to connect it too.
        </p>

        {err && <div className="v-banner danger">↯ {err}</div>}

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
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
              className={'v-page-row ' + (on ? 'picked' : '')}
              style={{
                cursor: locked ? 'default' : 'pointer',
                opacity: locked ? 0.85 : 1,
                padding: '10px 12px',
              }}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                onChange={() => {
                  if (!locked) onToggle(p.id);
                }}
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
    </div>
  );
}
