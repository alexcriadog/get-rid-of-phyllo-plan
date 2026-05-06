// Mentions page — lists every Threads/IG/FB post in the `posts` collection
// whose `data.ownerHandle` is NOT the connected account's handle. These are
// the posts of OTHER authors that @-mentioned us.

import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtNumber, fmtDate } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';

type IdentityData = {
  username?: string;
  displayName?: string;
};
type IdentitySnapshot = { account_id: string; platform: string; data?: IdentityData };

type PostData = {
  platformContentId?: string;
  contentType?: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrls?: string[];
  thumbnailUrl?: string | null;
  ownerHandle?: string | null;
  metrics?: { likes?: number; comments?: number; views?: number; shares?: number };
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
  mentions: Post[];
};

// Mirrors the support matrix at /admin/support-matrix — only adapters that
// implement fetchMentions can populate this view.
const PLATFORMS_WITH_MENTIONS = new Set<string>(['tiktok', 'threads', 'facebook']);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const [identityDoc, postDocs] = await Promise.all([
      db.collection('identity_snapshots').findOne({ $or: filters }),
      db
        .collection('posts')
        .find({ $or: filters })
        .sort({ 'data.publishedAt': -1, updated_at: -1 })
        .toArray(),
    ]);
    const identity = identityDoc ? (toPlainJson(identityDoc) as IdentitySnapshot) : null;
    // Gate: this page only makes sense for platforms whose adapters implement
    // fetchMentions (tiktok / threads). For instagram / facebook redirect to
    // the account overview so users don't land on an empty mentions panel.
    if (identity && !PLATFORMS_WITH_MENTIONS.has(identity.platform)) {
      return {
        redirect: { destination: `/account/${id}`, permanent: false },
      };
    }
    const ownerHandle = identity?.data?.username ?? null;
    const all = postDocs.map((p) => toPlainJson(p) as Post);
    // A "mention" is any post whose ownerHandle differs from the connected
    // account's handle. Posts without ownerHandle (older snapshots, or
    // platforms that don't surface an author) are excluded.
    const mentions = ownerHandle
      ? all.filter(
          (p) => p.data?.ownerHandle && p.data.ownerHandle !== ownerHandle,
        )
      : all.filter((p) => !!p.data?.ownerHandle);
    return { props: { id, identity, mentions } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, mentions: [] } };
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

export default function MentionsPage({ id, identity, mentions }: PageProps) {
  const [selected, setSelected] = useState<Post | null>(null);
  const ownerHandle = identity?.data?.username;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const uniqueAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const m of mentions) {
      const h = m.data?.ownerHandle;
      if (h) set.add(h);
    }
    return set.size;
  }, [mentions]);

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
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
          <Link
            href={`/account/${id}/posts`}
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--v-text-muted)',
            }}
          >
            Posts archive →
          </Link>
          <div style={{ flex: 1 }} />
          <span className="v-tag outline">{mentions.length} mentions</span>
        </header>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <span className="v-kicker mint">@-mentions</span>
          <span className="v-eyebrow" style={{ color: '#fff' }}>
            What others say about{' '}
            {ownerHandle ? <span>@{ownerHandle}</span> : 'this account'}
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
        </div>

        <h1 className="v-display size-secondary" style={{ marginBottom: 32 }}>
          Mentioned, captured.
        </h1>

        {mentions.length === 0 ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <span className="v-kicker mint">No mentions</span>
            <h2 className="v-display size-tertiary" style={{ marginTop: 8 }}>
              Nobody&apos;s tagged this account yet
            </h2>
            <p className="v-body" style={{ marginTop: 10 }}>
              The next mentions sync will populate this list. Or the platform
              hasn&apos;t exposed any mentions for this account yet.
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 20,
                marginBottom: 40,
              }}
            >
              <KpiTile
                kind="outline"
                label="Total mentions"
                value={fmtNumber(mentions.length)}
              />
              <KpiTile
                kind="mint"
                label="Unique authors"
                value={fmtNumber(uniqueAuthors)}
              />
              <KpiTile
                kind="uv"
                label="Most recent"
                value={fmtDate(mentions[0]?.data?.publishedAt)}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {mentions.map((m) => (
                <MentionCard
                  key={m.platform_content_id}
                  post={m}
                  onClick={() => setSelected(m)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <MentionDialog post={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function MentionCard({ post, onClick }: { post: Post; onClick: () => void }) {
  const d = post.data;
  const handle = d?.ownerHandle ? `@${d.ownerHandle}` : '@unknown';
  const text = d?.caption ?? '';
  const thumb = d?.thumbnailUrl || d?.mediaUrls?.[0];
  const likes = d?.metrics?.likes;
  const replies = d?.metrics?.comments;

  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 20,
        overflow: 'hidden',
        background:
          'radial-gradient(120% 80% at 0% 0%, rgba(60,255,208,0.10) 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
        border: '1px solid #ffffff',
        transition: 'transform 160ms ease, border-color 160ms ease',
        minHeight: 220,
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
          padding: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          className="v-tag mint"
          style={{ fontSize: 10, letterSpacing: '0.14em' }}
        >
          {handle}
        </span>
        <div style={{ flex: 1 }} />
        <span
          className="v-meta"
          style={{ color: 'var(--v-text-muted)', fontSize: 10 }}
        >
          <RelativeTime value={d?.publishedAt} />
        </span>
      </div>
      <div
        style={{
          padding: 18,
          flex: 1,
          fontFamily: 'var(--v-sans)',
          fontWeight: 500,
          fontSize: 15,
          lineHeight: 1.45,
          color: '#ffffff',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {text || <span style={{ color: 'var(--v-text-muted)' }}>(no caption)</span>}
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={`${handle} attachment`}
          referrerPolicy="no-referrer"
          loading="lazy"
          style={{
            width: '100%',
            maxHeight: 160,
            objectFit: 'cover',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        />
      )}
      <div
        style={{
          padding: '12px 18px',
          display: 'flex',
          gap: 14,
          fontFamily: 'var(--v-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: '#ffffff',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {typeof likes === 'number' && <span>♥ {fmtNumber(likes)}</span>}
        {typeof replies === 'number' && <span>✎ {fmtNumber(replies)}</span>}
        <div style={{ flex: 1 }} />
        {d?.permalink && (
          <span style={{ color: 'var(--v-text-muted)' }}>↗ open</span>
        )}
      </div>
    </button>
  );
}

function MentionDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const d = post.data;
  const handle = d?.ownerHandle ? `@${d.ownerHandle}` : '@unknown';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 640,
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: '#0e0e0e',
          border: '1px solid #ffffff',
          borderRadius: 20,
          padding: 28,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <span className="v-tag mint">{handle}</span>
          <span
            className="v-meta"
            style={{ color: 'var(--v-text-muted)', fontSize: 11 }}
          >
            <RelativeTime value={d?.publishedAt} />
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              color: 'var(--v-text-muted)',
            }}
          >
            CLOSE ✕
          </button>
        </div>
        <p
          style={{
            fontFamily: 'var(--v-sans)',
            fontWeight: 500,
            fontSize: 17,
            lineHeight: 1.5,
            color: '#fff',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}
        >
          {d?.caption || '(no caption)'}
        </p>
        {(d?.thumbnailUrl || d?.mediaUrls?.[0]) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d?.thumbnailUrl || d?.mediaUrls?.[0]}
            alt="mention attachment"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              marginTop: 18,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          />
        )}
        {d?.permalink && (
          <a
            href={d.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: 20,
              fontFamily: 'var(--v-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              color: 'var(--v-mint)',
              textDecoration: 'none',
            }}
          >
            ↗ Open on platform
          </a>
        )}
      </div>
    </div>
  );
}

function KpiTile({
  kind,
  label,
  value,
}: {
  kind: 'outline' | 'mint' | 'uv';
  label: string;
  value: string;
}) {
  const isMint = kind === 'mint';
  const isUv = kind === 'uv';
  return (
    <div
      style={{
        padding: 22,
        borderRadius: 18,
        border: '1px solid #ffffff',
        background: isMint
          ? 'linear-gradient(135deg, rgba(60,255,208,0.18) 0%, rgba(19,19,19,0.6) 100%)'
          : isUv
            ? 'linear-gradient(135deg, rgba(134,99,255,0.18) 0%, rgba(19,19,19,0.6) 100%)'
            : '#131313',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--v-text-muted)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--v-display)',
          fontSize: 28,
          color: '#fff',
          letterSpacing: '0.02em',
        }}
      >
        {value}
      </div>
    </div>
  );
}
