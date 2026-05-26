'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useEmbedAutosize } from '../../lib/useEmbedAutosize';

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

  // SDK widget integration. When the page is loaded inside a popup opened
  // by CamaleonicConnect.init(), notify the opener and close the popup so
  // the client app can resume its flow without manual interaction.
  //
  // - Depend on the RAW string query params (not the parsed array) so the
  //   effect doesn't re-fire when React renders again with a fresh array
  //   reference. Without this the SDK gets duplicate onSuccess calls.
  // - Belt-and-braces: a ref guard makes the postMessage idempotent in
  //   case Strict Mode (or a future change) fires the effect twice anyway.
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
        window.parent.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : '*');
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
      opener.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : '*');
    } catch {
      /* opener cross-origin */
    }
    const timer = window.setTimeout(() => window.close(), 250);
    return () => window.clearTimeout(timer);
  }, [accountsRaw, openerOrigin, platform, embedded]);

  const adminUrl =
    process.env.NEXT_PUBLIC_POC_ADMIN_URL ?? 'http://localhost:3001/admin';

  return (
    <div className={embedded ? 'v-canvas v-canvas--embed' : 'v-canvas'}>
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">
            ← Back
          </Link>
          <span className="v-eyebrow">Connected</span>
        </header>

        <span className="v-tag mint" style={{ marginBottom: 16 }}>
          {platform || 'platform'}
        </span>
        <h1 className="v-display size-secondary">Token handed off.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 32 }}>
          The POC has accepted the credentials and started seeding sync
          jobs. Identity, audience, engagement and the rest will populate
          on the next cadence tick.
        </p>

        <div className="v-summary">
          <Row label="Platform" value={platform} />
          <Row
            label="Account ids"
            value={accounts.length ? accounts.join(', ') : '—'}
          />
          {summary &&
            Object.entries(summary).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <Link className="v-pill-primary" href={`${adminUrl}/accounts`}>
            See accounts in POC →
          </Link>
          <Link className="v-pill-outline-mint" href="/">
            Connect another
          </Link>
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
