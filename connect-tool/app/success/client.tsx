'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useEmbedAutosize } from '../../lib/useEmbedAutosize';
import { sanitizeAccent } from '../../lib/css-color';
import { PlatformIcon, BRAND } from '../connect/PlatformIcon';
import { isPlatformKey } from '../connect/shell-machine';

export function SuccessClient() {
  const params = useSearchParams();
  const platform = params.get('platform') ?? '';
  const accountsRaw = params.get('accounts') ?? '';
  const accounts = accountsRaw ? accountsRaw.split(',').filter(Boolean) : [];
  const summaryRaw = params.get('summary') ?? '';
  let summary: Record<string, unknown> | null = null;
  if (summaryRaw) {
    try {
      summary = JSON.parse(decodeURIComponent(summaryRaw));
    } catch {
      summary = null;
    }
  }

  // SDK widget integration. When loaded inside the SDK (iframe modal or
  // legacy popup), notify the host and let it resume. Depend on the RAW
  // string params so the effect doesn't re-fire on a fresh array reference;
  // a ref guard keeps the postMessage idempotent under Strict Mode.
  const openerOrigin = params.get('opener_origin') ?? '';
  const embedded = params.get('embed') === '1';
  useEmbedAutosize(embedded, openerOrigin);
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (typeof window === 'undefined') return;
    const ids = accountsRaw ? accountsRaw.split(',').filter(Boolean) : [];
    if (ids.length === 0) return;
    const payload = { type: 'camaleonic.connect.success', accountIds: ids, platform };

    if (embedded && window.parent && window.parent !== window) {
      // Inside the modal iframe — notify the host SDK; do NOT close (we are
      // an iframe, not a popup). The SDK tears down the overlay.
      sentRef.current = true;
      try {
        window.parent.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : window.location.origin);
      } catch {
        /* host cross-origin policy — host's problem */
      }
      return;
    }

    // Legacy popup-window flow: notify opener and close.
    const opener = window.opener;
    if (!opener || opener === window) return;
    sentRef.current = true;
    try {
      opener.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : window.location.origin);
    } catch {
      /* opener cross-origin */
    }
    const timer = window.setTimeout(() => window.close(), 250);
    return () => window.clearTimeout(timer);
  }, [accountsRaw, openerOrigin, platform, embedded]);

  // ── Embedded: clean, on-brand confirmation (host SDK closes the modal) ──
  if (embedded) {
    const pk = isPlatformKey(platform) ? platform : null;
    const handle = typeof summary?.handle === 'string' ? (summary.handle as string) : '';
    const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
    const accent = sanitizeAccent(params.get('accent'));
    const rootStyle = accent
      ? ({ ['--cml-accent']: accent, ['--cml-on-accent']: '#ffffff' } as React.CSSProperties)
      : undefined;
    return (
      <div className="cml" data-theme={theme} style={rootStyle}>
        <header className="cml-head">
          <div className="cml-brand"><span className="cml-brand__name">Camaleonic</span></div>
        </header>
        <div className="cml-body">
          <div className="cml-step cml-center">
            <div className="cml-hero">
              <span className="cml-hero__ring" style={{ width: 64, height: 64, borderRadius: 20 }}>
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
            </div>
            <h2 className="cml-title">You’re connected</h2>
            <p className="cml-sub">
              {pk ? `Your ${BRAND[pk].label} account` : 'Your account'}{handle ? ` @${handle}` : ''} is now linked to Camaleonic.
            </p>
            {pk && (
              <div className="cml-list" style={{ marginTop: 18 }}>
                {accounts.map((id) => (
                  <div key={id} className="cml-row">
                    <PlatformIcon platform={pk} />
                    <div className="cml-row__meta">
                      <div className="cml-row__name">{handle || `${BRAND[pk].label} account`}</div>
                      <div className="cml-row__sub">Connected</div>
                    </div>
                    <span className="cml-status">Connected</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Standalone / operator view (legacy, dark theme) ──
  const adminUrl = process.env.NEXT_PUBLIC_POC_ADMIN_URL ?? 'http://localhost:3001/admin';
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">← Back</Link>
          <span className="v-eyebrow">Connected</span>
        </header>

        <span className="v-tag mint" style={{ marginBottom: 16 }}>{platform || 'platform'}</span>
        <h1 className="v-display size-secondary">Token handed off.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 32 }}>
          The POC has accepted the credentials and started seeding sync jobs.
          Identity, audience, engagement and the rest will populate on the
          next cadence tick.
        </p>

        <div className="v-summary">
          <Row label="Platform" value={platform} />
          <Row label="Account ids" value={accounts.length ? accounts.join(', ') : '—'} />
          {summary && Object.entries(summary).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <Link className="v-pill-primary" href={`${adminUrl}/accounts`}>See accounts in POC →</Link>
          <Link className="v-pill-outline-mint" href="/">Connect another</Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="v-row">
      <span className="v-meta">{label}</span>
      <span className="v-row-val">{value}</span>
    </div>
  );
}
