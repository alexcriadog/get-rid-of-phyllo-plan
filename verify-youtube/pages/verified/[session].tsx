// Página que enseña al revisor de Google que cada scope solicitado se
// usa de verdad. SSR llama a cada endpoint en paralelo con el
// access_token recién obtenido. Si algún scope falla, lo reportamos en
// la tarjeta correspondiente sin tirar la página entera.

import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { ScopeDemoCard } from '../../components/ScopeDemoCard';
import { getSession } from '../../lib/session';
import {
  describeGoogleError,
  fetchChannel,
  fetchUserinfo,
  fetchViews7d,
  type ChannelSnapshot,
  type UserInfo,
  type ViewsByDay,
} from '../../lib/youtube';
import {
  describeGoogleAdsError,
  fetchAccessibleCustomers,
  fetchVideoCampaigns30d,
  type AccessibleCustomer,
  type VideoCampaignReport,
} from '../../lib/google-ads';

type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface AdsSnapshot {
  customers: AccessibleCustomer[];
  /** First customer's video campaign report, null if no customers. */
  primary: VideoCampaignReport | null;
}

type PageProps = {
  scopesGranted: string[];
  userinfo: Outcome<UserInfo>;
  channel: Outcome<ChannelSnapshot | null>;
  views: Outcome<ViewsByDay>;
  ads: Outcome<AdsSnapshot>;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const sessionId = ctx.params?.session;
  if (typeof sessionId !== 'string' || !sessionId) {
    return { redirect: { destination: '/?error=missing+session', permanent: false } };
  }
  const session = getSession(sessionId);
  if (!session) {
    return {
      redirect: {
        destination: '/?error=' + encodeURIComponent('Session expired. Reconnect.'),
        permanent: false,
      },
    };
  }

  const accessToken = session.accessToken;
  const [userinfo, channel, views, ads] = await Promise.all([
    safe(() => fetchUserinfo(accessToken), describeGoogleError),
    safe(() => fetchChannel(accessToken), describeGoogleError),
    safe(() => fetchViews7d(accessToken), describeGoogleError),
    safe(() => fetchAdsSnapshot(accessToken), describeGoogleAdsError),
  ]);

  // We don't drop the session here — the reviewer may want to refresh the
  // page during the screen recording. Sessions self-expire after 10 min.

  return {
    props: {
      scopesGranted: session.scopes ?? [],
      userinfo,
      channel,
      views,
      ads,
    },
  };
};

async function safe<T>(
  fn: () => Promise<T>,
  describe: (err: unknown) => string,
): Promise<Outcome<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

async function fetchAdsSnapshot(accessToken: string): Promise<AdsSnapshot> {
  const customers = await fetchAccessibleCustomers(accessToken);
  if (customers.length === 0) {
    return { customers, primary: null };
  }
  // Demo: query the first accessible customer. Real product would let
  // the user pick which account to view.
  const primary = await fetchVideoCampaigns30d(accessToken, customers[0].id);
  return { customers, primary };
}

export default function Verified({
  scopesGranted,
  userinfo,
  channel,
  views,
  ads,
}: PageProps) {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker mint">connected</span>
          <span className="v-eyebrow">Camaleonic Analytics · YouTube</span>
        </header>

        <h1 className="v-display size-secondary">You&rsquo;re connected.</h1>
        <p className="v-body" style={{ maxWidth: 720 }}>
          Below is a live snapshot of the data we just fetched from your
          YouTube account, one card per OAuth scope you granted.
        </p>

        {scopesGranted.length > 0 && (
          <div className="v-banner info" style={{ marginTop: 16 }}>
            Granted scopes: {scopesGranted.join(' · ')}
          </div>
        )}

        <section className="v-scope-grid">
          {/* openid + userinfo.email + userinfo.profile */}
          <ScopeDemoCard
            title="Connected Google account"
            scope="openid · userinfo.email · userinfo.profile"
            status={userinfo.ok ? 'ok' : 'err'}
          >
            {userinfo.ok ? (
              <div className="v-user">
                {userinfo.data.picture && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={userinfo.data.picture}
                    alt=""
                    className="v-user-avatar"
                  />
                )}
                <div>
                  <div className="v-user-name">
                    {userinfo.data.name ?? '(no name)'}
                  </div>
                  <div className="v-user-email">
                    {userinfo.data.email ?? '(no email)'}
                  </div>
                </div>
              </div>
            ) : (
              <ErrorBlock message={userinfo.error} />
            )}
          </ScopeDemoCard>

          {/* youtube.readonly */}
          <ScopeDemoCard
            title="Channel snapshot"
            scope="https://www.googleapis.com/auth/youtube.readonly"
            status={channel.ok ? (channel.data ? 'ok' : 'empty') : 'err'}
            statusLabel={
              channel.ok && !channel.data ? 'No channel' : undefined
            }
          >
            {!channel.ok && <ErrorBlock message={channel.error} />}
            {channel.ok && !channel.data && (
              <p className="v-body muted">
                Google returned no channels for this user.
              </p>
            )}
            {channel.ok && channel.data && (
              <div className="v-user">
                {channel.data.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={channel.data.thumbnailUrl}
                    alt=""
                    className="v-user-avatar"
                  />
                )}
                <div>
                  <div className="v-user-name">
                    {channel.data.title ?? '(no title)'}
                  </div>
                  <div className="v-user-email">
                    {channel.data.customUrl ?? channel.data.id}
                    {channel.data.country ? ` · ${channel.data.country}` : ''}
                  </div>
                  <div className="v-stat">
                    <span className="v-stat-num">
                      {formatBigNumber(channel.data.subscriberCount)}
                    </span>
                    <span className="v-stat-unit">subscribers</span>
                  </div>
                  <p className="v-body muted" style={{ marginTop: 4 }}>
                    {formatBigNumber(channel.data.videoCount)} videos ·{' '}
                    {formatBigNumber(channel.data.viewCount)} lifetime views
                  </p>
                </div>
              </div>
            )}
          </ScopeDemoCard>

          {/* yt-analytics.readonly */}
          <ScopeDemoCard
            title="Views — last 7 days"
            scope="https://www.googleapis.com/auth/yt-analytics.readonly"
            status={
              views.ok ? (views.data.rows.length > 0 ? 'ok' : 'empty') : 'err'
            }
            statusLabel={
              views.ok && views.data.rows.length === 0
                ? 'No views'
                : undefined
            }
          >
            {!views.ok && <ErrorBlock message={views.error} />}
            {views.ok && views.data.rows.length === 0 && (
              <p className="v-body muted">No views recorded in the window.</p>
            )}
            {views.ok && views.data.rows.length > 0 && (
              <>
                <div className="v-stat">
                  <span className="v-stat-num">
                    {views.data.totalViews.toLocaleString()}
                  </span>
                  <span className="v-stat-unit">views · 7d</span>
                </div>
                <table className="v-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th style={{ textAlign: 'right' }}>Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {views.data.rows.map((r) => (
                      <tr key={r.day}>
                        <td>{r.day}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.views.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </ScopeDemoCard>

          {/* adwords — Google Ads API */}
          <ScopeDemoCard
            title="YouTube ad campaigns — last 30 days"
            scope="https://www.googleapis.com/auth/adwords"
            status={
              ads.ok
                ? ads.data.primary && ads.data.primary.rows.length > 0
                  ? 'ok'
                  : 'empty'
                : 'err'
            }
            statusLabel={
              ads.ok && ads.data.customers.length === 0
                ? 'No Ads accounts'
                : ads.ok &&
                    ads.data.primary &&
                    ads.data.primary.rows.length === 0
                  ? 'No video campaigns'
                  : undefined
            }
          >
            {!ads.ok && <ErrorBlock message={ads.error} />}
            {ads.ok && ads.data.customers.length === 0 && (
              <p className="v-body muted">
                This Google account has no Google Ads accounts associated.
                The <code>listAccessibleCustomers</code> call returned an
                empty list — which confirms the <code>adwords</code> scope
                is granted and the developer token is valid.
              </p>
            )}
            {ads.ok &&
              ads.data.customers.length > 0 &&
              ads.data.primary &&
              ads.data.primary.rows.length === 0 && (
                <p className="v-body muted">
                  Connected to Google Ads customer{' '}
                  <code>{ads.data.primary.customerId}</code>. No video
                  campaigns served in the last 30 days. (
                  {ads.data.customers.length}{' '}
                  {ads.data.customers.length === 1 ? 'account' : 'accounts'}{' '}
                  accessible.)
                </p>
              )}
            {ads.ok &&
              ads.data.primary &&
              ads.data.primary.rows.length > 0 && (
                <>
                  <p className="v-body muted" style={{ marginBottom: 6 }}>
                    Customer <code>{ads.data.primary.customerId}</code>
                    {ads.data.customers.length > 1
                      ? ` · ${ads.data.customers.length} accounts accessible`
                      : ''}
                  </p>
                  <div className="v-stat">
                    <span className="v-stat-num">
                      {ads.data.primary.totalViews.toLocaleString()}
                    </span>
                    <span className="v-stat-unit">video views · 30d</span>
                  </div>
                  <p className="v-body muted" style={{ marginTop: 4 }}>
                    Spend: ${ads.data.primary.totalCostUsd.toFixed(2)} USD
                  </p>
                  <table className="v-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th style={{ textAlign: 'right' }}>Views</th>
                        <th style={{ textAlign: 'right' }}>Avg CPV</th>
                        <th style={{ textAlign: 'right' }}>Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ads.data.primary.rows.slice(0, 10).map((c) => (
                        <tr key={c.campaignId}>
                          <td title={c.status}>{c.campaignName}</td>
                          <td style={{ textAlign: 'right' }}>
                            {c.videoViews.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {c.averageCpvUsd !== null
                              ? `$${c.averageCpvUsd.toFixed(3)}`
                              : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            ${c.costUsd.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
          </ScopeDemoCard>

        </section>

        <footer className="v-footer">
          <Link href="/">← Back</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>
            Revoke access at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/permissions
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="v-body" style={{ color: '#ff8fa1' }}>
      {message}
    </p>
  );
}

function formatBigNumber(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return String(raw);
  return n.toLocaleString();
}

