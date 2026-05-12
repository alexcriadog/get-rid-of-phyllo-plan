// Landing page for verify-youtube. Single CTA → /api/oauth/start/youtube.
//
// Wording is deliberately explicit about what data we read and why, so it
// stays consistent with the OAuth consent screen, the privacy policy, and
// the demo video shown to Google's reviewers.

import Link from 'next/link';
import type { GetServerSideProps } from 'next';

type PageProps = {
  errorBanner: string | null;
  ready: boolean;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const errorBanner =
    typeof ctx.query.error === 'string' ? ctx.query.error : null;
  const ready = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return {
    props: { errorBanner, ready },
  };
};

export default function Index({ errorBanner, ready }: PageProps) {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker red">camaleonic analytics</span>
          <span className="v-eyebrow">YouTube connector</span>
        </header>

        <h1 className="v-display size-hero">Connect your YouTube channel.</h1>
        <p className="v-body" style={{ maxWidth: 680, marginBottom: 24 }}>
          Authorize Camaleonic Analytics to read your channel metadata,
          engagement metrics, and revenue reports — so you can see them on a
          single dashboard. Read-only access, your data never leaves your
          channel.
        </p>

        {errorBanner && (
          <div className="v-banner danger">↯ {decodeURIComponent(errorBanner)}</div>
        )}

        {!ready && (
          <div className="v-banner danger">
            Service misconfigured: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
            missing.
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0 12px' }}>
          <Link
            href="/api/oauth/start/youtube"
            className="v-pill-primary"
            aria-disabled={!ready}
            onClick={(e) => {
              if (!ready) e.preventDefault();
            }}
          >
            Connect with YouTube
          </Link>
          <Link href="/privacy" className="v-pill-outline">
            Privacy policy
          </Link>
          <Link href="/terms" className="v-pill-outline">
            Terms of service
          </Link>
        </div>

        <section style={{ marginTop: 56 }}>
          <h2 className="v-display size-tertiary">What we read, and why</h2>
          <ul className="v-body" style={{ paddingLeft: 18, marginTop: 12, lineHeight: 1.7 }}>
            <li>
              <strong>Your channel metadata</strong> (title, subscriber count,
              video count) — to identify the connected channel inside your
              dashboard.
            </li>
            <li>
              <strong>Audience engagement metrics</strong> (views, watch time,
              demographics) — to populate the engagement charts of your own
              content.
            </li>
            <li>
              <strong>YouTube ad campaigns</strong> (video views, view rate,
              cost-per-view, spend) — to show the performance of the YouTube
              video advertising campaigns you yourself run, via the Google
              Ads API. Read-only — we cannot create, modify, or pause
              campaigns.
            </li>
            <li>
              <strong>Your Google email and basic profile</strong> — to identify
              the Google account that performed the connection.
            </li>
          </ul>
          <p className="v-body muted" style={{ marginTop: 16 }}>
            Read-only. We never post, edit, or delete on your behalf. You can
            revoke access any time from{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--v-mint)' }}
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </section>

        <footer className="v-footer">
          <span>Camaleonic Analytics — YouTube connector</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </footer>
      </div>
    </div>
  );
}
