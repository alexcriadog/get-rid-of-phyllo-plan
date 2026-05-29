// Landing page — five platform tiles, one per provider. Each tile links
// to /api/oauth/start/{platform} which 302s to the upstream authorize URL.
//
// SDK-launched popups carry ?ws=<slug>&token=<jwt>&origin=<opener-origin>.
// We forward those params to every tile href so the dispatcher can verify
// the JWT and stash the workspace context in a cookie before the redirect.

import Link from 'next/link';
import axios from 'axios';
import { PlatformTile, type PlatformInfo } from '../components/PlatformTile';
import { internalAuthHeader } from '../lib/poc-internal';

interface Branding {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  title?: string;
  subtitle?: string;
  hide_platforms?: ReadonlyArray<string>;
}

type Search = {
  error?: string | string[];
  ws?: string | string[];
  token?: string | string[];
  origin?: string | string[];
};

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

async function fetchBranding(slug: string): Promise<Branding | null> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;
  try {
    const res = await axios.get<{ slug: string; branding: Branding | null }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true, headers: { ...internalAuthHeader() } },
    );
    if (res.status !== 200) return null;
    return res.data.branding;
  } catch {
    return null;
  }
}

function buildPlatforms(): PlatformInfo[] {
  return [
    {
      key: 'facebook',
      label: 'Facebook',
      subtitle: 'Pages + Instagram (via picker)',
      accent: 'blue',
      enabled: !!process.env.META_APP_ID && !!process.env.META_APP_SECRET,
      missing: !process.env.META_APP_ID
        ? 'META_APP_ID'
        : !process.env.META_APP_SECRET
          ? 'META_APP_SECRET'
          : undefined,
    },
    {
      key: 'youtube',
      label: 'YouTube',
      subtitle: 'Channel + Analytics',
      accent: 'red',
      enabled:
        !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      missing: !process.env.GOOGLE_CLIENT_ID
        ? 'GOOGLE_CLIENT_ID'
        : !process.env.GOOGLE_CLIENT_SECRET
          ? 'GOOGLE_CLIENT_SECRET'
          : undefined,
    },
    {
      key: 'tiktok',
      label: 'TikTok',
      subtitle: 'Business account',
      accent: 'cyan',
      enabled:
        !!process.env.TIKTOK_CLIENT_KEY &&
        !!process.env.TIKTOK_CLIENT_SECRET,
      missing: !process.env.TIKTOK_CLIENT_KEY
        ? 'TIKTOK_CLIENT_KEY'
        : !process.env.TIKTOK_CLIENT_SECRET
          ? 'TIKTOK_CLIENT_SECRET'
          : undefined,
    },
    {
      key: 'threads',
      label: 'Threads',
      subtitle: 'Posts + replies + insights',
      accent: 'mint',
      enabled:
        !!process.env.THREADS_APP_ID && !!process.env.THREADS_APP_SECRET,
      missing: !process.env.THREADS_APP_ID
        ? 'THREADS_APP_ID'
        : !process.env.THREADS_APP_SECRET
          ? 'THREADS_APP_SECRET'
          : undefined,
    },
    {
      key: 'twitch',
      label: 'Twitch',
      subtitle: 'VODs + clips + follower / sub counts',
      accent: 'purple',
      enabled:
        !!process.env.TWITCH_CLIENT_ID && !!process.env.TWITCH_CLIENT_SECRET,
      missing: !process.env.TWITCH_CLIENT_ID
        ? 'TWITCH_CLIENT_ID'
        : !process.env.TWITCH_CLIENT_SECRET
          ? 'TWITCH_CLIENT_SECRET'
          : undefined,
    },
  ];
}

export default async function Index({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Next 15 makes searchParams async; awaiting works on 14 too (just
  // resolves immediately).
  const sp = await searchParams;
  const errorBanner = first(sp.error) ?? undefined;
  const ws = first(sp.ws);
  const token = first(sp.token);
  const origin = first(sp.origin);

  const adminUrl = process.env.POC_ADMIN_URL ?? 'http://localhost:3001/admin';
  const pocFeedUrl = adminUrl.replace(/\/admin\/?$/, '/feed');

  const forwardParams = new URLSearchParams();
  if (ws) forwardParams.set('ws', ws);
  if (token) forwardParams.set('token', token);
  if (origin) forwardParams.set('origin', origin);
  const forwardQuery = forwardParams.toString() || undefined;
  const inPopup = !!forwardQuery;

  const branding = ws ? await fetchBranding(ws) : null;
  const platforms = buildPlatforms();
  const hide = new Set(branding?.hide_platforms ?? []);
  const visiblePlatforms = platforms.filter((p) => !hide.has(p.key));

  const title = branding?.title ?? 'One click. One token.';
  const subtitle =
    branding?.subtitle ??
    "Pick a platform. Approve the OAuth dialog. We hand the long-lived token to the POC's seed endpoint. The POC starts syncing.";

  const themeStyle: React.CSSProperties | undefined = branding
    ? ({
        ['--brand-primary' as never]: branding.primary_color ?? undefined,
        ['--brand-secondary' as never]: branding.secondary_color ?? undefined,
        ['--brand-accent' as never]: branding.accent_color ?? undefined,
        ['--brand-font' as never]: branding.font_family ?? undefined,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="v-canvas" style={themeStyle}>
      <div className="v-shell">
        <header className="v-header">
          {branding?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo_url}
              alt=""
              style={{ height: 32, width: 'auto' }}
            />
          ) : (
            <span className="v-kicker mint">connect-tool</span>
          )}
          <span className="v-eyebrow">
            {inPopup ? 'Connect your account' : 'Hand a token to the POC'}
          </span>
        </header>

        <h1 className="v-display size-hero">{title}</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 32 }}>
          {subtitle}
        </p>

        {errorBanner && <ErrorBanner raw={errorBanner} />}

        <div className="v-grid">
          {visiblePlatforms.map((p) => (
            <PlatformTile key={p.key} platform={p} query={forwardQuery} />
          ))}
        </div>

        {!inPopup && (
          <footer className="v-footer">
            <span className="v-meta">Connected accounts live at</span>
            <Link className="v-pill-outline-mint" href={pocFeedUrl}>
              Public feed →
            </Link>
            <Link className="v-pill-outline-mint" href={adminUrl}>
              POC admin →
            </Link>
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Error banner ──────────────────────────────────────────────────────────
//
// The dispatcher redirects to /?error=<message> on every OAuth-flow
// failure. We classify the message into a short bucket the end-user can
// understand (instead of leaking raw upstream errors) and surface a
// suggested action.

interface BannerKind {
  title: string;
  hint: string;
}

function classifyError(raw: string): BannerKind {
  const m = raw.toLowerCase();
  if (m.includes('sdk token') && m.includes('mismatch')) {
    return {
      title: "This connect link doesn't match the workspace it was issued for.",
      hint: 'Ask the app you came from to restart the connection — they need to mint a fresh SDK token for this workspace.',
    };
  }
  if (m.includes('sdk token') && (m.includes('expired') || m.includes('exp'))) {
    return {
      title: 'The connect link has expired.',
      hint: 'SDK tokens last 30 minutes. Restart the connection from the app you came from.',
    };
  }
  if (m.includes('sdk token') && m.includes('signature')) {
    return {
      title: 'This connect link was tampered with.',
      hint: 'Go back to the app you came from and start a fresh connection. If this keeps happening, contact support.',
    };
  }
  if (m.includes('platform') && m.includes('not allowed')) {
    return {
      title: 'This platform is not available for your account.',
      hint: "The app you came from didn't include this platform when issuing your connect link. Try a different one or ask them to re-issue.",
    };
  }
  if (m.includes('unknown platform')) {
    return {
      title: 'Unsupported platform.',
      hint: 'We connect Facebook, Instagram (via Facebook), TikTok, Threads, YouTube, and Twitch. Pick one of those.',
    };
  }
  if (m.includes('denied:') || m.includes('access_denied')) {
    return {
      title: 'You declined the permission dialog.',
      hint: "We can't connect the account without those permissions. Click a platform again to retry.",
    };
  }
  if (m.includes('callback missing ?code')) {
    return {
      title: 'The platform returned an empty response.',
      hint: 'This usually means the OAuth flow was cancelled mid-way. Try again.',
    };
  }
  if (m.includes('workspace not found')) {
    return {
      title: 'Workspace not found.',
      hint: 'Double-check the link you came from. If it was correct, contact the app that sent you.',
    };
  }
  return {
    title: 'Something went wrong.',
    hint: 'Try again, or contact the app you came from if this keeps happening.',
  };
}

function ErrorBanner({ raw }: { raw: string }) {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const kind = classifyError(decoded);
  return (
    <div
      className="v-banner danger"
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 18px',
        marginBottom: 24,
        borderRadius: 12,
      }}
    >
      <div style={{ fontWeight: 600 }}>↯ {kind.title}</div>
      <div style={{ fontSize: 13, opacity: 0.85 }}>{kind.hint}</div>
      <details style={{ marginTop: 4, fontSize: 11, opacity: 0.55 }}>
        <summary style={{ cursor: 'pointer' }}>Technical details</summary>
        <code
          style={{ display: 'block', marginTop: 4, fontFamily: 'monospace' }}
        >
          {decoded}
        </code>
      </details>
    </div>
  );
}
