// Exhaustive live snapshot of every data surface unlocked by the OAuth
// scopes the user just granted. Each fetcher runs in parallel and is
// independently captured as `Outcome<T>` so a single failure (e.g.
// Google Ads with a Test token) doesn't tear down the whole page.

import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { ScopeDemoCard } from '../../components/ScopeDemoCard';
import { getSession } from '../../lib/session';
import {
  describeGoogleError,
  fetchActivities,
  fetchChannel,
  fetchChannelTotals28d,
  fetchDemographics28d,
  fetchDevices28d,
  fetchGeography28d,
  fetchLiveBroadcasts,
  fetchMemberships,
  fetchPlaylists,
  fetchRecentVideos,
  fetchRetentionCurve,
  fetchSubscriptions,
  fetchTopVideos28d,
  fetchTrafficSources28d,
  fetchUserinfo,
  fetchVideoCountriesByVideo28d,
  fetchVideoDemographicsByVideo28d,
  fetchVideoDevicesByVideo28d,
  fetchVideoMetricsBatch28d,
  fetchVideoSharingByVideo28d,
  fetchVideoTrafficByVideo28d,
  fetchViews7d,
  formatDuration,
  type ActivitySummary,
  type BroadcastSummary,
  type ChannelMembershipsSummary,
  type ChannelSnapshot,
  type ChannelTotals28d,
  type CountryRow,
  type DemographicRow,
  type DeviceRow,
  type PlaylistSummary,
  type RetentionPoint,
  type SubscriptionSummary,
  type TopVideoRow,
  type TrafficSourceRow,
  type UserInfo,
  type VideoCountryRow,
  type VideoDemographicRow,
  type VideoDeviceRow,
  type VideoMetrics28d,
  type VideoSharingRow,
  type VideoSummary,
  type VideoTrafficRow,
  type ViewsByDay,
} from '../../lib/youtube';
import {
  describeGoogleAdsError,
  fetchAccessibleCustomers,
  fetchVideoCampaigns30d,
  type AccessibleCustomer,
  type VideoCampaignReport,
} from '../../lib/google-ads';

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

interface AdsSnapshot {
  customers: AccessibleCustomer[];
  primary: VideoCampaignReport | null;
}

type PageProps = {
  scopesGranted: string[];
  userinfo: Outcome<UserInfo>;
  channel: Outcome<ChannelSnapshot | null>;
  videos: Outcome<VideoSummary[]>;
  playlists: Outcome<PlaylistSummary[]>;
  subscriptions: Outcome<SubscriptionSummary[]>;
  broadcasts: Outcome<BroadcastSummary[]>;
  memberships: Outcome<ChannelMembershipsSummary>;
  activities: Outcome<ActivitySummary[]>;
  totals28d: Outcome<ChannelTotals28d>;
  views: Outcome<ViewsByDay>;
  topVideos: Outcome<TopVideoRow[]>;
  demographics: Outcome<DemographicRow[]>;
  geography: Outcome<CountryRow[]>;
  devices: Outcome<DeviceRow[]>;
  traffic: Outcome<TrafficSourceRow[]>;
  videoMetricsByVideo: Outcome<Record<string, VideoMetrics28d>>;
  videoTrafficByVideo: Outcome<Record<string, VideoTrafficRow[]>>;
  videoCountriesByVideo: Outcome<Record<string, VideoCountryRow[]>>;
  videoDevicesByVideo: Outcome<Record<string, VideoDeviceRow[]>>;
  videoDemographicsByVideo: Outcome<Record<string, VideoDemographicRow[]>>;
  videoSharingByVideo: Outcome<Record<string, VideoSharingRow[]>>;
  topVideoRetention: Outcome<{ videoId: string; points: RetentionPoint[] } | null>;
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

  const at = session.accessToken;

  // First pass: things the channel-derived calls depend on.
  const [userinfo, channel] = await Promise.all([
    safe(() => fetchUserinfo(at), describeGoogleError),
    safe(() => fetchChannel(at), describeGoogleError),
  ]);

  const uploadsId =
    channel.ok && channel.data?.uploadsPlaylistId
      ? channel.data.uploadsPlaylistId
      : null;

  // Second pass: most stuff in parallel, but we need the video list first
  // to know which IDs to batch-query for the per-video deep dive.
  const [
    videos,
    playlists,
    subscriptions,
    broadcasts,
    memberships,
    activities,
    totals28d,
    views,
    topVideos,
    demographics,
    geography,
    devices,
    traffic,
    ads,
  ] = await Promise.all([
    uploadsId
      ? safe(() => fetchRecentVideos(at, uploadsId, 12), describeGoogleError)
      : Promise.resolve<Outcome<VideoSummary[]>>({ ok: true, data: [] }),
    safe(() => fetchPlaylists(at, 12), describeGoogleError),
    safe(() => fetchSubscriptions(at, 12), describeGoogleError),
    safe(() => fetchLiveBroadcasts(at, 5), describeGoogleError),
    safe(() => fetchMemberships(at), describeGoogleError),
    safe(() => fetchActivities(at, 12), describeGoogleError),
    safe(() => fetchChannelTotals28d(at), describeGoogleError),
    safe(() => fetchViews7d(at), describeGoogleError),
    safe(() => fetchTopVideos28d(at, 10), describeGoogleError),
    safe(() => fetchDemographics28d(at), describeGoogleError),
    safe(() => fetchGeography28d(at, 10), describeGoogleError),
    safe(() => fetchDevices28d(at), describeGoogleError),
    safe(() => fetchTrafficSources28d(at), describeGoogleError),
    safe(() => fetchAdsSnapshot(at), describeGoogleAdsError),
  ]);

  // Third pass: per-video deep dive, batched (one call per dimension
  // covers all videoIds via filters=video==id1,id2,...).
  const videoIds: string[] = videos.ok ? videos.data.map((v) => v.id) : [];
  const topVideoForRetention: string | null = topVideos.ok && topVideos.data.length > 0
    ? topVideos.data[0].videoId
    : videoIds[0] ?? null;

  const [
    videoMetricsByVideo,
    videoTrafficByVideo,
    videoCountriesByVideo,
    videoDevicesByVideo,
    videoDemographicsByVideo,
    videoSharingByVideo,
    topVideoRetention,
  ] = await Promise.all([
    safe(() => fetchVideoMetricsBatch28d(at, videoIds), describeGoogleError),
    safe(() => fetchVideoTrafficByVideo28d(at, videoIds), describeGoogleError),
    safe(() => fetchVideoCountriesByVideo28d(at, videoIds), describeGoogleError),
    safe(() => fetchVideoDevicesByVideo28d(at, videoIds), describeGoogleError),
    safe(() => fetchVideoDemographicsByVideo28d(at, videoIds), describeGoogleError),
    safe(() => fetchVideoSharingByVideo28d(at, videoIds), describeGoogleError),
    topVideoForRetention
      ? safe(
          async () => ({
            videoId: topVideoForRetention,
            points: await fetchRetentionCurve(at, topVideoForRetention),
          }),
          describeGoogleError,
        )
      : Promise.resolve<Outcome<{ videoId: string; points: RetentionPoint[] } | null>>({
          ok: true,
          data: null,
        }),
  ]);

  return {
    props: {
      scopesGranted: session.scopes ?? [],
      userinfo,
      channel,
      videos,
      playlists,
      subscriptions,
      broadcasts,
      memberships,
      activities,
      totals28d,
      views,
      topVideos,
      demographics,
      geography,
      devices,
      traffic,
      videoMetricsByVideo,
      videoTrafficByVideo,
      videoCountriesByVideo,
      videoDevicesByVideo,
      videoDemographicsByVideo,
      videoSharingByVideo,
      topVideoRetention,
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
  if (customers.length === 0) return { customers, primary: null };
  const primary = await fetchVideoCampaigns30d(accessToken, customers[0].id);
  return { customers, primary };
}

// ─── Page component ────────────────────────────────────────────────────

export default function Verified(props: PageProps) {
  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <span className="v-kicker mint">connected</span>
          <span className="v-eyebrow">Camaleonic Analytics · YouTube</span>
        </header>

        <h1 className="v-display size-secondary">You&rsquo;re connected.</h1>
        <p className="v-body" style={{ maxWidth: 720 }}>
          Live snapshot of every data surface unlocked by the OAuth scopes
          you just granted. Each card maps to a specific scope and exercises
          its endpoints end-to-end.
        </p>

        {props.scopesGranted.length > 0 && (
          <div className="v-banner info" style={{ marginTop: 16 }}>
            Granted scopes: {props.scopesGranted.join(' · ')}
          </div>
        )}

        <IdentitySection userinfo={props.userinfo} />
        <YouTubeSection
          channel={props.channel}
          videos={props.videos}
          playlists={props.playlists}
          subscriptions={props.subscriptions}
          broadcasts={props.broadcasts}
          memberships={props.memberships}
          activities={props.activities}
        />
        <AnalyticsSection
          totals28d={props.totals28d}
          views={props.views}
          topVideos={props.topVideos}
          demographics={props.demographics}
          geography={props.geography}
          devices={props.devices}
          traffic={props.traffic}
        />
        <PerVideoSection
          videos={props.videos}
          videoMetricsByVideo={props.videoMetricsByVideo}
          videoTrafficByVideo={props.videoTrafficByVideo}
          videoCountriesByVideo={props.videoCountriesByVideo}
          videoDevicesByVideo={props.videoDevicesByVideo}
          videoDemographicsByVideo={props.videoDemographicsByVideo}
          videoSharingByVideo={props.videoSharingByVideo}
          topVideoRetention={props.topVideoRetention}
        />
        <AdsSection ads={props.ads} />

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

// ─── Section: Identity (OIDC) ──────────────────────────────────────────

function IdentitySection({ userinfo }: { userinfo: Outcome<UserInfo> }) {
  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">Identity</h2>
        <span className="v-section-scope">openid · userinfo.email · userinfo.profile</span>
      </div>
      <div className="v-scope-grid">
        <ScopeDemoCard
          title="Connected Google account"
          scope="GET /openidconnect/v1/userinfo"
          status={userinfo.ok ? 'ok' : 'err'}
        >
          {!userinfo.ok && <ErrorBlock message={userinfo.error} />}
          {userinfo.ok && (
            <>
              <div className="v-user" style={{ marginBottom: 14 }}>
                {userinfo.data.picture && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userinfo.data.picture} alt="" className="v-user-avatar" />
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
              <dl className="v-kv-list">
                <dt>Sub (Google ID)</dt>
                <dd><code>{userinfo.data.sub}</code></dd>
                <dt>Given name</dt>
                <dd>{userinfo.data.givenName ?? '—'}</dd>
                <dt>Family name</dt>
                <dd>{userinfo.data.familyName ?? '—'}</dd>
                <dt>Email verified</dt>
                <dd>{userinfo.data.emailVerified === undefined ? '—' : userinfo.data.emailVerified ? 'Yes' : 'No'}</dd>
                <dt>Locale</dt>
                <dd>{userinfo.data.locale ?? '—'}</dd>
                <dt>Workspace (hd)</dt>
                <dd>{userinfo.data.hd ?? <span style={{ color: 'var(--v-text-muted)' }}>personal Gmail</span>}</dd>
              </dl>
            </>
          )}
        </ScopeDemoCard>
      </div>
    </section>
  );
}

// ─── Section: YouTube Data API ─────────────────────────────────────────

function YouTubeSection(props: {
  channel: Outcome<ChannelSnapshot | null>;
  videos: Outcome<VideoSummary[]>;
  playlists: Outcome<PlaylistSummary[]>;
  subscriptions: Outcome<SubscriptionSummary[]>;
  broadcasts: Outcome<BroadcastSummary[]>;
  memberships: Outcome<ChannelMembershipsSummary>;
  activities: Outcome<ActivitySummary[]>;
}) {
  const { channel, videos, playlists, subscriptions, broadcasts, memberships, activities } = props;
  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">YouTube channel</h2>
        <span className="v-section-scope">youtube.readonly</span>
      </div>

      {/* Channel snapshot (full) */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Channel snapshot"
          scope="channels.list?mine=true · parts: snippet, statistics, contentDetails, brandingSettings, status, topicDetails"
          status={channel.ok ? (channel.data ? 'ok' : 'empty') : 'err'}
          statusLabel={channel.ok && !channel.data ? 'No channel' : undefined}
        >
          {!channel.ok && <ErrorBlock message={channel.error} />}
          {channel.ok && !channel.data && <p className="v-body muted">No channel returned.</p>}
          {channel.ok && channel.data && <ChannelDetail ch={channel.data} />}
        </ScopeDemoCard>
      </div>

      {/* Recent videos */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Recent videos"
          scope="playlistItems.list (uploads) + videos.list · parts: snippet, contentDetails, statistics, status"
          status={videos.ok ? (videos.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={videos.ok && videos.data.length === 0 ? 'No videos' : undefined}
        >
          {!videos.ok && <ErrorBlock message={videos.error} />}
          {videos.ok && videos.data.length === 0 && (
            <p className="v-body muted">The channel has no uploaded videos.</p>
          )}
          {videos.ok && videos.data.length > 0 && <VideoGrid videos={videos.data} />}
        </ScopeDemoCard>
      </div>

      {/* Playlists + Subscriptions in two columns */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Playlists"
          scope="playlists.list?mine=true · snippet, contentDetails, status"
          status={playlists.ok ? (playlists.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={playlists.ok && playlists.data.length === 0 ? 'No playlists' : undefined}
        >
          {!playlists.ok && <ErrorBlock message={playlists.error} />}
          {playlists.ok && playlists.data.length === 0 && (
            <p className="v-body muted">No playlists.</p>
          )}
          {playlists.ok && playlists.data.length > 0 && (
            <div>
              {playlists.data.map((p) => (
                <div key={p.id} className="v-list-row">
                  {p.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnailUrl} alt="" className="v-list-thumb square" />
                  )}
                  <div className="v-list-body">
                    <div className="v-list-title">{p.title ?? '(untitled)'}</div>
                    <div className="v-list-meta">
                      {p.privacyStatus ?? '—'} · {p.itemCount ?? 0} items
                      {p.publishedAt ? ` · ${formatDate(p.publishedAt)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Subscriptions"
          scope="subscriptions.list?mine=true · snippet, contentDetails"
          status={subscriptions.ok ? (subscriptions.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={subscriptions.ok && subscriptions.data.length === 0 ? 'No subs' : undefined}
        >
          {!subscriptions.ok && <ErrorBlock message={subscriptions.error} />}
          {subscriptions.ok && subscriptions.data.length === 0 && (
            <p className="v-body muted">This account doesn&rsquo;t follow any channels.</p>
          )}
          {subscriptions.ok && subscriptions.data.length > 0 && (
            <div>
              {subscriptions.data.map((s) => (
                <div key={s.channelId} className="v-list-row">
                  {s.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnailUrl} alt="" className="v-list-thumb" />
                  )}
                  <div className="v-list-body">
                    <div className="v-list-title">{s.channelTitle ?? s.channelId}</div>
                    <div className="v-list-meta">
                      {s.totalItemCount !== undefined ? `${s.totalItemCount} videos` : '—'}
                      {s.newItemCount ? ` · ${s.newItemCount} new` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScopeDemoCard>
      </div>

      {/* Live broadcasts (only show if any) + memberships + activities */}
      <div className="v-scope-grid">
        <ScopeDemoCard
          title="Live broadcasts"
          scope="liveBroadcasts.list?mine=true · snippet, status, statistics"
          status={broadcasts.ok ? (broadcasts.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={broadcasts.ok && broadcasts.data.length === 0 ? 'None' : undefined}
        >
          {!broadcasts.ok && <ErrorBlock message={broadcasts.error} />}
          {broadcasts.ok && broadcasts.data.length === 0 && (
            <p className="v-body muted">
              No past, scheduled, or currently-live broadcasts.
            </p>
          )}
          {broadcasts.ok && broadcasts.data.length > 0 && (
            <div>
              {broadcasts.data.map((b) => (
                <div key={b.id} className="v-list-row">
                  {b.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.thumbnailUrl} alt="" className="v-list-thumb square" />
                  )}
                  <div className="v-list-body">
                    <div className="v-list-title">{b.title ?? '(untitled)'}</div>
                    <div className="v-list-meta">
                      {b.lifeCycleStatus ?? '—'} · {b.privacyStatus ?? '—'}
                      {b.actualStartTime ? ` · started ${formatDate(b.actualStartTime)}` : ''}
                      {b.concurrentViewers ? ` · ${b.concurrentViewers} concurrent` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Channel memberships"
          scope="membershipsLevels.list + members.list"
          status={
            memberships.ok ? (memberships.data.enabled ? 'ok' : 'empty') : 'err'
          }
          statusLabel={
            memberships.ok && !memberships.data.enabled
              ? 'Not enabled'
              : undefined
          }
        >
          {!memberships.ok && <ErrorBlock message={memberships.error} />}
          {memberships.ok && !memberships.data.enabled && (
            <p className="v-body muted">
              This channel doesn&rsquo;t have YouTube Channel Memberships
              enabled (returns 403 channelMembershipsNotEnabled).
            </p>
          )}
          {memberships.ok && memberships.data.enabled && (
            <>
              <div className="v-stat">
                <span className="v-stat-num">{memberships.data.memberCount.toLocaleString()}</span>
                <span className="v-stat-unit">members</span>
              </div>
              <p className="v-body muted" style={{ marginTop: 6 }}>
                Tiers: {memberships.data.levels.length === 0 ? '—' :
                  memberships.data.levels.map((l) => l.displayName ?? l.id).join(' · ')}
              </p>
            </>
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Activities feed"
          scope="activities.list?mine=true · snippet"
          status={activities.ok ? (activities.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={activities.ok && activities.data.length === 0 ? 'No activities' : undefined}
        >
          {!activities.ok && <ErrorBlock message={activities.error} />}
          {activities.ok && activities.data.length === 0 && (
            <p className="v-body muted">No recent activities.</p>
          )}
          {activities.ok && activities.data.length > 0 && (
            <div>
              {activities.data.slice(0, 12).map((a) => (
                <div key={a.id} className="v-list-row">
                  {a.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt="" className="v-list-thumb square" />
                  )}
                  <div className="v-list-body">
                    <div className="v-list-title">{a.title ?? '(no title)'}</div>
                    <div className="v-list-meta">
                      {a.type ?? '—'}{a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScopeDemoCard>
      </div>
    </section>
  );
}

function ChannelDetail({ ch }: { ch: ChannelSnapshot }) {
  return (
    <>
      {ch.bannerUrl && (
        <div style={{ marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ch.bannerUrl} alt="" className="v-banner-img" />
        </div>
      )}
      <div className="v-user" style={{ marginBottom: 12 }}>
        {ch.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ch.thumbnailUrl} alt="" className="v-user-avatar" />
        )}
        <div>
          <div className="v-user-name">{ch.title ?? '(no title)'}</div>
          <div className="v-user-email">
            {ch.customUrl ?? ch.id}{ch.country ? ` · ${ch.country}` : ''}
          </div>
          <div className="v-stat">
            <span className="v-stat-num">{formatBigNumber(ch.subscriberCount)}</span>
            <span className="v-stat-unit">subscribers</span>
          </div>
          <p className="v-body muted" style={{ marginTop: 4 }}>
            {formatBigNumber(ch.videoCount)} videos · {formatBigNumber(ch.viewCount)} lifetime views
          </p>
        </div>
      </div>
      {ch.description && (
        <div className="v-description-block" style={{ marginBottom: 12 }}>
          {ch.description}
        </div>
      )}
      <dl className="v-kv-list">
        <dt>Channel ID</dt>
        <dd><code>{ch.id}</code></dd>
        <dt>Published</dt>
        <dd>{ch.publishedAt ? formatDate(ch.publishedAt) : '—'}</dd>
        <dt>Privacy</dt>
        <dd>{ch.privacyStatus ?? '—'}</dd>
        <dt>Long uploads</dt>
        <dd>{ch.longUploadsStatus ?? '—'}</dd>
        <dt>Made for kids</dt>
        <dd>{ch.madeForKids === undefined ? '—' : ch.madeForKids ? 'Yes' : 'No'}</dd>
        <dt>Hidden subs</dt>
        <dd>{ch.hiddenSubscriberCount === undefined ? '—' : ch.hiddenSubscriberCount ? 'Yes' : 'No'}</dd>
        <dt>Default language</dt>
        <dd>{ch.defaultLanguage ?? '—'}</dd>
        <dt>Uploads playlist</dt>
        <dd>{ch.uploadsPlaylistId ? <code>{ch.uploadsPlaylistId}</code> : '—'}</dd>
      </dl>
      {ch.keywords && (
        <div className="v-tag-list" style={{ marginTop: 10 }}>
          {ch.keywords.split(/[\s,]+/).filter(Boolean).slice(0, 20).map((k) => (
            <span key={k} className="v-tag-pill">{k}</span>
          ))}
        </div>
      )}
      {ch.topicCategories && ch.topicCategories.length > 0 && (
        <div className="v-tag-list" style={{ marginTop: 8 }}>
          {ch.topicCategories.map((t) => (
            <span key={t} className="v-tag-pill">
              {t.replace(/^.*\//, '')}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function VideoGrid({ videos }: { videos: VideoSummary[] }) {
  return (
    <div className="v-video-grid">
      {videos.map((v) => (
        <div key={v.id} className="v-video-card">
          <div className="v-video-thumb">
            {v.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnailUrl} alt="" />
            )}
            <div className="v-video-duration">{formatDuration(v.duration)}</div>
          </div>
          <div className="v-video-title">{v.title}</div>
          <div className="v-video-meta">
            <span>{formatBigNumber(v.viewCount)} views</span>
            <span>{formatBigNumber(v.likeCount)} likes</span>
            <span>{formatBigNumber(v.commentCount)} comments</span>
          </div>
          <div className="v-video-meta">
            <span>{v.privacyStatus ?? '—'}</span>
            <span>{v.definition?.toUpperCase() ?? '—'}</span>
            {v.publishedAt && <span>{formatDate(v.publishedAt)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section: YouTube Analytics ────────────────────────────────────────

function AnalyticsSection(props: {
  totals28d: Outcome<ChannelTotals28d>;
  views: Outcome<ViewsByDay>;
  topVideos: Outcome<TopVideoRow[]>;
  demographics: Outcome<DemographicRow[]>;
  geography: Outcome<CountryRow[]>;
  devices: Outcome<DeviceRow[]>;
  traffic: Outcome<TrafficSourceRow[]>;
}) {
  const { totals28d, views, topVideos, demographics, geography, devices, traffic } = props;
  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">YouTube Analytics</h2>
        <span className="v-section-scope">yt-analytics.readonly</span>
      </div>

      {/* Channel-wide totals (full row) */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Channel totals — last 28 days"
          scope="reports?metrics=views,minutes,likes,comments,shares,subs±,playlists±"
          status={totals28d.ok ? 'ok' : 'err'}
        >
          {!totals28d.ok && <ErrorBlock message={totals28d.error} />}
          {totals28d.ok && (
            <div className="v-totals-grid">
              <Totals label="Views" value={totals28d.data.views} />
              <Totals label="Watch time (min)" value={totals28d.data.estimatedMinutesWatched} />
              <Totals label="Avg view (s)" value={Math.round(totals28d.data.averageViewDuration)} />
              <Totals label="Likes" value={totals28d.data.likes} />
              <Totals label="Comments" value={totals28d.data.comments} />
              <Totals label="Shares" value={totals28d.data.shares} />
              <Totals label="Subs gained" value={totals28d.data.subscribersGained} />
              <Totals label="Subs lost" value={totals28d.data.subscribersLost} />
              <Totals label="Added to playlists" value={totals28d.data.videosAddedToPlaylists} />
              <Totals label="Removed from playlists" value={totals28d.data.videosRemovedFromPlaylists} />
            </div>
          )}
        </ScopeDemoCard>
      </div>

      {/* Views per day + Top videos */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Views — last 7 days"
          scope="reports?metrics=views&dimensions=day"
          status={views.ok ? (views.data.rows.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={views.ok && views.data.rows.length === 0 ? 'No views' : undefined}
        >
          {!views.ok && <ErrorBlock message={views.error} />}
          {views.ok && views.data.rows.length === 0 && (
            <p className="v-body muted">No views recorded in the window.</p>
          )}
          {views.ok && views.data.rows.length > 0 && (
            <>
              <div className="v-stat">
                <span className="v-stat-num">{views.data.totalViews.toLocaleString()}</span>
                <span className="v-stat-unit">views · 7d</span>
              </div>
              <table className="v-table">
                <thead><tr><th>Day</th><th style={{ textAlign: 'right' }}>Views</th></tr></thead>
                <tbody>
                  {views.data.rows.map((r) => (
                    <tr key={r.day}><td>{r.day}</td><td style={{ textAlign: 'right' }}>{r.views.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Top videos — last 28 days"
          scope="reports?metrics=views,minutes,avgDuration,likes,comments,shares,subs&dimensions=video"
          status={topVideos.ok ? (topVideos.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={topVideos.ok && topVideos.data.length === 0 ? 'No data' : undefined}
        >
          {!topVideos.ok && <ErrorBlock message={topVideos.error} />}
          {topVideos.ok && topVideos.data.length === 0 && (
            <p className="v-body muted">No video-level analytics in the window.</p>
          )}
          {topVideos.ok && topVideos.data.length > 0 && (
            <table className="v-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Min</th>
                  <th style={{ textAlign: 'right' }}>Subs+</th>
                </tr>
              </thead>
              <tbody>
                {topVideos.data.map((v) => (
                  <tr key={v.videoId}>
                    <td><code style={{ fontSize: 10 }}>{v.videoId}</code></td>
                    <td style={{ textAlign: 'right' }}>{v.views.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{v.estimatedMinutesWatched.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{v.subscribersGained}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScopeDemoCard>
      </div>

      {/* Demographics + Geography */}
      <div className="v-scope-grid" style={{ marginBottom: 20 }}>
        <ScopeDemoCard
          title="Audience demographics"
          scope="reports?metrics=viewerPercentage&dimensions=ageGroup,gender"
          status={demographics.ok ? (demographics.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={demographics.ok && demographics.data.length === 0 ? 'Not enough data' : undefined}
        >
          {!demographics.ok && <ErrorBlock message={demographics.error} />}
          {demographics.ok && demographics.data.length === 0 && (
            <p className="v-body muted">
              YouTube requires a minimum audience size before exposing
              demographic breakdowns. The endpoint returned 200 with no rows.
            </p>
          )}
          {demographics.ok && demographics.data.length > 0 && (
            <DemographicsBars rows={demographics.data} />
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Top countries"
          scope="reports?metrics=views,minutes,avgDuration&dimensions=country"
          status={geography.ok ? (geography.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={geography.ok && geography.data.length === 0 ? 'No data' : undefined}
        >
          {!geography.ok && <ErrorBlock message={geography.error} />}
          {geography.ok && geography.data.length === 0 && (
            <p className="v-body muted">No geographic breakdown in the window.</p>
          )}
          {geography.ok && geography.data.length > 0 && (
            <table className="v-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Watch min</th>
                  <th style={{ textAlign: 'right' }}>Avg dur (s)</th>
                </tr>
              </thead>
              <tbody>
                {geography.data.map((r) => (
                  <tr key={r.country}>
                    <td>{r.country}</td>
                    <td style={{ textAlign: 'right' }}>{r.views.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{r.estimatedMinutesWatched.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(r.averageViewDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScopeDemoCard>
      </div>

      {/* Devices + Traffic sources */}
      <div className="v-scope-grid">
        <ScopeDemoCard
          title="Device types"
          scope="reports?metrics=views,minutes&dimensions=deviceType"
          status={devices.ok ? (devices.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={devices.ok && devices.data.length === 0 ? 'No data' : undefined}
        >
          {!devices.ok && <ErrorBlock message={devices.error} />}
          {devices.ok && devices.data.length === 0 && (
            <p className="v-body muted">No device breakdown in the window.</p>
          )}
          {devices.ok && devices.data.length > 0 && (
            <DeviceBars rows={devices.data} />
          )}
        </ScopeDemoCard>

        <ScopeDemoCard
          title="Traffic sources"
          scope="reports?metrics=views,minutes,avgDuration&dimensions=insightTrafficSourceType"
          status={traffic.ok ? (traffic.data.length > 0 ? 'ok' : 'empty') : 'err'}
          statusLabel={traffic.ok && traffic.data.length === 0 ? 'No data' : undefined}
        >
          {!traffic.ok && <ErrorBlock message={traffic.error} />}
          {traffic.ok && traffic.data.length === 0 && (
            <p className="v-body muted">No traffic data in the window.</p>
          )}
          {traffic.ok && traffic.data.length > 0 && (
            <table className="v-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>Views</th>
                  <th style={{ textAlign: 'right' }}>Watch min</th>
                  <th style={{ textAlign: 'right' }}>Avg dur (s)</th>
                </tr>
              </thead>
              <tbody>
                {traffic.data.map((r) => (
                  <tr key={r.source}>
                    <td>{r.source}</td>
                    <td style={{ textAlign: 'right' }}>{r.views.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{r.estimatedMinutesWatched.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(r.averageViewDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScopeDemoCard>
      </div>
    </section>
  );
}

function Totals({ label, value }: { label: string; value: number }) {
  return (
    <div className="v-totals-cell">
      <div className="v-totals-label">{label}</div>
      <div className="v-totals-value">{value.toLocaleString()}</div>
    </div>
  );
}

function DemographicsBars({ rows }: { rows: DemographicRow[] }) {
  const byGender: Record<string, DemographicRow[]> = {};
  for (const r of rows) {
    (byGender[r.gender] ?? (byGender[r.gender] = [])).push(r);
  }
  const genders = Object.keys(byGender);
  if (genders.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.viewerPercentage), 1);
  return (
    <div className="v-demo-grid" style={{ gridTemplateColumns: `repeat(${genders.length}, 1fr)` }}>
      {genders.map((g) => (
        <div key={g} className="v-demo-col">
          <h4>{g}</h4>
          {byGender[g]
            .slice()
            .sort((a, b) => a.ageGroup.localeCompare(b.ageGroup))
            .map((r) => (
              <div className="v-bar" key={r.ageGroup + g}>
                <span className="v-bar-label">{r.ageGroup.replace('age', '')}</span>
                <div className="v-bar-track">
                  <div
                    className={`v-bar-fill${g === 'female' ? ' red' : ''}`}
                    style={{ width: `${Math.min(100, (r.viewerPercentage / max) * 100)}%` }}
                  />
                </div>
                <span className="v-bar-value">{r.viewerPercentage.toFixed(1)}%</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function DeviceBars({ rows }: { rows: DeviceRow[] }) {
  const total = rows.reduce((a, r) => a + r.views, 0) || 1;
  return (
    <div>
      {rows.map((r) => (
        <div className="v-bar" key={r.deviceType}>
          <span className="v-bar-label">{r.deviceType}</span>
          <div className="v-bar-track">
            <div
              className="v-bar-fill"
              style={{ width: `${(r.views / total) * 100}%` }}
            />
          </div>
          <span className="v-bar-value">{r.views.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Section: Per-video deep dive ──────────────────────────────────────

function PerVideoSection(props: {
  videos: Outcome<VideoSummary[]>;
  videoMetricsByVideo: Outcome<Record<string, VideoMetrics28d>>;
  videoTrafficByVideo: Outcome<Record<string, VideoTrafficRow[]>>;
  videoCountriesByVideo: Outcome<Record<string, VideoCountryRow[]>>;
  videoDevicesByVideo: Outcome<Record<string, VideoDeviceRow[]>>;
  videoDemographicsByVideo: Outcome<Record<string, VideoDemographicRow[]>>;
  videoSharingByVideo: Outcome<Record<string, VideoSharingRow[]>>;
  topVideoRetention: Outcome<{ videoId: string; points: RetentionPoint[] } | null>;
}) {
  const videos = props.videos.ok ? props.videos.data : [];
  if (videos.length === 0) {
    return (
      <section className="v-section">
        <div className="v-section-head">
          <h2 className="v-section-title">Per-video deep dive</h2>
          <span className="v-section-scope">videos.list + analytics filters=video==…</span>
        </div>
        <p className="v-body muted">No videos to drill into.</p>
      </section>
    );
  }

  // Sort: prefer videos with 28d analytics data, otherwise keep upload order.
  const metricsMap = props.videoMetricsByVideo.ok ? props.videoMetricsByVideo.data : {};
  const sorted = [...videos].sort((a, b) => {
    const va = metricsMap[a.id]?.views ?? 0;
    const vb = metricsMap[b.id]?.views ?? 0;
    return vb - va;
  });

  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">Per-video deep dive</h2>
        <span className="v-section-scope">
          videos.list parts + 6 batched analytics queries (filters=video==…)
        </span>
      </div>

      {/* Any top-level error from one of the batched calls shows once at the top. */}
      {!props.videoMetricsByVideo.ok && (
        <div className="v-banner danger">28d metrics: {props.videoMetricsByVideo.error}</div>
      )}

      <div className="v-scope-grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
        {sorted.map((v, idx) => (
          <VideoDeepDive
            key={v.id}
            video={v}
            metrics={metricsMap[v.id]}
            traffic={props.videoTrafficByVideo.ok ? props.videoTrafficByVideo.data[v.id] : undefined}
            countries={props.videoCountriesByVideo.ok ? props.videoCountriesByVideo.data[v.id] : undefined}
            devices={props.videoDevicesByVideo.ok ? props.videoDevicesByVideo.data[v.id] : undefined}
            demographics={props.videoDemographicsByVideo.ok ? props.videoDemographicsByVideo.data[v.id] : undefined}
            sharing={props.videoSharingByVideo.ok ? props.videoSharingByVideo.data[v.id] : undefined}
            retention={
              idx === 0 && props.topVideoRetention.ok && props.topVideoRetention.data && props.topVideoRetention.data.videoId === v.id
                ? props.topVideoRetention.data.points
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

function VideoDeepDive(props: {
  video: VideoSummary;
  metrics?: VideoMetrics28d;
  traffic?: VideoTrafficRow[];
  countries?: VideoCountryRow[];
  devices?: VideoDeviceRow[];
  demographics?: VideoDemographicRow[];
  sharing?: VideoSharingRow[];
  retention?: RetentionPoint[];
}) {
  const { video, metrics, traffic, countries, devices, demographics, sharing, retention } = props;
  return (
    <article className="v-card">
      {/* Header */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {video.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnailUrl}
            alt=""
            style={{ width: 200, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 18, color: '#fff' }}>{video.title}</h3>
          <div style={{ fontFamily: 'var(--v-mono)', fontSize: 11, color: 'var(--v-text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
            <code>{video.id}</code> · {formatDuration(video.duration)} · {video.definition?.toUpperCase() ?? '—'} · {video.privacyStatus ?? '—'}
            {video.publishedAt ? ` · ${formatDate(video.publishedAt)}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--v-mono)', fontSize: 12, color: 'var(--v-text-subtle)' }}>
            <span>{formatBigNumber(video.viewCount)} views lifetime</span>
            <span>{formatBigNumber(video.likeCount)} likes</span>
            <span>{formatBigNumber(video.commentCount)} comments</span>
          </div>
          {video.tags && video.tags.length > 0 && (
            <div className="v-tag-list" style={{ marginTop: 8 }}>
              {video.tags.slice(0, 8).map((t) => (
                <span key={t} className="v-tag-pill">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metadata flags + description */}
      <dl className="v-kv-list" style={{ marginBottom: 14 }}>
        <dt>Category</dt>
        <dd>{video.categoryId ? <code>{video.categoryId}</code> : '—'}</dd>
        <dt>Language</dt>
        <dd>{video.defaultLanguage ?? '—'}{video.defaultAudioLanguage && video.defaultAudioLanguage !== video.defaultLanguage ? ` (audio: ${video.defaultAudioLanguage})` : ''}</dd>
        <dt>Captions</dt>
        <dd>{video.caption === 'true' ? 'Yes' : video.caption === 'false' ? 'No' : '—'}</dd>
        <dt>Licensed</dt>
        <dd>{video.licensedContent === undefined ? '—' : video.licensedContent ? 'Yes' : 'No'}</dd>
        <dt>License</dt>
        <dd>{video.license ?? '—'}</dd>
        <dt>Embeddable</dt>
        <dd>{video.embeddable === undefined ? '—' : video.embeddable ? 'Yes' : 'No'}</dd>
        <dt>Public stats</dt>
        <dd>{video.publicStatsViewable === undefined ? '—' : video.publicStatsViewable ? 'Yes' : 'No'}</dd>
        <dt>Made for kids</dt>
        <dd>{video.madeForKids === undefined ? '—' : video.madeForKids ? 'Yes' : 'No'}</dd>
        <dt>Projection</dt>
        <dd>{video.projection ?? '—'}</dd>
        <dt>Dimension</dt>
        <dd>{video.dimension ?? '—'}</dd>
        <dt>Upload status</dt>
        <dd>{video.uploadStatus ?? '—'}</dd>
        <dt>Live state</dt>
        <dd>{video.liveBroadcastContent ?? '—'}</dd>
        {video.recordingDate && (<>
          <dt>Recorded</dt>
          <dd>{formatDate(video.recordingDate)}</dd>
        </>)}
        {video.recordingLocation?.latitude !== undefined && (<>
          <dt>Location</dt>
          <dd>
            <code>
              {video.recordingLocation.latitude.toFixed(4)}, {video.recordingLocation.longitude?.toFixed(4)}
            </code>
          </dd>
        </>)}
      </dl>

      {video.topicCategories && video.topicCategories.length > 0 && (
        <div className="v-tag-list" style={{ marginBottom: 14 }}>
          {video.topicCategories.map((t) => (
            <span key={t} className="v-tag-pill">{t.replace(/^.*\//, '')}</span>
          ))}
        </div>
      )}

      {video.liveStreaming && (video.liveStreaming.actualStartTime || video.liveStreaming.scheduledStartTime) && (
        <dl className="v-kv-list" style={{ marginBottom: 14 }}>
          {video.liveStreaming.scheduledStartTime && (<>
            <dt>Scheduled start</dt><dd>{formatDate(video.liveStreaming.scheduledStartTime)}</dd>
          </>)}
          {video.liveStreaming.actualStartTime && (<>
            <dt>Actual start</dt><dd>{formatDate(video.liveStreaming.actualStartTime)}</dd>
          </>)}
          {video.liveStreaming.actualEndTime && (<>
            <dt>Actual end</dt><dd>{formatDate(video.liveStreaming.actualEndTime)}</dd>
          </>)}
          {video.liveStreaming.concurrentViewers && (<>
            <dt>Concurrent viewers</dt><dd>{video.liveStreaming.concurrentViewers}</dd>
          </>)}
        </dl>
      )}

      {/* 28-day analytics grid */}
      {metrics ? (
        <>
          <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '4px 0 8px' }}>
            Analytics — last 28 days
          </h4>
          <div className="v-totals-grid">
            <Totals label="Views" value={metrics.views} />
            <Totals label="Engaged views" value={metrics.engagedViews} />
            <Totals label="Watch (min)" value={metrics.estimatedMinutesWatched} />
            <Totals label="Avg view (s)" value={Math.round(metrics.averageViewDuration)} />
            <Totals label="Avg view %" value={Math.round(metrics.averageViewPercentage)} />
            <Totals label="Likes" value={metrics.likes} />
            <Totals label="Dislikes" value={metrics.dislikes} />
            <Totals label="Comments" value={metrics.comments} />
            <Totals label="Shares" value={metrics.shares} />
            <Totals label="Subs gained" value={metrics.subscribersGained} />
            <Totals label="Subs lost" value={metrics.subscribersLost} />
            <Totals label="Added to playlists" value={metrics.videosAddedToPlaylists} />
            <Totals label="Removed from playlists" value={metrics.videosRemovedFromPlaylists} />
            <Totals label="Card impressions" value={metrics.cardImpressions} />
            <Totals label="Card clicks" value={metrics.cardClicks} />
            <Totals label="Card CTR %" value={Math.round(metrics.cardClickRate * 100) / 100} />
            <Totals label="Teaser impressions" value={metrics.cardTeaserImpressions} />
            <Totals label="Teaser clicks" value={metrics.cardTeaserClicks} />
            <Totals label="Teaser CTR %" value={Math.round(metrics.cardTeaserClickRate * 100) / 100} />
            <Totals label="Annotation impressions" value={metrics.annotationImpressions} />
            <Totals label="Annotation clicks" value={metrics.annotationClicks} />
            <Totals label="Annotation CTR %" value={Math.round(metrics.annotationClickThroughRate * 100) / 100} />
          </div>
        </>
      ) : (
        <p className="v-body muted" style={{ marginBottom: 14 }}>
          No 28-day analytics data for this video yet.
        </p>
      )}

      {/* Multi-column: traffic / countries / devices */}
      {(traffic?.length || countries?.length || devices?.length) ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 14 }}>
          {traffic && traffic.length > 0 && (
            <div>
              <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>Traffic sources</h4>
              {traffic.slice(0, 6).map((t) => (
                <div className="v-list-row" key={t.source} style={{ padding: '4px 0' }}>
                  <div className="v-list-body">
                    <div className="v-list-title" style={{ fontSize: 12 }}>{t.source}</div>
                  </div>
                  <span className="v-list-num">{t.views.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {countries && countries.length > 0 && (
            <div>
              <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>Top countries</h4>
              {countries.slice(0, 6).map((c) => (
                <div className="v-list-row" key={c.country} style={{ padding: '4px 0' }}>
                  <div className="v-list-body">
                    <div className="v-list-title" style={{ fontSize: 12 }}>{c.country}</div>
                  </div>
                  <span className="v-list-num">{c.views.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {devices && devices.length > 0 && (
            <div>
              <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>Devices</h4>
              {devices.map((d) => (
                <div className="v-list-row" key={d.deviceType} style={{ padding: '4px 0' }}>
                  <div className="v-list-body">
                    <div className="v-list-title" style={{ fontSize: 12 }}>{d.deviceType}</div>
                  </div>
                  <span className="v-list-num">{d.views.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          {sharing && sharing.length > 0 && (
            <div>
              <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>Sharing services</h4>
              {sharing.slice(0, 6).map((s) => (
                <div className="v-list-row" key={s.service} style={{ padding: '4px 0' }}>
                  <div className="v-list-body">
                    <div className="v-list-title" style={{ fontSize: 12 }}>{s.service}</div>
                  </div>
                  <span className="v-list-num">{s.shares.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Demographics */}
      {demographics && demographics.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>Audience demographics</h4>
          <DemographicsBars rows={demographics} />
        </div>
      )}

      {/* Retention curve (only for the top video) */}
      {retention && retention.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ fontFamily: 'var(--v-mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v-text-muted)', margin: '0 0 6px' }}>
            Audience retention (audienceWatchRatio · 90d)
          </h4>
          <RetentionChart points={retention} />
        </div>
      )}
    </article>
  );
}

function RetentionChart({ points }: { points: RetentionPoint[] }) {
  const W = 560;
  const H = 100;
  const padding = 4;
  const max = Math.max(...points.map((p) => p.audienceWatchRatio), 1);
  const pathD = points
    .map((p, i) => {
      const x = padding + p.elapsedRatio * (W - padding * 2);
      const y = H - padding - (p.audienceWatchRatio / max) * (H - padding * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Simple area fill underneath the line for readability.
  const areaD =
    pathD +
    ` L${(W - padding).toFixed(1)},${(H - padding).toFixed(1)} L${padding.toFixed(1)},${(H - padding).toFixed(1)} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: H, display: 'block', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}
      preserveAspectRatio="none"
    >
      <path d={areaD} fill="rgba(60,255,208,0.12)" />
      <path d={pathD} fill="none" stroke="var(--v-mint)" strokeWidth="1.5" />
      {/* Axis labels */}
      <text x={padding} y={H - 1} fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="var(--v-mono)">0%</text>
      <text x={W - 22} y={H - 1} fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="var(--v-mono)">100%</text>
    </svg>
  );
}

// ─── Section: Google Ads ───────────────────────────────────────────────

function AdsSection({ ads }: { ads: Outcome<AdsSnapshot> }) {
  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">Google Ads</h2>
        <span className="v-section-scope">adwords · Google Ads API v24</span>
      </div>
      <div className="v-scope-grid">
        <ScopeDemoCard
          title="YouTube ad campaigns — last 30 days"
          scope="listAccessibleCustomers + googleAds:search · advertising_channel_type=VIDEO"
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
              : ads.ok && ads.data.primary && ads.data.primary.rows.length === 0
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
                Connected to Google Ads customer <code>{ads.data.primary.customerId}</code>.
                No video campaigns served in the last 30 days. (
                {ads.data.customers.length}{' '}
                {ads.data.customers.length === 1 ? 'account' : 'accounts'} accessible.)
              </p>
            )}
          {ads.ok && ads.data.primary && ads.data.primary.rows.length > 0 && (
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
                      <td style={{ textAlign: 'right' }}>{c.videoViews.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        {c.averageCpvUsd !== null ? `$${c.averageCpvUsd.toFixed(3)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>${c.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </ScopeDemoCard>
      </div>
    </section>
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────

function ErrorBlock({ message }: { message: string }) {
  return <p className="v-body" style={{ color: '#ff8fa1' }}>{message}</p>;
}

function formatBigNumber(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return String(raw);
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
