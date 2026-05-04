import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtRelative, fmtNumber, fmtDateTime, truncate } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';

type PostMetrics = {
  likes?: number;
  comments?: number;
  reach?: number;
  impressions?: number;
  saves?: number;
  shares?: number;
  views?: number;
  /**
   * Platform-specific metrics that don't fit the canonical slots —
   * total_interactions, navigation, replies, profile_visits, follows,
   * ig_reels_avg_watch_time, etc. Rendered as extra tiles in the dialog.
   */
  extra?: Record<string, number>;
};

type PostChild = {
  id: string;
  mediaType?: string;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  permalink?: string | null;
};

type DistributionBucket = {
  label: string;
  value: number;     // fraction 0..1 when unit='percent', absolute count otherwise
  unit?: 'percent' | 'count';
};

type SecondPercentage = {
  second: number;
  percentage: number;  // fraction 0..1
};

type PostInsights = {
  trafficSources?: DistributionBucket[];
  retentionCurve?: SecondPercentage[];
  likesTimeline?: SecondPercentage[];
  audienceCountries?: DistributionBucket[];
  audienceCities?: DistributionBucket[];
  audienceGenders?: DistributionBucket[];
  audienceTypes?: DistributionBucket[];
};

type PostData = {
  platformContentId?: string;
  contentType?: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrls?: string[];
  thumbnailUrl?: string | null;
  /** Platform-provided embeddable player URL (TikTok). */
  embedUrl?: string | null;
  metrics?: PostMetrics;
  /** Per-post breakdowns (TikTok). Optional. */
  insights?: PostInsights;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  rawResponse?: { collection?: string; contentHash?: string };
  children?: PostChild[];
  mediaProductType?: string | null;
  shortcode?: string | null;
  isSharedToFeed?: boolean | null;
  ownerHandle?: string | null;
};

type Post = {
  account_id: string;
  platform: string;
  platform_content_id: string;
  data?: PostData;
  updated_at?: string;
  created_at?: string;
};

type DateFilter = {
  /** ISO YYYY-MM-DD or null. */
  from: string | null;
  /** ISO YYYY-MM-DD or null. */
  to: string | null;
};

type PageProps = {
  id: string;
  platform: string | null;
  posts: Post[];
  totalAll: number;
  totalMatching: number;
  page: number;
  pageSize: number;
  filter: DateFilter;
};

const PAGE_SIZE = 60;

// Platforms whose adapters implement `fetchMentions`. Mirrors the support
// matrix at /admin/support-matrix.
const PLATFORMS_WITH_MENTIONS = new Set<string>(['tiktok', 'threads']);

function parseQueryString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // YYYY-MM-DD (10 chars). Defensive — anything else is rejected.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  const from = parseQueryString(ctx.query.from);
  const to = parseQueryString(ctx.query.to);
  const page = parsePage(ctx.query.page);
  const filter: DateFilter = { from, to };

  try {
    const db = await getDb();
    const accountFilter = { $or: [{ account_id: id }, { account_id: Number(id) || id }] };

    // Resolve the connected account's own handle so we can keep mentions
    // (posts authored by other users that @-tag us) out of this archive.
    // The dedicated /mentions page surfaces them.
    const identityDoc = await db
      .collection('identity_snapshots')
      .findOne(accountFilter);
    const ownerHandle =
      (identityDoc?.data as { username?: string } | undefined)?.username ??
      null;
    const platform =
      (identityDoc as { platform?: string } | null)?.platform ?? null;
    // IMPORTANT: accountFilter and ownPostsFilter both use `$or`. Spreading
    // them into the same object would silently drop the first `$or` (last
    // key wins), letting posts from other accounts leak in. Compose with
    // `$and` so both predicates apply.
    const ownPostsClause: Record<string, unknown> | null = ownerHandle
      ? {
          $or: [
            { 'data.ownerHandle': ownerHandle },
            { 'data.ownerHandle': null },
            { 'data.ownerHandle': { $exists: false } },
          ],
        }
      : null;

    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) dateFilter.$lte = new Date(`${to}T23:59:59.999Z`);

    const buildQuery = (
      includeDate: boolean,
    ): Record<string, unknown> => {
      const clauses: Record<string, unknown>[] = [accountFilter];
      if (ownPostsClause) clauses.push(ownPostsClause);
      if (includeDate && Object.keys(dateFilter).length > 0) {
        clauses.push({ 'data.publishedAt': dateFilter });
      }
      return clauses.length === 1 ? clauses[0] : { $and: clauses };
    };
    const query = buildQuery(true);
    const ownTotalFilter = buildQuery(false);

    const [raw, totalAll, totalMatching] = await Promise.all([
      db
        .collection('posts')
        .find(query)
        .sort({ 'data.publishedAt': -1, updated_at: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      db.collection('posts').countDocuments(ownTotalFilter),
      db.collection('posts').countDocuments(query),
    ]);

    return {
      props: {
        id,
        platform,
        posts: raw.map((r) => toPlainJson(r) as Post),
        totalAll,
        totalMatching,
        page,
        pageSize: PAGE_SIZE,
        filter,
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return {
      props: {
        id,
        platform: null,
        posts: [],
        totalAll: 0,
        totalMatching: 0,
        page,
        pageSize: PAGE_SIZE,
        filter,
      },
    };
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

export default function AccountPosts({
  id,
  platform,
  posts,
  totalAll,
  totalMatching,
  page,
  pageSize,
  filter,
}: PageProps) {
  const [selected, setSelected] = useState<Post | null>(null);
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const firstIdx = totalMatching === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, totalMatching);

  useEffect(() => {
    if (!selected) return;
    const slides = selected.data?.children ?? [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (slides.length > 1) {
        if (e.key === 'ArrowRight') {
          const evt = new CustomEvent('v-carousel-next');
          window.dispatchEvent(evt);
        }
        if (e.key === 'ArrowLeft') {
          const evt = new CustomEvent('v-carousel-prev');
          window.dispatchEvent(evt);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const totalLikes = posts.reduce((a, p) => a + (p.data?.metrics?.likes ?? 0), 0);
  const totalComments = posts.reduce(
    (a, p) => a + (p.data?.metrics?.comments ?? 0),
    0,
  );
  const topByLikes = posts
    .slice()
    .sort((a, b) => (b.data?.metrics?.likes ?? 0) - (a.data?.metrics?.likes ?? 0))[0];
  const videoCount = posts.filter((p) => p.data?.contentType === 'video').length;
  const storyCount = posts.filter((p) => p.data?.contentType === 'story').length;

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
            href={`/account/${id}`}
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--v-text-muted)',
            }}
          >
            ← Overview
          </Link>
          {PLATFORMS_WITH_MENTIONS.has(platform ?? '') && (
            <Link
              href={`/account/${id}/mentions`}
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--v-text-muted)',
              }}
            >
              Mentions →
            </Link>
          )}
          <div style={{ flex: 1 }} />
          <span className="v-tag outline">
            {totalMatching === 0
              ? '0 posts'
              : `${firstIdx}–${lastIdx} of ${totalMatching}`}
          </span>
          {totalAll !== totalMatching && (
            <span
              className="v-meta"
              style={{ color: 'var(--v-text-muted)' }}
            >
              {totalAll} total
            </span>
          )}
        </header>

        {/* filter bar */}
        <DateFilterBar id={id} filter={filter} />

        {/* hero title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <span className="v-kicker mint">Stream</span>
          <span className="v-eyebrow" style={{ color: '#fff' }}>
            Posts archive
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
        </div>

        <h1 className="v-display size-secondary" style={{ marginBottom: 32 }}>
          Everything, Ranked.
        </h1>

        {posts.length === 0 ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <span className="v-kicker mint">Empty</span>
            <h2 className="v-display size-tertiary" style={{ marginTop: 8 }}>
              No posts synced yet
            </h2>
            <p className="v-body" style={{ marginTop: 10 }}>
              Either the engagement sync hasn&apos;t run, or the account has no content.
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 20,
                marginBottom: 40,
              }}
            >
              <KpiTile
                kind="outline"
                label="Total likes"
                value={fmtNumber(totalLikes)}
              />
              <KpiTile
                kind="outline"
                label="Total comments"
                value={fmtNumber(totalComments)}
              />
              <KpiTile
                kind="mint"
                label={
                  topByLikes
                    ? `Top · ${fmtNumber(topByLikes.data?.metrics?.likes ?? 0)} ♥`
                    : 'Top post'
                }
                value={topByLikes ? truncate(topByLikes.data?.caption || '—', 56) : '—'}
                accentLabel
              />
              <KpiTile
                kind="uv"
                label="Mix"
                value={`${videoCount} video · ${storyCount} story`}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16,
              }}
            >
              {posts.map((p) => (
                <PostCard
                  key={p.platform_content_id}
                  post={p}
                  onClick={() => setSelected(p)}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination
                id={id}
                page={page}
                totalPages={totalPages}
                firstIdx={firstIdx}
                lastIdx={lastIdx}
                totalMatching={totalMatching}
                filter={filter}
              />
            )}
          </>
        )}

        {selected && <PostDialog post={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

type KpiKind = 'outline' | 'mint' | 'uv' | 'white';

function KpiTile({
  kind,
  label,
  value,
  accentLabel,
}: {
  kind: KpiKind;
  label: string;
  value: string;
  accentLabel?: boolean;
}) {
  const baseClass =
    kind === 'mint'
      ? 'v-tile-mint'
      : kind === 'uv'
      ? 'v-tile-uv'
      : kind === 'white'
      ? 'v-tile-white'
      : 'v-tile';
  const lightBg = kind === 'mint' || kind === 'white';
  return (
    <div
      className={baseClass}
      style={{
        padding: 24,
        borderRadius: 20,
        minHeight: 130,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div
        className="v-kicker"
        style={{
          color: accentLabel
            ? lightBg
              ? 'rgba(0,0,0,0.6)'
              : 'var(--v-mint)'
            : lightBg
            ? 'rgba(0,0,0,0.55)'
            : 'var(--v-text-muted)',
        }}
      >
        {label}
      </div>
      <div
        className="v-display"
        style={{
          fontSize: 36,
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: lightBg ? '#000' : '#fff',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PostCard({ post, onClick }: { post: Post; onClick: () => void }) {
  const d = post.data;
  const firstMediaUrl = d?.mediaUrls?.[0];
  const thumb = d?.thumbnailUrl;
  const isVideoPreview = !thumb && !!firstMediaUrl && isLikelyVideoUrl(firstMediaUrl);
  const imgSrc = thumb || (!isVideoPreview ? firstMediaUrl : undefined);
  const likes = d?.metrics?.likes ?? 0;
  const comments = d?.metrics?.comments ?? 0;
  const type = d?.contentType || 'post';
  // Text-only posts (Threads TEXT_POST / REPOST_FACADE / plain status
  // updates): no media but the caption is the whole content. Promote it
  // to the visual area instead of the small footer line.
  const isTextOnly = !imgSrc && !isVideoPreview && !!d?.caption;

  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        borderRadius: 20,
        overflow: 'hidden',
        background: '#131313',
        border: '1px solid #ffffff',
        transition: 'transform 160ms ease, border-color 160ms ease',
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
      <div
        style={{
          aspectRatio: '1 / 1',
          background: '#2d2d2d',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={`${post.platform} ${type}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : isVideoPreview ? (
          <video
            src={firstMediaUrl}
            muted
            playsInline
            preload="metadata"
            aria-label={`${post.platform} ${type}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : isTextOnly ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              padding: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              background:
                'radial-gradient(120% 80% at 0% 0%, rgba(60,255,208,0.10) 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--v-sans)',
                fontWeight: 600,
                fontSize: 18,
                lineHeight: 1.32,
                color: '#ffffff',
                whiteSpace: 'pre-wrap',
                display: '-webkit-box',
                WebkitLineClamp: 7,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {d?.caption}
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--v-text-muted)',
            }}
          >
            {type}
          </div>
        )}
        <span
          className="v-tag mint"
          style={{ position: 'absolute', top: 10, left: 10 }}
        >
          {type}
        </span>
        {(d?.children?.length ?? 0) > 1 && (
          <span
            className="v-tag white"
            style={{ position: 'absolute', top: 10, right: 10 }}
          >
            ⊞ {d?.children?.length}
          </span>
        )}
      </div>
      <div style={{ padding: 16 }}>
        {!isTextOnly && (
          <div
            style={{
              fontFamily: 'var(--v-sans)',
              fontWeight: 500,
              fontSize: 13,
              lineHeight: 1.45,
              minHeight: 36,
              color: '#ffffff',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {d?.caption || <span style={{ color: 'var(--v-text-muted)' }}>(no caption)</span>}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 14,
            marginTop: 14,
            alignItems: 'center',
            fontFamily: 'var(--v-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: '#ffffff',
          }}
        >
          <span>♥ {fmtNumber(likes)}</span>
          <span>✎ {fmtNumber(comments)}</span>
          <div style={{ flex: 1 }} />
          <span
            className="v-meta"
            style={{ color: 'var(--v-text-muted)' }}
          >
            <RelativeTime value={d?.publishedAt} />
          </span>
        </div>
      </div>
    </button>
  );
}

type DialogTab = 'stats' | 'insights' | 'comments' | 'raw';

function PostDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const d = post.data;
  const children = d?.children ?? [];
  const [slideIdx, setSlideIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<DialogTab>('stats');

  // Reset when a different post is opened.
  useEffect(() => {
    setSlideIdx(0);
    setActiveTab('stats');
  }, [post.platform_content_id]);

  // Arrow-key navigation (dispatched from the parent's keydown listener).
  useEffect(() => {
    const total = (post.data?.children?.length ?? 1);
    if (total <= 1) return;
    const next = () => setSlideIdx((i) => (i + 1) % total);
    const prev = () => setSlideIdx((i) => (i - 1 + total) % total);
    window.addEventListener('v-carousel-next', next as EventListener);
    window.addEventListener('v-carousel-prev', prev as EventListener);
    return () => {
      window.removeEventListener('v-carousel-next', next as EventListener);
      window.removeEventListener('v-carousel-prev', prev as EventListener);
    };
  }, [post.data?.children?.length]);

  // Build the slide list. Carousel → children, single → synthesised slide.
  const slides: Array<{ mediaType: string; mediaUrl?: string; thumbnailUrl?: string }> =
    children.length > 0
      ? children.map((c) => ({
          mediaType: c.mediaType || 'image',
          mediaUrl: c.mediaUrl ?? undefined,
          thumbnailUrl: c.thumbnailUrl ?? undefined,
        }))
      : [
          {
            mediaType: d?.contentType || 'image',
            mediaUrl: d?.mediaUrls?.[0],
            thumbnailUrl: d?.thumbnailUrl ?? undefined,
          },
        ];

  const activeIdx = Math.min(slideIdx, slides.length - 1);
  const active = slides[activeIdx];
  // Stories can be photo OR video — the contentType doesn't tell us which.
  // Trust the media URL extension instead of assuming type=story → video.
  const activeIsVideo =
    !!active.mediaUrl &&
    (active.mediaType === 'video' ||
      active.mediaType === 'reel' ||
      isLikelyVideoUrl(active.mediaUrl));

  const metrics = d?.metrics ?? {};
  // Top-level scalar metrics + entries from metrics.extra flattened.
  // `extra` holds platform-native names like `total_interactions`,
  // `navigation`, `replies`, `profile_visits`, `ig_reels_*`.
  const metricsList: Array<[string, number]> = [];
  for (const [k, v] of Object.entries(metrics)) {
    if (k === 'extra') continue;
    if (typeof v === 'number') metricsList.push([prettyMetricLabel(k), v]);
  }
  if (metrics.extra && typeof metrics.extra === 'object') {
    for (const [k, v] of Object.entries(metrics.extra)) {
      if (typeof v === 'number') metricsList.push([prettyMetricLabel(k), v]);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(8px, 2vw, 24px)',
        zIndex: 100,
      }}
    >
      <div
        className="v-dialog"
        style={{ position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="v-dialog-close"
          aria-label="Close dialog (Escape)"
        >
          Close · ESC
        </button>
        <div className="v-dialog-media">
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/*
              TikTok BC v1.3 doesn't expose a downloadable MP4 — only an
              official `embed_url` to their player. Prefer that iframe over
              the thumbnail-only fallback so the video actually plays inline.
            */}
            {d?.embedUrl && activeIdx === 0 && (d?.contentType === 'video' || activeIsVideo) ? (
              <iframe
                key={`embed-${post.platform_content_id}`}
                src={d.embedUrl}
                title={`${post.platform} ${d.contentType ?? 'video'}`}
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                style={{
                  border: 0,
                  width: '100%',
                  maxWidth: 420,
                  aspectRatio: '9 / 16',
                  height: 'auto',
                  background: '#000',
                  display: 'block',
                }}
              />
            ) : active.mediaUrl ? (
              activeIsVideo ? (
                <video
                  key={`slide-${activeIdx}`}
                  src={active.mediaUrl}
                  poster={active.thumbnailUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    display: 'block',
                    background: '#000',
                  }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`slide-${activeIdx}`}
                  src={active.mediaUrl}
                  alt={`${post.platform} ${active.mediaType} — slide ${activeIdx + 1}`}
                  referrerPolicy="no-referrer"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              )
            ) : active.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.thumbnailUrl}
                alt={`${post.platform} ${active.mediaType} — slide ${activeIdx + 1}`}
                referrerPolicy="no-referrer"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div className="v-meta">No media preview</div>
            )}

            {slides.length > 1 && (
              <>
                <CarouselArrow
                  side="left"
                  onClick={() =>
                    setSlideIdx((i) => (i - 1 + slides.length) % slides.length)
                  }
                />
                <CarouselArrow
                  side="right"
                  onClick={() => setSlideIdx((i) => (i + 1) % slides.length)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    padding: '4px 10px',
                    borderRadius: 20,
                    background: 'rgba(0,0,0,0.6)',
                    border: '1px solid #fff',
                    color: '#fff',
                    fontFamily: 'var(--v-mono)',
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}
                >
                  {activeIdx + 1} / {slides.length}
                </div>
              </>
            )}
          </div>

          {slides.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                padding: 10,
                justifyContent: 'center',
                borderTop: '1px solid #3d00bf',
                background: '#131313',
                overflowX: 'auto',
              }}
            >
              {slides.map((s, i) => {
                const thumb = s.thumbnailUrl || s.mediaUrl;
                const selected = i === activeIdx;
                return (
                  <button
                    key={i}
                    onClick={() => setSlideIdx(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      width: 48,
                      height: 48,
                      borderRadius: 6,
                      overflow: 'hidden',
                      flexShrink: 0,
                      border: `1px solid ${selected ? '#3cffd0' : 'rgba(255,255,255,0.3)'}`,
                      boxShadow: selected ? '0 0 0 2px #3cffd0 inset' : 'none',
                      background: '#2d2d2d',
                      position: 'relative',
                    }}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : null}
                    {(s.mediaType === 'video' || s.mediaType === 'reel') && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          right: 3,
                          fontFamily: 'var(--v-mono)',
                          fontSize: 9,
                          color: '#fff',
                          textShadow: '0 0 4px #000',
                        }}
                      >
                        ▶
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="v-dialog-info">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              // Reserve room for the floating CLOSE button (top-right of the
              // dialog, ~110px wide) so the date doesn't slide under it.
              paddingRight: 120,
            }}
          >
            <span className="v-tag mint">{d?.contentType || 'post'}</span>
            <span className="v-tag outline">{post.platform}</span>
            {d?.publishedAt && (
              <span
                className="v-meta"
                style={{ marginLeft: 4, whiteSpace: 'nowrap' }}
              >
                {fmtDateTime(d.publishedAt)}
              </span>
            )}
          </div>

          {d?.caption && <ExpandableCaption text={d.caption} />}

          <TabStrip
            active={activeTab}
            onChange={setActiveTab}
            insightsAvailable={Boolean(d?.insights && hasAnyInsight(d.insights))}
            commentsCount={d?.metrics?.comments}
          />

          {activeTab === 'stats' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 10,
              }}
            >
              {metricsList.length === 0 ? (
                <div
                  className="v-body"
                  style={{
                    gridColumn: '1 / -1',
                    color: 'var(--v-text-muted)',
                    fontSize: 13,
                  }}
                >
                  No metrics captured yet.
                </div>
              ) : (
                metricsList.map(([label, value]) => (
                  <MetricTile key={label} label={label} value={fmtNumber(value as number)} />
                ))
              )}
            </div>
          )}

          {activeTab === 'insights' && (
            d?.insights && hasAnyInsight(d.insights) ? (
              <InsightsBlock insights={d.insights} />
            ) : (
              <div
                className="v-body"
                style={{ color: 'var(--v-text-muted)', fontSize: 13 }}
              >
                No per-post insights captured yet. TikTok exposes them; Meta
                doesn&apos;t.
              </div>
            )
          )}

          {activeTab === 'comments' && (
            <CommentsTab
              accountId={post.account_id}
              contentId={post.platform_content_id}
              expectedCount={d?.metrics?.comments ?? 0}
            />
          )}

          {activeTab === 'raw' && (
            <RawDetailsBlock post={post} />
          )}
        </div>
      </div>
    </div>
  );
}

function CarouselArrow({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous slide' : 'Next slide'}
      style={{
        all: 'unset',
        cursor: 'pointer',
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        [side]: 12,
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.55)',
        border: '1px solid #ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontFamily: 'var(--v-display)',
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}

/**
 * Caption that clamps to 6 lines by default and toggles to full text via a
 * "Show more / Show less" button. Heuristic: only show the toggle when the
 * underlying paragraph actually overflows. We lean on CSS line-clamp for
 * the visual clip, then read scrollHeight vs clientHeight after layout to
 * decide whether the button is even needed (avoids showing it for short
 * captions). Re-measures on viewport resize.
 */
function ExpandableCaption({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // Compare full content height to the clamped height by toggling the
      // clamp class off momentarily isn't ideal; instead read scrollHeight
      // (full height, ignores overflow) vs clientHeight (clamped height).
      setOverflows(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p
        ref={ref}
        className="v-body"
        style={{
          whiteSpace: 'pre-wrap',
          color: '#ffffff',
          margin: 0,
          lineHeight: 1.55,
          ...(expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: 6,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
        }}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            color: 'var(--v-mint)',
            fontFamily: 'var(--v-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            paddingTop: 4,
          }}
        >
          {expanded ? 'Show less ↑' : 'Show more ↓'}
        </button>
      )}
    </div>
  );
}

function prettyMetricLabel(key: string): string {
  // Strip the `ig_` prefix (ig_reels_avg_watch_time → reels avg watch time).
  let label = key.replace(/^ig_/, '');
  // snake_case → Title Case.
  label = label.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Date-range filter for the posts grid. URL-driven (`?from=&to=`) so the
 * state survives refresh, is shareable, and is rendered server-side
 * (no flash of unfiltered content). Presets jump to N days back from today.
 */
function DateFilterBar({
  id,
  filter,
}: {
  id: string;
  filter: DateFilter;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filter.from ?? '');
  const [to, setTo] = useState(filter.to ?? '');

  // Keep local inputs in sync if the URL changes externally (back/forward).
  useEffect(() => {
    setFrom(filter.from ?? '');
    setTo(filter.to ?? '');
  }, [filter.from, filter.to]);

  const apply = (nextFrom: string, nextTo: string) => {
    // Always reset to page 1 when the filter changes — staying on page 5
    // of a 2-page result would render an empty grid.
    const query: Record<string, string> = {};
    if (nextFrom) query.from = nextFrom;
    if (nextTo) query.to = nextTo;
    router.push({ pathname: `/account/${id}/posts`, query });
  };

  const setPreset = (days: number | 'all') => {
    if (days === 'all') {
      apply('', '');
      return;
    }
    const today = new Date();
    const start = new Date(today.getTime() - days * 86_400_000);
    apply(toIsoDate(start), toIsoDate(today));
  };

  const isFiltered = filter.from !== null || filter.to !== null;
  const isPreset = (days: number) => {
    if (!isFiltered) return false;
    const today = new Date();
    const start = new Date(today.getTime() - days * 86_400_000);
    return filter.from === toIsoDate(start) && filter.to === toIsoDate(today);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        marginBottom: 28,
        padding: '14px 18px',
        background: 'rgba(82, 0, 255, 0.06)',
        border: '1px solid rgba(82, 0, 255, 0.35)',
        borderRadius: 14,
      }}
    >
      <span className="v-meta" style={{ color: 'var(--v-text-muted)' }}>
        Filter
      </span>

      {/* Presets */}
      {[
        { label: '7d', days: 7 },
        { label: '30d', days: 30 },
        { label: '90d', days: 90 },
      ].map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => setPreset(p.days)}
          className="v-tag"
          style={{
            cursor: 'pointer',
            border: '1px solid #ffffff',
            background: isPreset(p.days) ? 'var(--v-mint)' : 'transparent',
            color: isPreset(p.days) ? '#000' : '#fff',
          }}
        >
          Last {p.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setPreset('all')}
        className="v-tag"
        style={{
          cursor: 'pointer',
          border: '1px solid #ffffff',
          background: !isFiltered ? 'var(--v-mint)' : 'transparent',
          color: !isFiltered ? '#000' : '#fff',
        }}
      >
        All time
      </button>

      <div style={{ flex: 1 }} />

      {/* Custom range inputs */}
      <label
        className="v-meta"
        style={{ color: 'var(--v-text-muted)' }}
      >
        From
      </label>
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        onBlur={() => apply(from, to)}
        style={inputStyle}
      />
      <label
        className="v-meta"
        style={{ color: 'var(--v-text-muted)' }}
      >
        To
      </label>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onBlur={() => apply(from, to)}
        style={inputStyle}
      />

    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#0b0b0b',
  border: '1px solid rgba(255,255,255,0.2)',
  color: '#fff',
  padding: '6px 10px',
  borderRadius: 8,
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  colorScheme: 'dark',
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pagination footer. Mirrors the convention of `Prev | 1 2 [3] 4 5 ... 12 | Next`.
 * Compresses long page lists with ellipses to keep the row tight. URL-driven
 * via `?page=N` so back/forward and direct linking work; existing `from`/`to`
 * filter params are preserved.
 */
function Pagination({
  id,
  page,
  totalPages,
  firstIdx,
  lastIdx,
  totalMatching,
  filter,
}: {
  id: string;
  page: number;
  totalPages: number;
  firstIdx: number;
  lastIdx: number;
  totalMatching: number;
  filter: DateFilter;
}) {
  const baseQuery: Record<string, string> = {};
  if (filter.from) baseQuery.from = filter.from;
  if (filter.to) baseQuery.to = filter.to;
  const linkFor = (p: number) => ({
    pathname: `/account/${id}/posts`,
    query: { ...baseQuery, page: String(p) },
  });

  // Compress: always show 1, current-1, current, current+1, totalPages, with
  // ellipses where there are gaps.
  const pages = compactPageList(page, totalPages);

  return (
    <nav
      aria-label="Posts pagination"
      style={{
        marginTop: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <span className="v-meta" style={{ color: 'var(--v-text-muted)' }}>
        {firstIdx}–{lastIdx} of {totalMatching}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <PageLink href={page > 1 ? linkFor(page - 1) : null} label="‹ Prev" />
        {pages.map((p, i) =>
          p === '…' ? (
            <span
              key={`ellipsis-${i}`}
              className="v-meta"
              style={{
                color: 'var(--v-text-muted)',
                padding: '6px 8px',
              }}
            >
              …
            </span>
          ) : (
            <PageLink
              key={p}
              href={linkFor(p)}
              label={String(p)}
              active={p === page}
            />
          ),
        )}
        <PageLink href={page < totalPages ? linkFor(page + 1) : null} label="Next ›" />
      </div>
    </nav>
  );
}

function PageLink({
  href,
  label,
  active,
}: {
  href: { pathname: string; query: Record<string, string> } | null;
  label: string;
  active?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    fontFamily: 'var(--v-mono)',
    fontSize: 11,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid',
    cursor: href ? 'pointer' : 'not-allowed',
    textDecoration: 'none',
  };
  if (active) {
    return (
      <span
        aria-current="page"
        style={{
          ...baseStyle,
          background: 'var(--v-mint)',
          color: '#000',
          borderColor: 'var(--v-mint)',
        }}
      >
        {label}
      </span>
    );
  }
  if (!href) {
    return (
      <span
        aria-disabled="true"
        style={{
          ...baseStyle,
          background: 'transparent',
          color: 'rgba(255,255,255,0.3)',
          borderColor: 'rgba(255,255,255,0.15)',
        }}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      style={{
        ...baseStyle,
        background: 'transparent',
        color: '#fff',
        borderColor: '#ffffff',
      }}
    >
      {label}
    </Link>
  );
}

function compactPageList(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

function isLikelyVideoUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.(mp4|mov|webm|m4v)(\b|$)/i.test(pathname);
  } catch {
    return /\.mp4/i.test(url);
  }
}

function hasAnyInsight(i: PostInsights): boolean {
  return Boolean(
    (i.trafficSources && i.trafficSources.length > 0) ||
    (i.retentionCurve && i.retentionCurve.length > 0) ||
    (i.likesTimeline && i.likesTimeline.length > 0) ||
    (i.audienceCountries && i.audienceCountries.length > 0) ||
    (i.audienceCities && i.audienceCities.length > 0) ||
    (i.audienceGenders && i.audienceGenders.length > 0) ||
    (i.audienceTypes && i.audienceTypes.length > 0),
  );
}

function fmtPercent(fraction: number): string {
  // Inputs are 0..1 fractions (TikTok convention); render as 0%..100%.
  const v = fraction * 100;
  return v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`;
}

/**
 * Per-post insights — surfaced under the post dialog. TikTok ships every
 * field documented here; for platforms that don't, the `hasAnyInsight`
 * gate above keeps the block hidden so it doesn't render an empty section.
 */
function InsightsBlock({ insights }: { insights: PostInsights }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        marginTop: 4,
        paddingTop: 18,
        borderTop: '1px solid #3d00bf',
      }}
    >
      <div className="v-kicker mint" style={{ letterSpacing: '0.16em' }}>
        Per-post insights
      </div>

      {insights.retentionCurve && insights.retentionCurve.length > 0 && (
        <div>
          <div
            className="v-meta"
            style={{ color: 'var(--v-text-muted)', marginBottom: 6 }}
          >
            Retention curve · what % of viewers were still watching at each second
          </div>
          <RetentionSparkline points={insights.retentionCurve} accent="#3cffd0" />
        </div>
      )}

      {insights.likesTimeline && insights.likesTimeline.some((p) => p.percentage > 0) && (
        <div>
          <div
            className="v-meta"
            style={{ color: 'var(--v-text-muted)', marginBottom: 6 }}
          >
            Likes timeline · % of total likes given at each second
          </div>
          <RetentionSparkline points={insights.likesTimeline} accent="#ff5cd2" />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {insights.trafficSources && insights.trafficSources.length > 0 && (
          <BucketBars title="Traffic source" buckets={insights.trafficSources} />
        )}
        {insights.audienceTypes && insights.audienceTypes.length > 0 && (
          <BucketBars title="Audience type" buckets={insights.audienceTypes} />
        )}
        {insights.audienceCountries && insights.audienceCountries.length > 0 && (
          <BucketBars
            title="Top countries"
            buckets={insights.audienceCountries}
            limit={6}
          />
        )}
        {insights.audienceCities && insights.audienceCities.length > 0 && (
          <BucketBars title="Top cities" buckets={insights.audienceCities} limit={6} />
        )}
        {insights.audienceGenders && insights.audienceGenders.length > 0 && (
          <BucketBars title="Gender split" buckets={insights.audienceGenders} />
        )}
      </div>
    </div>
  );
}

function BucketBars({
  title,
  buckets,
  limit,
}: {
  title: string;
  buckets: DistributionBucket[];
  limit?: number;
}) {
  // Sort by value descending so the dominant slice is on top.
  const ordered = [...buckets].sort((a, b) => b.value - a.value);
  const visible = limit ? ordered.slice(0, limit) : ordered;

  return (
    <div
      style={{
        background: '#0b0b0b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div className="v-meta" style={{ fontSize: 10, color: 'var(--v-text-muted)' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map((b) => {
          const pct = b.unit === 'count' ? b.value : Math.max(0, Math.min(1, b.value)) * 100;
          const display = b.unit === 'count' ? fmtNumber(b.value) : fmtPercent(b.value);
          return (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--v-mono)',
                  fontSize: 11,
                  color: '#fff',
                }}
              >
                <span>{b.label}</span>
                <span style={{ color: 'var(--v-text-muted)' }}>{display}</span>
              </div>
              {b.unit !== 'count' && (
                <div
                  style={{
                    height: 4,
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--v-mint)',
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RetentionSparkline({
  points,
  accent,
}: {
  points: SecondPercentage[];
  accent: string;
}) {
  if (points.length === 0) return null;
  // Sort defensively (mapper sorts already, but a UI render is too cheap a
  // place to trust upstream).
  const sorted = [...points].sort((a, b) => a.second - b.second);
  const width = 600;
  const height = 90;
  const padX = 4;
  const padY = 6;
  const maxSecond = sorted[sorted.length - 1].second || 1;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const pathD = sorted
    .map((p, i) => {
      const x = padX + (p.second / maxSecond) * innerW;
      const y = padY + (1 - Math.max(0, Math.min(1, p.percentage))) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Closed area path for fill below the line.
  const areaD = `${pathD} L${padX + innerW},${padY + innerH} L${padX},${padY + innerH} Z`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Retention curve"
      style={{
        display: 'block',
        background: '#0b0b0b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
      }}
    >
      <path d={areaD} fill={accent} fillOpacity={0.18} />
      <path d={pathD} stroke={accent} strokeWidth={1.5} fill="none" />
      <text
        x={padX}
        y={height - 2}
        fontFamily="var(--v-mono)"
        fontSize={9}
        fill="rgba(255,255,255,0.4)"
      >
        0s
      </text>
      <text
        x={width - padX}
        y={height - 2}
        textAnchor="end"
        fontFamily="var(--v-mono)"
        fontSize={9}
        fill="rgba(255,255,255,0.4)"
      >
        {maxSecond}s
      </text>
    </svg>
  );
}

type TabDef = { id: DialogTab; label: string; badge?: string | number; dim?: boolean };

function TabStrip({
  active,
  onChange,
  insightsAvailable,
  commentsCount,
}: {
  active: DialogTab;
  onChange: (t: DialogTab) => void;
  insightsAvailable: boolean;
  commentsCount?: number;
}) {
  const tabs: TabDef[] = [
    { id: 'stats', label: 'Stats' },
    { id: 'insights', label: 'Insights', dim: !insightsAvailable },
    {
      id: 'comments',
      label: 'Comments',
      badge: typeof commentsCount === 'number' && commentsCount > 0 ? commentsCount : undefined,
    },
    { id: 'raw', label: 'Raw' },
  ];

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: '#0b0b0b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        marginTop: 4,
      }}
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              textAlign: 'center',
              background: isActive ? 'var(--v-mint)' : 'transparent',
              color: isActive
                ? '#000'
                : t.dim
                ? 'rgba(255,255,255,0.35)'
                : '#fff',
              transition: 'background 120ms ease, color 120ms ease',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: isActive ? '#000' : 'rgba(255,255,255,0.12)',
                  color: isActive ? 'var(--v-mint)' : '#fff',
                  letterSpacing: '0.05em',
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface ApiCommentDoc {
  platformCommentId: string;
  platformContentId: string;
  parentCommentId?: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  text: string;
  publishedAt: string | null;
  fetchedAt: string | null;
  metrics: { likes?: number; replies?: number };
  pinned?: boolean;
  likedByCreator?: boolean;
  isOwnerReply?: boolean;
}

interface CommentsApiResponse {
  contentId: string;
  total: number;
  comments: ApiCommentDoc[];
  error?: string;
}

/**
 * Lazy-loads /api/comments?accountId=X&contentId=Y when the tab activates.
 * One fetch per (accountId, contentId) — re-renders on the same dialog reuse
 * the cached array. Renders top-level comments + indented replies.
 */
function CommentsTab({
  accountId,
  contentId,
  expectedCount,
}: {
  accountId: string;
  contentId: string;
  expectedCount: number;
}) {
  const [data, setData] = useState<ApiCommentDoc[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/comments?accountId=${encodeURIComponent(accountId)}&contentId=${encodeURIComponent(contentId)}`)
      .then(async (r) => {
        const body = (await r.json()) as CommentsApiResponse;
        if (cancelled) return;
        if (!r.ok || body.error) {
          setError(body.error || `HTTP ${r.status}`);
          setData([]);
        } else {
          setData(body.comments);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, contentId]);

  if (loading) {
    return (
      <div className="v-body" style={{ color: 'var(--v-text-muted)', fontSize: 13 }}>
        Loading comments…
      </div>
    );
  }

  if (error) {
    return (
      <div className="v-body" style={{ color: '#ff7777', fontSize: 13 }}>
        Failed to load comments: {error}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        className="v-body"
        style={{ color: 'var(--v-text-muted)', fontSize: 13, lineHeight: 1.6 }}
      >
        No comments synced for this post yet.
        {expectedCount > 0 && (
          <>
            {' '}
            <span style={{ color: '#fff' }}>
              The post&apos;s aggregate counter shows {fmtNumber(expectedCount)}{' '}
              — run a comments sync to fetch them.
            </span>
          </>
        )}
      </div>
    );
  }

  // TikTok's `/business/video/list/.comments` (and Meta's analogue) are
  // cached aggregate counters. They drift from the live thread fetched via
  // `/business/comment/list/` — caches lag, hidden/banned comments may
  // still count, etc. So mismatches are EXPECTED and the truth is whatever
  // the comment-list endpoint just returned.
  const counterMismatch =
    expectedCount > 0 && expectedCount !== data.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="v-meta"
        style={{ color: 'var(--v-text-muted)' }}
      >
        {data.length} comment{data.length === 1 ? '' : 's'} synced
        {counterMismatch && (
          <span
            style={{ marginLeft: 6, color: 'rgba(255,255,255,0.5)' }}
            title={`Aggregate counter on the post is ${fmtNumber(expectedCount)} but the comments endpoint returned ${data.length}. The aggregate is platform-cached and frequently drifts.`}
          >
            · post counter says {fmtNumber(expectedCount)} (stale, ignore)
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((c) => (
          <CommentRow key={c.platformCommentId} comment={c} />
        ))}
      </div>
    </div>
  );
}

function CommentRow({ comment }: { comment: ApiCommentDoc }) {
  const isReply = !!comment.parentCommentId;
  const initials = (comment.authorDisplayName || comment.authorHandle || '?')
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      style={{
        marginLeft: isReply ? 32 : 0,
        padding: 12,
        background: '#0b0b0b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: comment.pinned
          ? '3px solid var(--v-mint)'
          : isReply
          ? '3px solid rgba(255,255,255,0.18)'
          : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        display: 'flex',
        gap: 12,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: '50%',
          background: '#2d2d2d',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--v-mono)',
          fontSize: 11,
          letterSpacing: '0.05em',
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontFamily: 'var(--v-mono)',
            fontSize: 11,
          }}
        >
          <span style={{ color: '#fff' }}>
            {comment.authorDisplayName ||
              (comment.authorHandle ? `@${comment.authorHandle}` : 'Unknown')}
          </span>
          {comment.authorHandle && comment.authorDisplayName && (
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
              @{comment.authorHandle}
            </span>
          )}
          {comment.pinned && <span className="v-tag mint">📌 pinned</span>}
          {comment.likedByCreator && (
            <span className="v-tag outline">❤ creator</span>
          )}
          {comment.isOwnerReply && (
            <span className="v-tag outline">🪪 owner</span>
          )}
          <div style={{ flex: 1 }} />
          <span className="v-meta" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <RelativeTime value={comment.publishedAt} />
          </span>
        </div>
        <p
          className="v-body"
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.55,
            color: '#fff',
            whiteSpace: 'pre-wrap',
          }}
        >
          {comment.text || (
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>(no text)</span>
          )}
        </p>
        {(comment.metrics?.likes || comment.metrics?.replies) && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.55)',
              marginTop: 2,
            }}
          >
            {!!comment.metrics?.likes && <span>♥ {fmtNumber(comment.metrics.likes)}</span>}
            {!!comment.metrics?.replies && (
              <span>↩ {fmtNumber(comment.metrics.replies)} replies</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RawDetailsBlock({ post }: { post: Post }) {
  const d = post.data;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <DetailRow
          label="Published"
          value={
            d?.publishedAt
              ? `${fmtDateTime(d.publishedAt)} · ${fmtRelative(d.publishedAt)}`
              : '—'
          }
        />
        <DetailRow
          label="Synced"
          value={
            post.updated_at
              ? `${fmtDateTime(post.updated_at)} · ${fmtRelative(post.updated_at)}`
              : '—'
          }
        />
        <DetailRow label="Platform id" value={post.platform_content_id} mono />
        {d?.mediaProductType && (
          <DetailRow label="Product type" value={d.mediaProductType} mono />
        )}
        {d?.shortcode && <DetailRow label="Shortcode" value={d.shortcode} mono />}
        {d?.ownerHandle && (
          <DetailRow label="Owner" value={`@${d.ownerHandle}`} mono />
        )}
        {d?.isSharedToFeed !== null && d?.isSharedToFeed !== undefined && (
          <DetailRow
            label="Shared to feed"
            value={d.isSharedToFeed ? 'yes' : 'no'}
          />
        )}
        {(d?.children?.length ?? 0) > 0 && (
          <DetailRow label="Carousel" value={`${d?.children?.length} slides`} />
        )}
        {d?.embedUrl && (
          <DetailRow
            label="Embed URL"
            value={
              <a
                href={d.embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--v-mint)',
                  fontSize: 11,
                  fontFamily: 'var(--v-mono)',
                  wordBreak: 'break-all',
                }}
              >
                {truncate(d.embedUrl, 64)}
              </a>
            }
          />
        )}
        {d?.permalink && (
          <DetailRow
            label="Permalink"
            value={
              <a
                href={d.permalink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--v-mint)' }}
              >
                Open on {post.platform} ↗
              </a>
            }
          />
        )}
        {d?.mediaUrls && d.mediaUrls.length > 0 && (
          <DetailRow
            label="Media URLs"
            value={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {d.mediaUrls.map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--v-mint)',
                      fontSize: 11,
                      wordBreak: 'break-all',
                      fontFamily: 'var(--v-mono)',
                    }}
                  >
                    {truncate(u, 64)}
                  </a>
                ))}
              </div>
            }
          />
        )}
        {d?.rawResponse?.contentHash && (
          <DetailRow
            label="Raw hash"
            value={d.rawResponse.contentHash.slice(0, 16) + '…'}
            mono
          />
        )}
      </div>

      <details>
        <summary
          className="v-meta"
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          Raw document JSON
        </summary>
        <pre
          style={{
            background: '#0b0b0b',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: 16,
            borderRadius: 10,
            marginTop: 10,
            fontSize: 11,
            lineHeight: 1.55,
            overflow: 'auto',
            maxHeight: 420,
            fontFamily: 'var(--v-mono)',
            color: '#e9e9e9',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            tabSize: 2,
          }}
        >
          {JSON.stringify(post, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#2d2d2d',
        borderRadius: 20,
        padding: 16,
      }}
    >
      <div className="v-meta" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div
        className="v-display"
        style={{
          fontSize: 26,
          lineHeight: 1,
          marginTop: 6,
          color: '#ffffff',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <span
        className="v-meta"
        style={{ width: 110, flexShrink: 0, paddingTop: 2 }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: '#ffffff',
          flex: 1,
          wordBreak: 'break-word',
          fontFamily: mono ? 'var(--v-mono)' : 'var(--v-sans)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
