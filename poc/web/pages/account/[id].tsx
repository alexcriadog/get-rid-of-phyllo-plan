import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../lib/mongo';
import { fmtNumber } from '../../lib/format';
import { RelativeTime } from '../../components/RelativeTime';
import { refreshAccount } from '../../lib/api';

type IdentityData = {
  username?: string;
  displayName?: string;
  biography?: string;
  avatarUrl?: string;
  profileUrl?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  verified?: boolean;
  accountType?: string;
};

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: IdentityData;
  updated_at?: string;
};

type Distribution = Array<{ label: string; value: number }>;

type DemographicBreakdownError = {
  breakdown: 'age' | 'gender' | 'country' | 'city';
  message: string;
  code?: number;
  subcode?: number;
};

type DemographicTimeframe = 'this_week' | 'this_month' | 'prev_month';

type DemographicGroup = {
  genderDistribution?: Distribution;
  ageDistribution?: Distribution;
  countryDistribution?: Distribution;
  cityDistribution?: Distribution;
  errors?: DemographicBreakdownError[];
  /**
   * IG fetches reached/engaged demographics across all 3 Graph windows
   * (`this_week`, `this_month`, `prev_month`). When present, the UI
   * shows a sub-selector and reads from this map.
   */
  byTimeframe?: Partial<Record<DemographicTimeframe, DemographicGroup>>;
};

const TIMEFRAME_LABELS: Record<DemographicTimeframe, string> = {
  this_week: 'This week',
  this_month: 'This month',
  prev_month: 'Prev month',
};

// Meta documents these as ROLLING windows, not calendar week/month —
// surfaced as tooltips so the operator isn't confused on the 7th of
// the month wondering whether `this_month` means May 1-7 or Apr 7-May 7.
const TIMEFRAME_TOOLTIPS: Record<DemographicTimeframe, string> = {
  this_week: 'Last 7 days (rolling)',
  this_month: 'Last 30 days (rolling)',
  prev_month: '30 to 60 days ago (the 30 days before "This month")',
};

type AccountInsights = {
  periodDays?: number;
  reach?: number;
  impressions?: number;
  accountsEngaged?: number;
  totalInteractions?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  replies?: number;
  views?: number;
  profileViews?: number;
  websiteClicks?: number;
  emailContacts?: number;
  phoneCallClicks?: number;
  textMessageClicks?: number;
  getDirectionsClicks?: number;
  followerCountSeries?: Array<{ endTime: string; value: number }>;
  /** 24-bucket "when followers are online" / "when audience engages" curve. */
  audienceActivity?: Array<{ hour: number; count: number }>;
  /** 7×24 weekly heatmap: dayOfWeek 0..6 (0=Sun) × hour 0..23. */
  audienceActivityWeekly?: Array<{ dayOfWeek: number; hour: number; count: number }>;
  extra?: Record<string, number>;
};

type AudienceData = DemographicGroup & {
  reachedDemographics?: DemographicGroup;
  engagedDemographics?: DemographicGroup;
  accountInsights?: AccountInsights;
  fetchedAt?: string;
};

type AudienceSnapshot = {
  account_id: string;
  data?: AudienceData;
  updated_at?: string;
};

type PostData = {
  platformContentId?: string;
  contentType?: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrls?: string[];
  thumbnailUrl?: string | null;
  metrics?: { likes?: number; comments?: number };
  publishedAt?: string | null;
};

type Post = {
  account_id: string;
  platform: string;
  platform_content_id: string;
  data?: PostData;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  audience: AudienceSnapshot | null;
  posts: Post[];
};

// Platforms whose adapters implement `fetchMentions` and surface mentions
// in the canonical `posts` collection (with `data.ownerHandle` !== self).
// Mirrors the support matrix at /admin/support-matrix; keep in sync if a
// platform gains/loses the product.
const PLATFORMS_WITH_MENTIONS = new Set<string>(['tiktok', 'threads', 'facebook']);
// CA-only Meta extras (pages_read_user_content / ads_read / PPCA). Surfaced
// only for facebook accounts since they piggy-back on those scopes.
const PLATFORMS_WITH_CA_EXTRAS = new Set<string>(['facebook']);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const [identityDoc, audienceDoc, postDocs] = await Promise.all([
      db.collection('identity_snapshots').findOne({ $or: filters }),
      db.collection('audience_snapshots').findOne({ $or: filters }, { sort: { captured_at: -1 } }),
      db
        .collection('posts')
        .find({ $or: filters })
        .sort({ 'data.publishedAt': -1, updated_at: -1 })
        .limit(8)
        .toArray(),
    ]);
    return {
      props: {
        id,
        identity: identityDoc ? (toPlainJson(identityDoc) as IdentitySnapshot) : null,
        audience: audienceDoc ? (toPlainJson(audienceDoc) as AudienceSnapshot) : null,
        posts: postDocs.map((p) => toPlainJson(p) as Post),
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, audience: null, posts: [] } };
  }
};

function toPlainJson(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value === 'object') {
    const maybeHex = (value as { toHexString?: () => string }).toHexString;
    if (typeof maybeHex === 'function') return maybeHex.call(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlainJson(v);
    }
    return out;
  }
  return value;
}

export default function AccountDetail({ id, identity, audience, posts }: PageProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshAccount(id);
      if (!res.ok && res.status !== 202) throw new Error(`${res.status} ${res.statusText}`);
      setTimeout(() => window.location.reload(), 30000);
    } catch (e) {
      setError((e as Error).message);
      setRefreshing(false);
    }
  };

  const aud = audience?.data;

  return (
    <div className="v-canvas">
      <div
        style={{
          maxWidth: 1300,
          margin: '0 auto',
          padding: '32px 48px 96px',
        }}
      >
        {/* top bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <Link
            href="/"
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--v-text-muted)',
            }}
          >
            ← The Feed
          </Link>
          <div style={{ flex: 1 }} />
          <Link href={`/account/${id}/posts`} className="v-pill-outline-mint">
            All posts ({posts.length > 0 ? '…' : '0'})
          </Link>
          {PLATFORMS_WITH_MENTIONS.has(identity?.platform ?? '') && (
            <Link href={`/account/${id}/mentions`} className="v-pill-outline-mint">
              Mentions
            </Link>
          )}
          {PLATFORMS_WITH_CA_EXTRAS.has(identity?.platform ?? '') && (
            <>
              <Link
                href={`/account/${id}/reviews`}
                className="v-pill-outline-mint"
              >
                Reviews
              </Link>
              <Link href={`/account/${id}/ads`} className="v-pill-outline-mint">
                Ads
              </Link>
              <Link
                href={`/account/${id}/public-pages`}
                className="v-pill-outline-mint"
              >
                Watchlist
              </Link>
            </>
          )}
          <button className="v-pill-primary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </header>

        {error && (
          <div
            style={{
              border: '1px solid #5200ff',
              padding: 16,
              borderRadius: 20,
              color: '#fff',
              marginBottom: 24,
              fontFamily: 'var(--v-mono)',
              fontSize: 12,
            }}
          >
            ↯ refresh failed — {error}
          </div>
        )}
        {refreshing && !error && (
          <div
            style={{
              border: '1px solid #3cffd0',
              padding: 16,
              borderRadius: 20,
              color: '#3cffd0',
              marginBottom: 24,
              fontFamily: 'var(--v-mono)',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            ◉ queued — page reloads in 30s
          </div>
        )}

        {!identity ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <div className="v-kicker mint" style={{ marginBottom: 8 }}>
              404
            </div>
            <h2 className="v-display size-tertiary">Account {id} not found</h2>
            <p className="v-body" style={{ marginTop: 12 }}>
              No identity snapshot yet. The worker may not have synced this account.
            </p>
          </div>
        ) : (
          <>
            <ProfileHero identity={identity} audience={audience} />

            {aud?.accountInsights && (
              <PanelAccountInsights
                insights={aud.accountInsights}
                followersCount={
                  typeof identity.data?.followersCount === 'number'
                    ? identity.data.followersCount
                    : typeof aud.accountInsights.extra?.followers_count_current === 'number'
                      ? (aud.accountInsights.extra.followers_count_current as number)
                      : undefined
                }
              />
            )}

            <PanelDemographics aud={aud ?? null} platform={identity.platform} />

            {/* Latest posts */}
            <div style={{ marginTop: 40 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <span className="v-kicker mint">Stream</span>
                <span className="v-eyebrow" style={{ color: '#fff' }}>
                  Latest posts
                </span>
                <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
                <Link
                  href={`/account/${id}/posts`}
                  style={{
                    fontFamily: 'var(--v-mono)',
                    fontSize: 11,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--v-mint)',
                  }}
                >
                  View all →
                </Link>
              </div>

              {posts.length === 0 ? (
                <div className="v-tile">
                  <span className="v-kicker">No posts synced yet</span>
                  <p className="v-body" style={{ marginTop: 6, fontSize: 13 }}>
                    The next engagement sync will populate this grid.
                  </p>
                </div>
              ) : (
                <PostStrip posts={posts} id={id} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileHero({
  identity,
  audience,
}: {
  identity: IdentitySnapshot;
  audience: AudienceSnapshot | null;
}) {
  const d = identity.data ?? {};
  // Threads exposes followers via /me/threads_insights, not on the user
  // object — fall back to the audience snapshot when the profile leaves
  // the count null.
  const audienceFollowers =
    audience?.data?.accountInsights?.extra?.followers_count_current;
  const followersCount =
    typeof d.followersCount === 'number'
      ? d.followersCount
      : typeof audienceFollowers === 'number'
        ? audienceFollowers
        : undefined;
  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 40,
        display: 'flex',
        gap: 32,
        alignItems: 'flex-start',
        background: '#131313',
      }}
    >
      <HeroAvatar url={d.avatarUrl} handle={d.username} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span className="v-kicker mint">{identity.platform}</span>
          {d.accountType && (
            <span className="v-tag outline">{d.accountType}</span>
          )}
          {d.verified && (
            <span className="v-tag" style={{ background: '#3cffd0', color: '#000' }}>
              verified
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span className="v-meta">
            Synced {identity.updated_at ? <RelativeTime value={identity.updated_at} /> : 'never'}
          </span>
        </div>

        <h1 className="v-display size-hero" style={{ marginBottom: 10 }}>
          {d.displayName || d.username}
        </h1>
        <div
          style={{
            fontFamily: 'var(--v-mono)',
            fontSize: 16,
            letterSpacing: '0.08em',
            color: 'var(--v-text-muted)',
            marginBottom: 20,
          }}
        >
          @{d.username}
        </div>

        {d.biography && (
          <p
            className="v-body"
            style={{
              maxWidth: 720,
              marginBottom: 24,
              whiteSpace: 'pre-wrap',
            }}
          >
            {d.biography}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: 48,
            paddingTop: 20,
            borderTop: '1px solid #3d00bf',
          }}
        >
          <HeroStat label="Followers" value={fmtNumber(followersCount)} />
          <HeroStat label="Following" value={fmtNumber(d.followingCount)} />
          <HeroStat label="Posts" value={fmtNumber(d.postsCount)} />
        </div>
      </div>
    </div>
  );
}

function HeroAvatar({ url, handle }: { url?: string; handle?: string }) {
  const size = 140;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={handle || 'avatar'}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        style={{
          borderRadius: '50%',
          border: '3px solid #ffffff',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }
  const initial = (handle || '?').replace(/^@/, '').charAt(0).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2d2d2d',
        color: '#3cffd0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--v-display)',
        fontSize: 64,
        border: '3px solid #ffffff',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="v-display"
        style={{ fontSize: 56, lineHeight: 0.95, color: '#fff' }}
      >
        {value}
      </div>
      <div className="v-meta" style={{ marginTop: 8 }}>
        {label}
      </div>
    </div>
  );
}

function PanelAccountInsights({
  insights,
  followersCount,
}: {
  insights: AccountInsights;
  followersCount?: number;
}) {
  const tiles: Array<{ label: string; value: number | undefined }> = [
    { label: 'Reach', value: insights.reach },
    { label: 'Impressions', value: insights.impressions },
    { label: 'Accounts engaged', value: insights.accountsEngaged },
    { label: 'Total interactions', value: insights.totalInteractions },
    { label: 'Profile views', value: insights.profileViews },
    { label: 'Views', value: insights.views },
    { label: 'Likes', value: insights.likes },
    { label: 'Comments', value: insights.comments },
    { label: 'Saves', value: insights.saves },
    { label: 'Shares', value: insights.shares },
    { label: 'Replies', value: insights.replies },
    { label: 'Website clicks', value: insights.websiteClicks },
    { label: 'Email contacts', value: insights.emailContacts },
    { label: 'Call clicks', value: insights.phoneCallClicks },
    { label: 'Text clicks', value: insights.textMessageClicks },
    { label: 'Directions clicks', value: insights.getDirectionsClicks },
  ];
  const visibleTiles = tiles.filter((t) => typeof t.value === 'number');

  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 28,
        marginTop: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <span className="v-kicker mint">Panel /00</span>
        <h2 className="v-display size-tertiary" style={{ fontSize: 40 }}>
          Account insights
        </h2>
        <div style={{ flex: 1 }} />
        <span className="v-meta">
          Last {insights.periodDays ?? 28} days
        </span>
      </div>

      {visibleTiles.length === 0 ? (
        <p className="v-body">
          No daily totals returned yet — run the next audience sync to populate.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 12,
          }}
        >
          {visibleTiles.map((t) => (
            <AccountKpi key={t.label} label={t.label} value={t.value as number} />
          ))}
        </div>
      )}

      {insights.followerCountSeries && insights.followerCountSeries.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="v-kicker" style={{ marginBottom: 8 }}>
            Followers · daily net change
          </div>
          <FollowerSparkline
            series={insights.followerCountSeries}
            currentTotal={followersCount}
          />
        </div>
      )}

      {(insights.audienceActivityWeekly?.length ?? 0) > 0 ||
      (insights.audienceActivity?.length ?? 0) > 0 ? (
        <div style={{ marginTop: 24 }}>
          <div className="v-kicker" style={{ marginBottom: 8 }}>
            Best time to post · audience by weekday × hour (Europe/Madrid)
          </div>
          <BestTimeToPost
            buckets={insights.audienceActivity ?? []}
            weekly={insights.audienceActivityWeekly}
          />
        </div>
      ) : null}

      {insights.extra && Object.keys(insights.extra).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="v-kicker" style={{ marginBottom: 8 }}>
            Additional
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 10,
            }}
          >
            {Object.entries(insights.extra).map(([k, v]) => (
              <AccountKpi key={k} label={prettyLabel(k)} value={v} subtle />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountKpi({
  label,
  value,
  subtle,
}: {
  label: string;
  value: number;
  subtle?: boolean;
}) {
  return (
    <div
      style={{
        background: subtle ? 'transparent' : '#2d2d2d',
        border: subtle ? '1px solid rgba(255,255,255,0.15)' : 'none',
        borderRadius: 20,
        padding: 14,
      }}
    >
      <div className="v-meta" style={{ fontSize: 10, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="v-display"
        style={{
          fontSize: subtle ? 22 : 28,
          lineHeight: 1,
          color: '#fff',
        }}
      >
        {fmtNumber(value)}
      </div>
    </div>
  );
}

function FollowerSparkline({
  series,
  currentTotal,
}: {
  series: Array<{ endTime: string; value: number }>;
  currentTotal?: number;
}) {
  const sorted = useMemo(
    () => [...series].sort((a, b) => a.endTime.localeCompare(b.endTime)),
    [series],
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Cumulative line: derive `total followers at end of each day` by walking
  // back from today's known total minus the trailing daily deltas. Only
  // computed when the parent supplies `currentTotal` (from /me?fields=
  // followers_count or audienceSnapshot.extra.followers_count_current).
  const cumulative = useMemo(() => {
    if (typeof currentTotal !== 'number' || sorted.length === 0) return null;
    const out: number[] = new Array(sorted.length).fill(0);
    out[sorted.length - 1] = currentTotal;
    for (let i = sorted.length - 2; i >= 0; i--) {
      // sorted[i+1].value is the delta GAINED on day i+1, so the count at
      // end of day i is "tomorrow's count minus tomorrow's gain".
      out[i] = out[i + 1] - sorted[i + 1].value;
    }
    return out;
  }, [sorted, currentTotal]);

  if (sorted.length === 0) return null;

  const values = sorted.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const width = 600;
  const height = 120;
  const padX = 16;
  const padTop = 14;
  const padBottom = 22;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const stepX = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW;
  const pointX = (i: number) => padX + i * stepX;
  const pointY = (v: number) => padTop + plotH - ((v - min) / range) * plotH;

  // Cumulative line uses its own Y-axis (different scale: total followers)
  const cumMin = cumulative ? Math.min(...cumulative) : 0;
  const cumMax = cumulative ? Math.max(...cumulative) : 1;
  const cumRange = Math.max(cumMax - cumMin, 1);
  const cumPointY = (v: number) =>
    padTop + plotH - ((v - cumMin) / cumRange) * plotH;

  const pts = sorted.map((s, i) => `${pointX(i).toFixed(1)},${pointY(s.value).toFixed(1)}`);
  // Solid path through every point except the last segment, which is
  // rendered separately as dashed to signal the "today" partial-day value
  // (Meta closes the day at 07:00 UTC the next morning, so today is
  // always preliminary until tomorrow morning).
  const pathSolid =
    pts.length >= 2 ? `M${pts.slice(0, -1).join(' L')}` : `M${pts.join(' L')}`;
  const pathDashedTail =
    pts.length >= 2 ? `M${pts[pts.length - 2]} L${pts[pts.length - 1]}` : '';
  const path = `M${pts.join(' L')}`;
  const area = `${path} L${pointX(sorted.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${padX.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;
  const cumPath = cumulative
    ? `M${cumulative.map((v, i) => `${pointX(i).toFixed(1)},${cumPointY(v).toFixed(1)}`).join(' L')}`
    : '';

  // The series values are daily deltas (followers gained or lost on each
  // day) returned by Meta's `follower_count` insight with `period=day` —
  // NOT cumulative snapshots. Net change in the window is the sum of all
  // values; doing `last - first` would be nonsense (it produced a bogus
  // negative number even when the account grew net-positive in the window).
  const netDelta = sorted.reduce((acc, p) => acc + p.value, 0);
  const toneClass = netDelta >= 0 ? '#3cffd0' : '#ef4444';

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const xInView = ratio * width;
    const i = Math.max(
      0,
      Math.min(sorted.length - 1, Math.round((xInView - padX) / stepX)),
    );
    setHoverIdx(i);
  };

  const hovered = hoverIdx !== null ? sorted[hoverIdx] : null;
  const hoverX = hoverIdx !== null ? pointX(hoverIdx) : 0;
  const hoverY = hovered ? pointY(hovered.value) : 0;
  const tooltipLeftPct = hoverIdx !== null ? (hoverX / width) * 100 : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily follower count snapshot"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ display: 'block', cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={toneClass} stopOpacity="0.35" />
            <stop offset="100%" stopColor={toneClass} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          y1={padTop + plotH}
          x2={width - padX}
          y2={padTop + plotH}
          stroke="#3d00bf"
          strokeWidth={1}
        />
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padX}
            y1={padTop + plotH * f}
            x2={width - padX}
            y2={padTop + plotH * f}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}
        <path d={area} fill="url(#sparkFill)" />
        <path d={pathSolid} fill="none" stroke={toneClass} strokeWidth={1.5} />
        {pathDashedTail && (
          <path
            d={pathDashedTail}
            fill="none"
            stroke={toneClass}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.6}
          />
        )}
        {cumPath && (
          <path
            d={cumPath}
            fill="none"
            stroke="#7d6cff"
            strokeWidth={1.2}
            opacity={0.55}
          />
        )}

        {hoverIdx !== null && hovered && (
          <>
            <line
              x1={hoverX}
              y1={padTop}
              x2={hoverX}
              y2={padTop + plotH}
              stroke="rgba(60,255,208,0.4)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={hoverX} cy={hoverY} r={5} fill={toneClass} opacity={0.25} />
            <circle cx={hoverX} cy={hoverY} r={3} fill={toneClass} />
          </>
        )}

        {sorted.map((s, i) => (
          <circle
            key={i}
            cx={pointX(i)}
            cy={pointY(s.value)}
            r={hoverIdx === i ? 3 : 1.8}
            fill={toneClass}
            opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.5}
          />
        ))}
      </svg>

      {hoverIdx !== null && hovered && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${tooltipLeftPct}%`,
            transform: 'translate(-50%, -110%)',
            background: '#0b0b0b',
            border: `1px solid ${toneClass}`,
            borderRadius: 10,
            padding: '8px 12px',
            fontFamily: 'var(--v-mono)',
            fontSize: 11,
            color: '#fff',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            letterSpacing: '0.06em',
            zIndex: 30,
          }}
        >
          <div
            style={{
              color: toneClass,
              fontSize: 9,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            {hovered.endTime.slice(0, 10)}
          </div>
          <div style={{ fontSize: 14, fontFamily: 'var(--v-display)' }}>
            {hovered.value >= 0 ? '+' : ''}
            {fmtNumber(hovered.value)} that day
          </div>
          {cumulative && (
            <div
              style={{
                fontSize: 11,
                fontFamily: 'var(--v-mono)',
                color: '#a89aff',
                marginTop: 2,
              }}
            >
              total {fmtNumber(cumulative[hoverIdx!])}
            </div>
          )}
          {hoverIdx === sorted.length - 1 && (
            <div
              style={{
                fontSize: 9,
                fontFamily: 'var(--v-mono)',
                color: 'var(--v-text-muted)',
                marginTop: 2,
                letterSpacing: '0.08em',
              }}
            >
              partial — final value tomorrow
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--v-text-muted)',
          marginTop: 4,
        }}
      >
        <span>{sorted[0]?.endTime.slice(0, 10)}</span>
        <span style={{ color: toneClass }}>
          {netDelta >= 0 ? '+' : ''}
          {fmtNumber(netDelta)} new in 28d
        </span>
        <span>{sorted[sorted.length - 1]?.endTime.slice(0, 10)}</span>
      </div>

      <div
        style={{
          fontFamily: 'var(--v-mono)',
          fontSize: 9,
          letterSpacing: '0.10em',
          color: 'var(--v-text-muted)',
          marginTop: 6,
          opacity: 0.7,
        }}
      >
        today's value lands tomorrow — Meta closes daily insights at end of
        day UTC (09:00 Madrid){cumulative && ' · purple line: cumulative total followers'}
      </div>
    </div>
  );
}

function prettyLabel(key: string): string {
  let label = key.replace(/^ig_/, '').replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function DemographicsUnavailableNote({
  scope,
  errors,
}: {
  scope: 'reached' | 'engaged' | 'followers';
  errors: DemographicBreakdownError[] | undefined;
}) {
  if (!errors || errors.length === 0) return null;
  const scopeLabel =
    scope === 'reached'
      ? 'Reached-audience'
      : scope === 'engaged'
        ? 'Engaged-audience'
        : 'Followers';
  const grouped = new Map<string, DemographicBreakdownError[]>();
  for (const e of errors) {
    const key = e.message || 'Unknown error';
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }
  return (
    <div
      style={{
        marginTop: 18,
        border: '1px solid #5200ff',
        borderRadius: 16,
        padding: '14px 16px',
        background: 'rgba(82, 0, 255, 0.08)',
      }}
    >
      <div
        className="v-kicker"
        style={{ color: '#c9b8ff', marginBottom: 6 }}
      >
        {scopeLabel} demographics unavailable
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Array.from(grouped.entries()).map(([msg, es]) => (
          <div
            key={msg}
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              color: '#fff',
            }}
          >
            <span style={{ color: '#c9b8ff' }}>
              {es.map((e) => e.breakdown).join(' · ')}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}> — {msg}</span>
            {es[0].code !== undefined && (
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                {' '}
                (code {es[0].code}
                {es[0].subcode !== undefined ? `/${es[0].subcode}` : ''})
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelDemographics({
  aud,
  platform,
}: {
  aud: AudienceData | null;
  platform?: string;
}) {
  const [scope, setScope] = useState<'followers' | 'reached' | 'engaged'>('followers');
  const [timeframe, setTimeframe] = useState<DemographicTimeframe>('prev_month');
  const isFacebook = platform === 'facebook';
  if (!aud) {
    return (
      <div
        style={{
          border: '1px solid #ffffff',
          borderRadius: 24,
          padding: 28,
          marginTop: 24,
        }}
      >
        <span className="v-kicker mint">Panel /01</span>
        <h2 className="v-display size-tertiary" style={{ fontSize: 40, marginTop: 6 }}>
          Demographics
        </h2>
        <p className="v-body">No audience snapshot yet.</p>
      </div>
    );
  }

  const anyDistribution =
    (aud.genderDistribution?.length ?? 0) > 0 ||
    (aud.ageDistribution?.length ?? 0) > 0 ||
    (aud.countryDistribution?.length ?? 0) > 0 ||
    (aud.cityDistribution?.length ?? 0) > 0 ||
    !!aud.reachedDemographics ||
    !!aud.engagedDemographics;

  if (isFacebook && !anyDistribution) {
    return (
      <div
        style={{
          border: '1px solid #ffffff',
          borderRadius: 24,
          padding: 28,
          marginTop: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="v-kicker mint">Panel /01</span>
          <h2 className="v-display size-tertiary" style={{ fontSize: 40 }}>
            Demographics
          </h2>
        </div>
        <div
          style={{
            marginTop: 18,
            border: '1px solid #5200ff',
            borderRadius: 16,
            padding: '14px 16px',
            background: 'rgba(82, 0, 255, 0.08)',
          }}
        >
          <div className="v-kicker" style={{ color: '#c9b8ff', marginBottom: 6 }}>
            Not exposed by Meta
          </div>
          <p
            className="v-body"
            style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}
          >
            Facebook Pages do not expose audience demographics (country, age,
            gender, city) in Graph API v22+. Meta deprecated{' '}
            <code>page_fans_country</code> /{' '}
            <code>page_fans_gender_age</code> and hasn't shipped a replacement
            for Pages. Activity metrics (reach, impressions, profile views)
            are in the Account insights panel above. Instagram accounts still
            return demographic breakdowns via{' '}
            <code>follower_demographics</code>.
          </p>
        </div>
        {aud.fetchedAt && (
          <div className="v-meta" style={{ marginTop: 20 }}>
            Captured <RelativeTime value={aud.fetchedAt} />
          </div>
        )}
      </div>
    );
  }

  // Pick the active scope's group and, when the adapter populated
  // `byTimeframe`, drill into the selected window. Falls back to the
  // top-level fields for legacy snapshots without `byTimeframe`.
  const pickWindow = (g?: DemographicGroup): DemographicGroup =>
    g?.byTimeframe ? g.byTimeframe[timeframe] ?? {} : g ?? {};

  const source: DemographicGroup =
    scope === 'reached'
      ? pickWindow(aud.reachedDemographics)
      : scope === 'engaged'
      ? pickWindow(aud.engagedDemographics)
      : {
          genderDistribution: aud.genderDistribution,
          ageDistribution: aud.ageDistribution,
          countryDistribution: aud.countryDistribution,
          cityDistribution: aud.cityDistribution,
        };

  const hasDistribution = (g?: DemographicGroup) =>
    !!g &&
    ((g.genderDistribution?.length ?? 0) > 0 ||
      (g.ageDistribution?.length ?? 0) > 0 ||
      (g.countryDistribution?.length ?? 0) > 0 ||
      (g.cityDistribution?.length ?? 0) > 0);

  const reachedErrors =
    aud.reachedDemographics?.byTimeframe?.[timeframe]?.errors ??
    aud.reachedDemographics?.errors;
  const engagedErrors =
    aud.engagedDemographics?.byTimeframe?.[timeframe]?.errors ??
    aud.engagedDemographics?.errors;
  // For tab availability, treat ANY timeframe (or legacy single-shape) as
  // a signal that the scope is meaningful — otherwise switching tabs to
  // just see "Not enough users" is annoying.
  const reachedHasAnyData = (() => {
    const tf = aud.reachedDemographics?.byTimeframe;
    if (tf) return Object.values(tf).some((g) => hasDistribution(g) || !!g?.errors?.length);
    return hasDistribution(aud.reachedDemographics) || !!aud.reachedDemographics?.errors?.length;
  })();
  const engagedHasAnyData = (() => {
    const tf = aud.engagedDemographics?.byTimeframe;
    if (tf) return Object.values(tf).some((g) => hasDistribution(g) || !!g?.errors?.length);
    return hasDistribution(aud.engagedDemographics) || !!aud.engagedDemographics?.errors?.length;
  })();
  const hasReached = reachedHasAnyData;
  const hasEngaged = engagedHasAnyData;
  const showReachedError =
    scope === 'reached' && !hasDistribution(source) && !!reachedErrors?.length;
  const showEngagedError =
    scope === 'engaged' && !hasDistribution(source) && !!engagedErrors?.length;
  const activeScopeHasTimeframes =
    (scope === 'reached' && !!aud.reachedDemographics?.byTimeframe) ||
    (scope === 'engaged' && !!aud.engagedDemographics?.byTimeframe);
  // Threads packs the per-breakdown errors (e.g. "needs 100 followers") into
  // `reachedDemographics.errors` because there's no native "followers errors"
  // slot on AudienceData. Surface them under the Followers scope when no
  // distribution arrived.
  const followersOwn: DemographicGroup = {
    genderDistribution: aud.genderDistribution,
    ageDistribution: aud.ageDistribution,
    countryDistribution: aud.countryDistribution,
    cityDistribution: aud.cityDistribution,
  };
  const showFollowersError =
    scope === 'followers' && !hasDistribution(followersOwn) && !!reachedErrors?.length;

  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 28,
        marginTop: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <span className="v-kicker mint">Panel /01</span>
        <h2 className="v-display size-tertiary" style={{ fontSize: 40 }}>
          Demographics
        </h2>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <ScopeTab
            label="Followers"
            active={scope === 'followers'}
            onClick={() => setScope('followers')}
          />
          <ScopeTab
            label="Reached"
            active={scope === 'reached'}
            disabled={!hasReached}
            onClick={() => setScope('reached')}
          />
          <ScopeTab
            label="Engaged"
            active={scope === 'engaged'}
            disabled={!hasEngaged}
            onClick={() => setScope('engaged')}
          />
        </div>
      </div>

      {activeScopeHasTimeframes && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            marginTop: -8,
            flexWrap: 'wrap',
          }}
        >
          <span
            className="v-meta"
            title="Meta IG Graph treats these as rolling windows, not calendar week/month."
            style={{ cursor: 'help' }}
          >
            Window ⓘ
          </span>
          {(['this_week', 'this_month', 'prev_month'] as DemographicTimeframe[]).map((tf) => (
            <ScopeTab
              key={tf}
              label={TIMEFRAME_LABELS[tf]}
              active={timeframe === tf}
              onClick={() => setTimeframe(tf)}
              title={TIMEFRAME_TOOLTIPS[tf]}
            />
          ))}
          <span
            className="v-meta"
            style={{ marginLeft: 4, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}
          >
            {TIMEFRAME_TOOLTIPS[timeframe]}
          </span>
        </div>
      )}

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 1fr',
          alignItems: 'start',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <GenderDonut entries={source.genderDistribution ?? []} />
          <VBars
            title="Top age groups"
            entries={(source.ageDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 6)}
            total={sum(source.ageDistribution)}
            color="#3cffd0"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <VBars
            title="Top countries"
            entries={(source.countryDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
            total={sum(source.countryDistribution)}
            color="#ffffff"
          />
          <VBars
            title="Top cities"
            entries={(source.cityDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
            total={sum(source.cityDistribution)}
            color="#5200ff"
          />
        </div>
      </div>

      {showFollowersError && (
        <DemographicsUnavailableNote scope="followers" errors={reachedErrors} />
      )}
      {showReachedError && (
        <DemographicsUnavailableNote scope="reached" errors={reachedErrors} />
      )}
      {showEngagedError && (
        <DemographicsUnavailableNote scope="engaged" errors={engagedErrors} />
      )}

      {aud.fetchedAt && (
        <div className="v-meta" style={{ marginTop: 20 }}>
          Captured <RelativeTime value={aud.fetchedAt} />
        </div>
      )}
    </div>
  );
}

function ScopeTab({
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        all: 'unset',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '6px 12px',
        borderRadius: 20,
        background: active ? '#3cffd0' : 'transparent',
        color: active ? '#000' : disabled ? 'rgba(255,255,255,0.25)' : '#fff',
        border: `1px solid ${active ? '#3cffd0' : disabled ? 'rgba(255,255,255,0.15)' : '#ffffff'}`,
        fontFamily: 'var(--v-mono)',
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function PanelAudience({ aud }: { aud: AudienceData | null }) {
  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 28,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <span className="v-kicker mint">Panel /01</span>
        <h2 className="v-display size-tertiary" style={{ fontSize: 40, marginTop: 6 }}>
          Audience
        </h2>
      </div>

      {!aud ? (
        <p className="v-body">No audience snapshot yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <GenderDonut entries={aud.genderDistribution ?? []} />
          <VBars
            title="Top age groups"
            entries={(aud.ageDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 6)}
            total={sum(aud.ageDistribution)}
            color="#3cffd0"
          />
        </div>
      )}
    </div>
  );
}

function PanelGeo({ aud }: { aud: AudienceData | null }) {
  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 28,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <span className="v-kicker mint">Panel /02</span>
        <h2 className="v-display size-tertiary" style={{ fontSize: 40, marginTop: 6 }}>
          Geography
        </h2>
      </div>

      {!aud ? (
        <p className="v-body">No audience snapshot yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <VBars
            title="Top countries"
            entries={(aud.countryDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
            total={sum(aud.countryDistribution)}
            color="#ffffff"
          />
          <VBars
            title="Top cities"
            entries={(aud.cityDistribution ?? [])
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)}
            total={sum(aud.cityDistribution)}
            color="#5200ff"
          />
          {aud.fetchedAt && (
            <div className="v-meta">Captured <RelativeTime value={aud.fetchedAt} /></div>
          )}
        </div>
      )}
    </div>
  );
}

const GENDER_PALETTE: Record<string, { color: string; display: string }> = {
  female: { color: '#ff6bcb', display: 'Female' },
  f: { color: '#ff6bcb', display: 'Female' },
  male: { color: '#3cffd0', display: 'Male' },
  m: { color: '#3cffd0', display: 'Male' },
  unknown: { color: '#5200ff', display: 'Unknown' },
  u: { color: '#5200ff', display: 'Unknown' },
  other: { color: '#ffd166', display: 'Other' },
  o: { color: '#ffd166', display: 'Other' },
};

function genderMeta(label: string): { color: string; display: string } {
  const key = label.trim().toLowerCase();
  return GENDER_PALETTE[key] ?? { color: '#ffffff', display: label };
}

function abbreviateInt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function GenderDonut({ entries }: { entries: Distribution }) {
  const [hover, setHover] = useState<string | null>(null);
  const radius = 60;
  const stroke = 18;
  const size = 180;
  const center = size / 2;
  const c = 2 * Math.PI * radius;
  const total = sum(entries);

  // Hooks must run unconditionally on every render — switching tabs
  // (Followers ↔ Engaged) flips entries between populated and empty
  // depending on whether Meta returned breakdowns or only errors.
  // Computing slices unconditionally and short-circuiting later keeps
  // the hook count stable.
  const slices = useMemo(() => {
    if (!total) return [];
    let offset = 0;
    return entries.map((e) => {
      const frac = e.value / total;
      const dash = frac * c;
      const gap = c - dash;
      const meta = genderMeta(e.label);
      const slice = {
        rawLabel: e.label,
        label: meta.display,
        value: e.value,
        frac,
        dash,
        gap,
        offset,
        color: meta.color,
      };
      offset += dash;
      return slice;
    });
  }, [entries, total, c]);

  if (!entries.length || !total) return null;

  const hoveredSlice = hover ? slices.find((s) => s.rawLabel === hover) : null;
  const centerValue = hoveredSlice ? hoveredSlice.value : total;
  const centerLabel = hoveredSlice
    ? `${hoveredSlice.label} · ${(hoveredSlice.frac * 100).toFixed(1)}%`
    : 'Total';
  const centerColor = hoveredSlice ? hoveredSlice.color : '#ffffff';

  // Auto-scale center font so the number fits inside the inner circle.
  const centerText = abbreviateInt(centerValue);
  const centerFullText = fmtNumber(centerValue);
  const centerFontSize =
    centerText.length <= 3 ? 34 : centerText.length <= 4 ? 30 : 26;

  return (
    <div>
      <div className="v-kicker" style={{ marginBottom: 12 }}>
        Gender split
      </div>
      <div
        style={{
          display: 'flex',
          gap: 28,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          onMouseLeave={() => setHover(null)}
          style={{ overflow: 'visible', flexShrink: 0 }}
          role="img"
          aria-label={`Gender split. Total ${centerFullText}.`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={stroke}
          />
          {slices.map((s) => {
            const isHover = hover === s.rawLabel;
            const isFaded = hover !== null && !isHover;
            return (
              <circle
                key={s.rawLabel}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={isHover ? stroke + 5 : stroke}
                strokeDasharray={`${s.dash} ${s.gap}`}
                strokeDashoffset={-s.offset}
                transform={`rotate(-90 ${center} ${center})`}
                onMouseEnter={() => setHover(s.rawLabel)}
                opacity={isFaded ? 0.25 : 1}
                style={{
                  cursor: 'pointer',
                  transition:
                    'opacity 150ms ease, stroke-width 150ms ease',
                  filter: isHover ? `drop-shadow(0 0 6px ${s.color})` : 'none',
                }}
              >
                <title>{`${s.label}: ${fmtNumber(s.value)} (${(s.frac * 100).toFixed(1)}%)`}</title>
              </circle>
            );
          })}
          <text
            x={center}
            y={center - 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={centerColor}
            fontFamily="var(--v-display)"
            fontSize={centerFontSize}
            letterSpacing="0.02em"
            style={{
              pointerEvents: 'none',
              transition: 'fill 150ms ease',
            }}
          >
            {centerText}
          </text>
          <text
            x={center}
            y={center + centerFontSize * 0.7}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)"
            fontFamily="var(--v-mono)"
            fontSize="9"
            letterSpacing="0.18em"
            style={{ pointerEvents: 'none', textTransform: 'uppercase' }}
          >
            {centerLabel}
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
          {slices.map((s) => {
            const pct = (s.frac * 100).toFixed(1);
            const isHover = hover === s.rawLabel;
            const isFaded = hover !== null && !isHover;
            return (
              <button
                key={s.rawLabel}
                onMouseEnter={() => setHover(s.rawLabel)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(s.rawLabel)}
                onBlur={() => setHover(null)}
                style={{
                  all: 'unset',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontFamily: 'var(--v-mono)',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  padding: '6px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: isHover
                    ? `${s.color}14`
                    : 'rgba(255,255,255,0.02)',
                  borderLeft: `3px solid ${isHover ? s.color : 'transparent'}`,
                  opacity: isFaded ? 0.45 : 1,
                  transition:
                    'opacity 150ms ease, background 150ms ease, border-color 150ms ease',
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: s.color,
                    display: 'inline-block',
                    flexShrink: 0,
                    boxShadow: isHover ? `0 0 8px ${s.color}` : 'none',
                  }}
                />
                <span
                  style={{
                    minWidth: 80,
                    color: '#ffffff',
                    textTransform: 'uppercase',
                  }}
                >
                  {s.label}
                </span>
                <span style={{ color: '#fff', minWidth: 64, textAlign: 'right' }}>
                  {fmtNumber(s.value)}
                </span>
                <span
                  style={{
                    color: isHover ? s.color : 'var(--v-text-muted)',
                    minWidth: 48,
                    textAlign: 'right',
                  }}
                >
                  {pct}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VBars({
  title,
  entries,
  total,
  color,
}: {
  title: string;
  entries: Distribution;
  total: number;
  color: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!entries.length) return null;
  const max = Math.max(...entries.map((e) => e.value), 1);
  const grandTotal = total > 0 ? total : entries.reduce((a, b) => a + b.value, 0);
  return (
    <div>
      <div className="v-kicker" style={{ marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((e, i) => {
          const pct = grandTotal > 0 ? (e.value / grandTotal) * 100 : 0;
          const isHover = hover === e.label;
          const isFaded = hover !== null && !isHover;
          return (
            <div
              key={e.label}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHover(e.label)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(e.label)}
              onBlur={() => setHover(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '4px 6px',
                borderRadius: 8,
                background: isHover ? 'rgba(60, 255, 208, 0.08)' : 'transparent',
                opacity: isFaded ? 0.45 : 1,
                transition: 'opacity 150ms ease, background 150ms ease',
                cursor: 'default',
                outline: 'none',
              }}
              aria-label={`${e.label}: ${fmtNumber(e.value)}${
                grandTotal > 0 ? `, ${pct.toFixed(1)}%` : ''
              } (rank ${i + 1} of ${entries.length})`}
            >
              <div
                style={{
                  width: 140,
                  fontFamily: 'var(--v-mono)',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: isHover ? '#3cffd0' : '#ffffff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'color 150ms ease',
                }}
                title={e.label}
              >
                {e.label}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: '#2d2d2d',
                  borderRadius: 3,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${(e.value / max) * 100}%`,
                    height: '100%',
                    background: color,
                    filter: isHover ? 'brightness(1.25)' : 'none',
                    boxShadow: isHover ? `0 0 8px ${color}` : 'none',
                    transition:
                      'width 320ms ease, filter 150ms ease, box-shadow 150ms ease',
                  }}
                />
                {isHover && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -28,
                      left: `calc(${(e.value / max) * 100}% - 4px)`,
                      transform: 'translateX(-50%)',
                      background: '#0b0b0b',
                      border: '1px solid #3cffd0',
                      borderRadius: 8,
                      padding: '4px 8px',
                      fontFamily: 'var(--v-mono)',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  >
                    {fmtNumber(e.value)}
                    {grandTotal > 0 && (
                      <span style={{ color: '#3cffd0' }}>
                        {' · '}
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div
                style={{
                  width: 110,
                  fontFamily: 'var(--v-mono)',
                  fontSize: 11,
                  textAlign: 'right',
                  color: isHover ? '#3cffd0' : '#ffffff',
                  transition: 'color 150ms ease',
                }}
              >
                {fmtNumber(e.value)}
                {grandTotal > 0 && (
                  <span style={{ color: 'var(--v-text-muted)' }}>
                    {' · '}
                    {pct.toFixed(pct >= 10 ? 0 : 1)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PostStrip({ posts, id }: { posts: Post[]; id: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
      }}
    >
      {posts.map((p) => {
        const d = p.data;
        const thumb = d?.thumbnailUrl || d?.mediaUrls?.[0];
        const likes = d?.metrics?.likes ?? 0;
        const comments = d?.metrics?.comments ?? 0;
        const type = d?.contentType || 'post';
        const isTextOnly = !thumb && !!d?.caption;
        return (
          <Link
            key={p.platform_content_id}
            href={`/account/${id}/posts`}
            style={{
              position: 'relative',
              aspectRatio: '1 / 1',
              borderRadius: 20,
              overflow: 'hidden',
              background: '#2d2d2d',
              border: '1px solid #ffffff',
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'border-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3cffd0';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#ffffff';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt={`${p.platform} ${type}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : isTextOnly ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: 16,
                  paddingBottom: 48,
                  background:
                    'radial-gradient(120% 80% at 0% 0%, rgba(60,255,208,0.10) 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
                  display: 'flex',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--v-sans)',
                    fontWeight: 600,
                    fontSize: 13,
                    lineHeight: 1.34,
                    color: '#ffffff',
                    whiteSpace: 'pre-wrap',
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {d?.caption}
                </div>
              </div>
            ) : null}
            <span
              className="v-tag mint"
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
              }}
            >
              {type}
            </span>
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '20px 12px 10px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                display: 'flex',
                gap: 12,
                fontFamily: 'var(--v-mono)',
                fontSize: 12,
                color: '#fff',
                letterSpacing: '0.06em',
              }}
            >
              <span>♥ {fmtNumber(likes)}</span>
              <span>✎ {fmtNumber(comments)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function sum(d?: Distribution): number {
  if (!d) return 0;
  return d.reduce((a, b) => a + b.value, 0);
}

/**
 * Hour offset to add to a Pacific-Time wall clock to get the same wall
 * clock in Europe/Madrid. DST-aware: usually +9 (PDT/CEST or PST/CET) but
 * +8 during the two short transition windows where the two zones aren't
 * aligned (8-Mar→last-Sun-Mar and last-Sun-Oct→1-Nov each year).
 */
function ptToMadridOffsetHours(now: Date = new Date()): number {
  const pt = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  );
  const md = new Date(
    now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }),
  );
  return Math.round((md.getTime() - pt.getTime()) / 3_600_000);
}

/**
 * Shift a (dayOfWeek, hour) bucket by `offset` hours, wrapping the day of
 * week as the hour overflows past 23 or below 0.
 */
function shiftBucket(
  b: { dayOfWeek: number; hour: number; count: number },
  offset: number,
): { dayOfWeek: number; hour: number; count: number } {
  const total = b.hour + offset;
  const newHour = ((total % 24) + 24) % 24;
  const dayShift = Math.floor(total / 24);
  const newDow = (((b.dayOfWeek + dayShift) % 7) + 7) % 7;
  return { dayOfWeek: newDow, hour: newHour, count: b.count };
}

/**
 * "Best time to post" panel. Renders:
 *   - a 7×24 weekday × hour heatmap when weekly buckets are present
 *     (mint intensity scaled to the period max, top peaks marked).
 *   - a flat 24-bar sparkline as fallback (legacy adapters).
 */
function BestTimeToPost({
  buckets,
  weekly,
}: {
  buckets: Array<{ hour: number; count: number }>;
  weekly?: Array<{ dayOfWeek: number; hour: number; count: number }>;
}) {
  if (weekly && weekly.length > 0) {
    return <WeeklyHeatmap buckets={weekly} />;
  }
  return <HourlyBars buckets={buckets} />;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeeklyHeatmap({
  buckets,
}: {
  buckets: Array<{ dayOfWeek: number; hour: number; count: number }>;
}) {
  // Meta returns the online_followers buckets in Pacific Time (the API's
  // "day" runs 00:00 PT → 24:00 PT). We reproject to Europe/Madrid so the
  // user reads peaks in their own clock. Offset is DST-aware: typically +9h
  // in summer (PDT/CEST), +8h in the two short transition windows where
  // Europe and US DST aren't aligned.
  const offset = ptToMadridOffsetHours();
  const shifted = buckets.map((b) => shiftBucket(b, offset));

  const grid: number[][] = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0),
  );
  let maxVal = 0;
  let total = 0;
  for (const b of shifted) {
    if (b.dayOfWeek < 0 || b.dayOfWeek > 6) continue;
    if (b.hour < 0 || b.hour > 23) continue;
    grid[b.dayOfWeek][b.hour] += b.count;
    if (grid[b.dayOfWeek][b.hour] > maxVal) maxVal = grid[b.dayOfWeek][b.hour];
    total += b.count;
  }
  // Top 3 (dow, hour) pairs
  const flat: Array<{ dow: number; hour: number; count: number }> = [];
  for (let dow = 0; dow < 7; dow++)
    for (let hour = 0; hour < 24; hour++)
      flat.push({ dow, hour, count: grid[dow][hour] });
  const peaks = flat
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const peakSet = new Set(peaks.map((p) => `${p.dow}-${p.hour}`));

  return (
    <div>
      {/* Hour scale on top */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '52px repeat(24, 1fr)',
          gap: 2,
          marginBottom: 4,
          fontFamily: 'var(--v-mono)',
          fontSize: 9,
          letterSpacing: '0.04em',
          color: 'var(--v-text-muted)',
        }}
      >
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ textAlign: 'center' }}>
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      {/* Mon..Sun rows. We iterate Monday→Sunday (1..6, then 0) so the grid
           reads left-to-right, top-to-bottom in calendar order. */}
      {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
        <div
          key={dow}
          style={{
            display: 'grid',
            gridTemplateColumns: '52px repeat(24, 1fr)',
            gap: 2,
            marginBottom: 2,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              color: 'var(--v-text-muted)',
              textAlign: 'right',
              paddingRight: 4,
            }}
          >
            {DAY_LABELS[dow]}
          </span>
          {Array.from({ length: 24 }, (_, hour) => {
            const count = grid[dow][hour];
            const intensity = maxVal > 0 ? count / maxVal : 0;
            const isPeak = peakSet.has(`${dow}-${hour}`);
            const bg = isPeak
              ? '#3cffd0'
              : intensity > 0
                ? `rgba(60,255,208,${(0.12 + intensity * 0.6).toFixed(2)})`
                : 'rgba(255,255,255,0.05)';
            return (
              <div
                key={hour}
                title={`${DAY_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 — ${count.toLocaleString()}`}
                style={{
                  height: 18,
                  background: bg,
                  borderRadius: 3,
                  transition: 'background 200ms ease',
                }}
              />
            );
          })}
        </div>
      ))}
      {peaks.length > 0 && (
        <div
          className="v-meta"
          style={{ marginTop: 12, color: 'var(--v-text-muted)' }}
        >
          Peak slots:{' '}
          <span style={{ color: '#3cffd0' }}>
            {peaks
              .map(
                (p) =>
                  `${DAY_LABELS[p.dow]} ${String(p.hour).padStart(2, '0')}:00`,
              )
              .join(' · ')}
          </span>
          {' — '}
          {fmtNumber(total)} interactions across the period
        </div>
      )}
    </div>
  );
}

function HourlyBars({
  buckets,
}: {
  buckets: Array<{ hour: number; count: number }>;
}) {
  const padded: number[] = new Array<number>(24).fill(0);
  for (const b of buckets) {
    if (b.hour >= 0 && b.hour <= 23) padded[b.hour] = b.count;
  }
  const maxVal = Math.max(...padded, 1);
  const total = padded.reduce((a, b) => a + b, 0);
  // Pick the top 3 distinct hours by count for the highlight band.
  const ranked = padded
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count);
  const topSet = new Set(
    ranked
      .filter((r) => r.count > 0)
      .slice(0, 3)
      .map((r) => r.hour),
  );

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(24, 1fr)',
          gap: 4,
          alignItems: 'end',
          height: 96,
          padding: '0 2px',
        }}
      >
        {padded.map((count, hour) => {
          const pct = (count / maxVal) * 100;
          const isPeak = topSet.has(hour);
          return (
            <div
              key={hour}
              title={`${String(hour).padStart(2, '0')}:00 — ${count.toLocaleString()}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                height: '100%',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(pct, count > 0 ? 4 : 0)}%`,
                  background: isPeak ? '#3cffd0' : 'rgba(255,255,255,0.18)',
                  borderRadius: 3,
                  transition: 'background 200ms ease',
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(24, 1fr)',
          gap: 4,
          marginTop: 6,
          fontFamily: 'var(--v-mono)',
          fontSize: 9,
          letterSpacing: '0.05em',
          color: 'var(--v-text-muted)',
          textAlign: 'center',
        }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      {topSet.size > 0 && (
        <div
          className="v-meta"
          style={{ marginTop: 10, color: 'var(--v-text-muted)' }}
        >
          Peak hours:{' '}
          <span style={{ color: '#3cffd0' }}>
            {Array.from(topSet)
              .sort((a, b) => a - b)
              .map((h) => `${String(h).padStart(2, '0')}:00`)
              .join(' · ')}
          </span>
          {' — '}
          {fmtNumber(total)} interactions across the period
        </div>
      )}
    </div>
  );
}
