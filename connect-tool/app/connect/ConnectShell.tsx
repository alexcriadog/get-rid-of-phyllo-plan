'use client';

import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../lib/connections';
import { initialStep, nextAfterConsent, isPlatformKey, type PlatformKey, type Step } from './shell-machine';
import { PlatformIcon, BRAND } from './PlatformIcon';

const ORDER: PlatformKey[] = ['instagram', 'facebook', 'youtube', 'tiktok', 'twitch', 'threads'];

// Instagram connects via Facebook OAuth (see lib/platforms.ts).
const startPlatform = (p: PlatformKey): PlatformKey => (p === 'instagram' ? 'facebook' : p);

const ShieldIcon = (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6l7-3z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </svg>
);
const CheckIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4 4L19 7" />
  </svg>
);

const TRUST = [
  { t: 'Your account is in safe hands', d: 'We never post or change anything without your action.' },
  { t: 'You stay in control', d: 'Approve only the accounts and permissions you choose.' },
  { t: 'Encrypted & secure', d: 'Your data is encrypted in transit and at rest.' },
];

interface Props {
  ws: string;
  token: string;
  origin: string;
  fixedPlatform?: PlatformKey;
  theme: 'light' | 'dark';
  accent: string | null;
  brandTitle: string;
  brandLogo: string | null;
  initialConnections: Connection[];
  tokenError: string | null;
  offeredPlatforms: string[] | null;
  /** Gate #2: true if `fixedPlatform` was passed but the workspace doesn't
   *  offer it. Render an "unavailable" state instead of consent → connect. */
  platformUnavailable: boolean;
}

export function ConnectShell(props: Props) {
  const init = initialStep(props.fixedPlatform);
  const [step, setStep] = useState<Step>(init.step);
  const [platform, setPlatform] = useState<PlatformKey | undefined>(init.platform);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(props.tokenError);
  const popupTimer = useRef<number | null>(null);

  // Size the modal to content. One-way: we post height; the host sets a
  // fixed pixel size, so this does not feed back into a resize loop.
  useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: 'camaleonic.connect.resize', height: document.body.scrollHeight },
        props.origin || window.location.origin,
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [step, error, connecting, props.origin]);

  // Relay from the provider-login window → navigate the iframe to the
  // existing confirm / page-picker page in embed mode.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; sessionId?: string; kind?: string; platform?: string };
      if (d?.type !== 'camaleonic.oauth.complete' || !d.sessionId) return;
      const msgPlatform = isPlatformKey(d.platform) ? d.platform : platform;
      const originQ = props.origin ? `&origin=${encodeURIComponent(props.origin)}` : '';
      const themeQ = `&theme=${props.theme}` + (props.accent ? `&accent=${encodeURIComponent(props.accent)}` : '');
      const dest =
        d.kind === 'fb-picker'
          ? `/facebook/pages?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}${themeQ}`
          : `/confirm/${encodeURIComponent(msgPlatform || '')}?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}${themeQ}`;
      if (d.kind !== 'fb-picker' && !msgPlatform) return;
      window.location.href = dest;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [platform, props.origin, props.theme, props.accent]);

  useEffect(() => () => { if (popupTimer.current !== null) window.clearInterval(popupTimer.current); }, []);

  function exit() {
    window.parent?.postMessage({ type: 'camaleonic.connect.exit' }, props.origin || window.location.origin);
  }

  function login(p: PlatformKey) {
    const sp = startPlatform(p);
    const qs = new URLSearchParams({ ws: props.ws, token: props.token, origin: props.origin, embed: '1' });
    const popup = window.open(`/api/oauth/start/${sp}?${qs.toString()}`, 'camaleonic-oauth', 'popup=yes,width=560,height=720');
    if (!popup) {
      setError('Your browser blocked the login window. Please allow pop-ups and try again.');
      window.parent?.postMessage(
        { type: 'camaleonic.connect.error', code: 'popup_blocked', message: 'Provider login popup blocked' },
        props.origin || window.location.origin,
      );
      return;
    }
    setConnecting(true);
    popupTimer.current = window.setInterval(() => {
      if (popup.closed) {
        if (popupTimer.current !== null) window.clearInterval(popupTimer.current);
        popupTimer.current = null;
        setConnecting(false);
      }
    }, 600);
  }

  const conns = platform ? props.initialConnections.filter((c) => c.platform === platform) : [];

  const rootStyle = props.accent
    ? ({ ['--cml-accent']: props.accent, ['--cml-on-accent']: '#ffffff' } as React.CSSProperties)
    : undefined;

  return (
    <div className="cml" data-theme={props.theme} style={rootStyle}>
      <header className="cml-head">
        <div className="cml-brand">
          {props.brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cml-brand__logo" src={props.brandLogo} alt="" />
          ) : (
            <span className="cml-brand__name">Camaleonic</span>
          )}
        </div>
      </header>

      <div className="cml-body">
        {error ? (
          <div className="cml-step">
            <div className="cml-banner cml-banner--danger">{error}</div>
            <div className="cml-link-row" style={{ marginTop: 16 }}>
              <button className="cml-ghost" onClick={exit}>Close</button>
            </div>
          </div>
        ) : props.platformUnavailable && props.fixedPlatform ? (
          <div className="cml-step cml-center">
            <div className="cml-hero"><PlatformIcon platform={props.fixedPlatform} large /></div>
            <h2 className="cml-title">{BRAND[props.fixedPlatform].label} isn’t available here</h2>
            <p className="cml-sub">
              This workspace hasn’t enabled {BRAND[props.fixedPlatform].label}.
              Contact your administrator if you need it turned on.
            </p>
            <button className="cml-btn cml-btn--accent" onClick={exit}>Close</button>
          </div>
        ) : step === 'consent' ? (
          <div className="cml-step cml-center">
            <div className="cml-hero"><span className="cml-hero__ring">{ShieldIcon}</span></div>
            <h2 className="cml-title">Connect your accounts</h2>
            <p className="cml-sub">Camaleonic Analytics will securely link your social accounts. You decide what to share.</p>
            <ul className="cml-trust">
              {TRUST.map((b) => (
                <li key={b.t}>
                  <span className="cml-trust__chk">{CheckIcon}</span>
                  <span><span className="cml-trust__t">{b.t}</span><span className="cml-trust__d">{b.d}</span></span>
                </li>
              ))}
            </ul>
            <button className="cml-btn cml-btn--accent" onClick={() => setStep(nextAfterConsent(props.fixedPlatform))}>Continue</button>
          </div>
        ) : step === 'chooser' ? (
          <div className="cml-step">
            <h2 className="cml-title">Select a platform</h2>
            <p className="cml-sub">Choose where you’d like to connect an account.</p>
            <div className="cml-grid">
              {ORDER.filter((p) => !props.offeredPlatforms || props.offeredPlatforms.includes(p)).map((p) => (
                <button key={p} className="cml-tile" onClick={() => { setPlatform(p); setStep('connections'); }}>
                  <PlatformIcon platform={p} />
                  <span className="cml-tile__label">{BRAND[p].label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : step === 'connections' && platform ? (
          <div className="cml-step">
            <h2 className="cml-title">{BRAND[platform].label} accounts</h2>
            <p className="cml-sub">Manage your connected accounts or add a new one.</p>
            <div className="cml-list">
              {conns.length === 0 ? (
                <div className="cml-empty">No {BRAND[platform].label} accounts connected yet.</div>
              ) : (
                conns.map((c) => (
                  <div key={c.id} className="cml-row">
                    <PlatformIcon platform={platform} />
                    <div className="cml-row__meta">
                      <div className="cml-row__name">{c.handle || c.display_name || c.id}</div>
                      <div className="cml-row__sub">{c.status}</div>
                    </div>
                    {c.status === 'ready' && <span className="cml-status">Connected</span>}
                  </div>
                ))
              )}
            </div>
            <button className="cml-btn cml-btn--accent" onClick={() => setStep('guidance')}>
              + Add {BRAND[platform].label} account
            </button>
            {!props.fixedPlatform && (
              <div className="cml-link-row"><button className="cml-ghost" onClick={() => setStep('chooser')}>← All platforms</button></div>
            )}
          </div>
        ) : step === 'guidance' && platform ? (
          <div className="cml-step cml-center">
            <div className="cml-hero"><PlatformIcon platform={platform} large /></div>
            <h2 className="cml-title">{guidance(platform).title}</h2>
            <p className="cml-sub">{guidance(platform).body}</p>
            <div className="cml-btn__row">
              <button
                className="cml-btn cml-btn--brand"
                style={{ background: BRAND[startPlatform(platform)].bg }}
                disabled={connecting}
                onClick={() => login(platform)}
              >
                {connecting ? 'Waiting for login…' : `Continue with ${BRAND[platform].provider}`}
              </button>
            </div>
            <div className="cml-link-row"><button className="cml-ghost" onClick={() => setStep('connections')}>← Back</button></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function guidance(p: PlatformKey): { title: string; body: string } {
  if (p === 'instagram') {
    return {
      title: 'Connect Instagram via Facebook',
      body: 'Instagram business accounts connect through Facebook. Select the linked Page and grant all requested permissions.',
    };
  }
  if (p === 'facebook') {
    return {
      title: 'Connect with Facebook',
      body: 'Select the Page(s) you want to connect and grant all requested permissions on the next screen.',
    };
  }
  return {
    title: `Connect with ${BRAND[p].label}`,
    body: `You’ll be asked to approve read access to your ${BRAND[p].label} profile and content. Please grant all requested permissions.`,
  };
}
