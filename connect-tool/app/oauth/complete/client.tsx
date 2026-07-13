'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Thin relay shown in the provider-login window when launched from the
 * embedded iframe modal. Posts the outcome back to the opener (the iframe
 * shell) and closes this window.
 *
 *   ?session=…&kind=…   → success: the shell navigates to confirm / picker.
 *   ?error=…            → failure (user denied, state mismatch, exchange
 *                          error): the shell shows the message in place, so
 *                          the user never leaves the client's page.
 */
export function OAuthCompleteClient() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const kind = params.get('kind') ?? '';
  const platform = params.get('platform') ?? '';
  const error = params.get('error') ?? '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const opener = window.opener;
    if (opener && opener !== window) {
      try {
        if (error) {
          opener.postMessage(
            { type: 'camaleonic.oauth.error', platform, message: error },
            window.location.origin,
          );
        } else if (sessionId) {
          opener.postMessage(
            { type: 'camaleonic.oauth.complete', sessionId, kind, platform },
            window.location.origin,
          );
        }
      } catch {
        /* opener is same-origin by construction; ignore */
      }
    }
    const t = window.setTimeout(() => window.close(), 200);
    return () => window.clearTimeout(t);
  }, [sessionId, kind, platform, error]);

  return (
    <div className="v-canvas v-canvas--embed">
      <div className="v-shell">
        <p className="v-body">
          {error
            ? 'Returning you to the app… you can close this window.'
            : 'Finishing up… you can close this window.'}
        </p>
      </div>
    </div>
  );
}
