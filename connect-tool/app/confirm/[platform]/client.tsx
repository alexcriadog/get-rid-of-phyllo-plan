'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProductDef } from '../../../lib/products';
import type { PlatformKey } from '../../../lib/platforms';
import { useEmbedAutosize } from '../../../lib/useEmbedAutosize';

interface Preview {
  handle?: string;
  name?: string;
  extras?: Record<string, unknown>;
}

interface Props {
  sessionId: string;
  platform: PlatformKey;
  preview: Preview;
  products: ProductDef[];
  defaultIds: string[];
  embed: boolean;
  origin: string;
  theme: 'light' | 'dark';
  accent: string | null;
}

export function ConfirmClient({
  sessionId,
  platform,
  preview,
  products,
  defaultIds,
  embed,
  origin,
  theme,
  accent,
}: Props) {
  const router = useRouter();
  useEmbedAutosize(embed, origin);
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
      if (
        typeof json.opener_origin === 'string' &&
        json.opener_origin.length > 0
      ) {
        params.set('opener_origin', json.opener_origin);
      }
      if (embed) params.set('embed', '1');
      if (origin) params.set('origin', origin);
      if (embed) params.set('theme', theme);
      if (accent) params.set('accent', accent);
      router.push(`/success?${params.toString()}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => products.length, [products]);

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

        <h1 className="v-display size-secondary">Choose what to sync</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 24 }}>
          Select what Camaleonic can sync from this account. You can change
          this anytime.
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
