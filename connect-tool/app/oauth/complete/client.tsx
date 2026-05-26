'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Thin relay shown in the provider-login window when launched from the
 * embedded iframe modal. Posts the freshly-created OAuth session id back to
 * the opener (the iframe shell), which then navigates itself to the
 * confirm / page-picker step, and closes this window.
 */
export function OAuthCompleteClient() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const kind = params.get('kind') ?? '';
  const platform = params.get('platform') ?? '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const opener = window.opener;
    if (opener && opener !== window && sessionId) {
      try {
        opener.postMessage(
          { type: 'camaleonic.oauth.complete', sessionId, kind, platform },
          window.location.origin,
        );
      } catch {
        /* opener is same-origin by construction; ignore */
      }
    }
    const t = window.setTimeout(() => window.close(), 200);
    return () => window.clearTimeout(t);
  }, [sessionId, kind, platform]);

  return (
    <div className="v-canvas v-canvas--embed">
      <div className="v-shell">
        <p className="v-body">Finishing up… you can close this window.</p>
      </div>
    </div>
  );
}
