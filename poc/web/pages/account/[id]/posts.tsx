import Link from 'next/link';
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

type PostData = {
  platformContentId?: string;
  contentType?: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrls?: string[];
  thumbnailUrl?: string | null;
  metrics?: PostMetrics;
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

type PageProps = {
  id: string;
  posts: Post[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const raw = await db
      .collection('posts')
      .find({ $or: filters })
      .sort({ 'data.publishedAt': -1, updated_at: -1 })
      .limit(60)
      .toArray();
    return { props: { id, posts: raw.map((r) => toPlainJson(r) as Post) } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, posts: [] } };
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

export default function AccountPosts({ id, posts }: PageProps) {
  const [selected, setSelected] = useState<Post | null>(null);

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
            marginBottom: 32,
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
          <div style={{ flex: 1 }} />
          <span className="v-tag outline">{posts.length} posts</span>
        </header>

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

function PostDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const d = post.data;
  const children = d?.children ?? [];
  const [slideIdx, setSlideIdx] = useState(0);

  // Reset when a different post is opened.
  useEffect(() => {
    setSlideIdx(0);
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
            {active.mediaUrl ? (
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

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              borderTop: '1px solid #3d00bf',
              paddingTop: 20,
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
            {d?.shortcode && (
              <DetailRow label="Shortcode" value={d.shortcode} mono />
            )}
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
              <DetailRow
                label="Carousel"
                value={`${d?.children?.length} slides`}
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

          <details style={{ marginTop: 4 }}>
            <summary
              className="v-meta"
              style={{
                cursor: 'pointer',
                userSelect: 'none',
              }}
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

function isLikelyVideoUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.(mp4|mov|webm|m4v)(\b|$)/i.test(pathname);
  } catch {
    return /\.mp4/i.test(url);
  }
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
