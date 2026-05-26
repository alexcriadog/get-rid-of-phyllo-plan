'use client';

import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../lib/connections';
import { initialStep, nextAfterConsent, isPlatformKey, type PlatformKey, type Step } from './shell-machine';

const PLATFORMS: Array<{ key: PlatformKey; label: string; provider: string }> = [
  { key: 'facebook', label: 'Facebook', provider: 'Facebook' },
  { key: 'instagram', label: 'Instagram', provider: 'Facebook' },
  { key: 'youtube', label: 'YouTube', provider: 'Google' },
  { key: 'tiktok', label: 'TikTok', provider: 'TikTok' },
  { key: 'threads', label: 'Threads', provider: 'Threads' },
  { key: 'twitch', label: 'Twitch', provider: 'Twitch' },
];

// Instagram connects via Facebook OAuth (see lib/platforms.ts).
function startPlatform(p: PlatformKey): PlatformKey {
  return p === 'instagram' ? 'facebook' : p;
}

interface Props {
  ws: string;
  token: string;
  origin: string;
  fixedPlatform?: PlatformKey;
  brandTitle: string;
  brandLogo: string | null;
  initialConnections: Connection[];
  tokenError: string | null;
}

export function ConnectShell(props: Props) {
  const init = initialStep(props.fixedPlatform);
  const [step, setStep] = useState<Step>(init.step);
  const [platform, setPlatform] = useState<PlatformKey | undefined>(init.platform);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(props.tokenError);
  const popupTimerRef = useRef<number | null>(null);

  // Size the modal to content. One-way: we post height; the host sets a
  // fixed pixel size, so this does not feed back into a resize loop.
  useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: 'camaleonic.connect.resize', height: document.body.scrollHeight + 24 },
        props.origin || '*',
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [step, props.origin]);

  // Relay from the provider-login window → navigate the iframe to the
  // existing confirm / page-picker page in embed mode.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; sessionId?: string; kind?: string; platform?: string };
      if (d?.type !== 'camaleonic.oauth.complete' || !d.sessionId) return;
      const msgPlatform = isPlatformKey(d.platform) ? d.platform : platform;
      const originQ = props.origin ? `&origin=${encodeURIComponent(props.origin)}` : '';
      const dest =
        d.kind === 'fb-picker'
          ? `/facebook/pages?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}`
          : `/confirm/${encodeURIComponent(msgPlatform || '')}?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}`;
      if (d.kind !== 'fb-picker' && !msgPlatform) return; // ignore relay with no resolvable platform
      window.location.href = dest;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [platform, props.origin]);

  useEffect(() => {
    return () => {
      if (popupTimerRef.current !== null) window.clearInterval(popupTimerRef.current);
    };
  }, []);

  function exit() {
    window.parent?.postMessage({ type: 'camaleonic.connect.exit' }, props.origin || '*');
  }

  function login(p: PlatformKey) {
    const sp = startPlatform(p);
    const qs = new URLSearchParams({ ws: props.ws, token: props.token, origin: props.origin, embed: '1' });
    const url = `/api/oauth/start/${sp}?${qs.toString()}`;
    const popup = window.open(url, 'camaleonic-oauth', 'popup=yes,width=560,height=720');
    if (!popup) {
      setError('Your browser blocked the login window. Allow popups and try again.');
      window.parent?.postMessage(
        { type: 'camaleonic.connect.error', code: 'popup_blocked', message: 'Provider login popup blocked' },
        props.origin || '*',
      );
      return;
    }
    setConnecting(true);
    popupTimerRef.current = window.setInterval(() => {
      if (popup.closed) {
        if (popupTimerRef.current !== null) window.clearInterval(popupTimerRef.current);
        popupTimerRef.current = null;
        setConnecting(false);
      }
    }, 600);
  }

  if (error) {
    return (
      <Frame title={props.brandTitle} logo={props.brandLogo} onClose={exit}>
        <div className="v-banner danger">↯ {error}</div>
      </Frame>
    );
  }

  return (
    <Frame title={props.brandTitle} logo={props.brandLogo} onClose={exit}>
      {step === 'consent' && (
        <div style={{ textAlign: 'center' }}>
          <h2 className="v-display size-secondary">{props.brandTitle} uses Camaleonic to link your accounts</h2>
          <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left', margin: '16px 0' }}>
            <li className="v-body">✓ Your account is in safe hands</li>
            <li className="v-body">✓ Your consent matters</li>
            <li className="v-body">✓ Your data is safe and encrypted</li>
          </ul>
          <button className="v-pill-primary" onClick={() => setStep(nextAfterConsent(props.fixedPlatform))}>
            Continue
          </button>
        </div>
      )}

      {step === 'chooser' && (
        <div>
          <h2 className="v-display size-secondary">Select a platform</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {PLATFORMS.map((p) => (
              <button key={p.key} className="v-pill-outline-mint" onClick={() => { setPlatform(p.key); setStep('connections'); }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'connections' && platform && (
        <div>
          <h2 className="v-display size-secondary">{labelFor(platform)} connections</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
            {(() => {
              const conns = props.initialConnections.filter((c) => c.platform === platform);
              return conns.length === 0 ? (
                <p className="v-body">No accounts connected yet.</p>
              ) : (
                conns.map((c) => (
                  <div key={c.id} className="v-row">
                    <span className="v-row-val">{c.handle || c.display_name || c.id}</span>
                    <span className="v-meta">{c.status}</span>
                  </div>
                ))
              );
            })()}
          </div>
          <button className="v-pill-primary" onClick={() => setStep('guidance')}>
            + Add {labelFor(platform)} account
          </button>
          {!props.fixedPlatform && (
            <button className="v-meta" style={{ marginLeft: 12 }} onClick={() => setStep('chooser')}>← Back</button>
          )}
        </div>
      )}

      {step === 'guidance' && platform && (() => {
        const g = guidanceFor(platform);
        return (
        <div>
          <h2 className="v-display size-secondary">{g.title}</h2>
          <p className="v-body" style={{ margin: '10px 0' }}>{g.body}</p>
          <button className="v-pill-primary" disabled={connecting} onClick={() => login(platform)}>
            {connecting ? 'Waiting for login…' : `Login with ${providerFor(platform)}`}
          </button>
          <button className="v-meta" style={{ marginLeft: 12 }} onClick={() => setStep('connections')}>← Back</button>
        </div>
        );
      })()}
    </Frame>
  );
}

function Frame({ title, logo, onClose, children }: {
  title: string; logo: string | null; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="v-canvas v-canvas--embed">
      <div className="v-shell">
        <header className="v-header">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ height: 24 }} />
          ) : (
            <span className="v-kicker mint">{title}</span>
          )}
          <button className="v-meta" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function labelFor(p: PlatformKey): string { return PLATFORMS.find((x) => x.key === p)?.label ?? p; }
function providerFor(p: PlatformKey): string { return PLATFORMS.find((x) => x.key === p)?.provider ?? p; }
function guidanceFor(p: PlatformKey): { title: string; body: string } {
  if (p === 'instagram') {
    return { title: 'Connecting Instagram works via Facebook', body: 'Select the Facebook Page linked to your Instagram business account and grant all requested permissions.' };
  }
  if (p === 'facebook') {
    return { title: 'Login with Facebook', body: 'Select the Page(s) you want to connect and grant all requested permissions.' };
  }
  return { title: `Login with ${providerFor(p)}`, body: 'You will be asked to approve read access to your profile and content. Grant all requested permissions.' };
}
