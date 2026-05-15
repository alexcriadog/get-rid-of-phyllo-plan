// Landing page — five tiles, one per platform. Each tile is a link to
// /api/oauth/start/{platform} (server-side route that 302s to the
// platform's authorize URL).
//
// Tiles where the corresponding *_APP_ID/*_CLIENT_ID is missing render
// disabled, with a hint to fill in `.env`.

import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { PlatformTile, type PlatformInfo } from '../components/PlatformTile';

type PageProps = {
  platforms: PlatformInfo[];
  pocAdminUrl: string;
  pocFeedUrl: string;
  /** ?error=… banner pass-through from cancelled OAuth flows. */
  errorBanner?: string;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const errorBanner =
    typeof ctx.query.error === 'string' ? ctx.query.error : undefined;
  // Derive the public feed URL from POC_ADMIN_URL by swapping the
  // trailing /admin segment for /feed. Avoids a second env var.
  const adminUrl = process.env.POC_ADMIN_URL ?? 'http://localhost:3001/admin';
  const feedUrl = adminUrl.replace(/\/admin\/?$/, '/feed');
  return {
    props: {
      errorBanner,
      pocAdminUrl: adminUrl,
      pocFeedUrl: feedUrl,
      platforms: [
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
            !!process.env.TWITCH_CLIENT_ID &&
            !!process.env.TWITCH_CLIENT_SECRET,
          missing: !process.env.TWITCH_CLIENT_ID
            ? 'TWITCH_CLIENT_ID'
            : !process.env.TWITCH_CLIENT_SECRET
              ? 'TWITCH_CLIENT_SECRET'
              : undefined,
        },
      ],
    },
  };
};

export default function Index({ platforms, pocAdminUrl, pocFeedUrl, errorBanner }: PageProps) {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker mint">connect-tool</span>
          <span className="v-eyebrow">Hand a token to the POC</span>
        </header>

        <h1 className="v-display size-hero">One click. One token.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 32 }}>
          Pick a platform. Approve the OAuth dialog. We hand the long-lived
          token to the POC&apos;s seed endpoint. The POC starts syncing.
        </p>

        {errorBanner && (
          <div className="v-banner danger">↯ {decodeURIComponent(errorBanner)}</div>
        )}

        <div className="v-grid">
          {platforms.map((p) => (
            <PlatformTile key={p.key} platform={p} />
          ))}
        </div>

        <footer className="v-footer">
          <span className="v-meta">Connected accounts live at</span>
          <Link className="v-pill-outline-mint" href={pocFeedUrl}>
            Public feed →
          </Link>
          <Link className="v-pill-outline-mint" href={pocAdminUrl}>
            POC admin →
          </Link>
        </footer>
      </div>
    </div>
  );
}
