// Reviews / ratings page — surfaces FB Page reviews captured via the
// pages_read_user_content scope (admin endpoint /admin/ca/ratings/sync).
// Reads from Mongo `page_ratings` collection.

import Link from 'next/link';
import { useMemo } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtNumber } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: { username?: string; displayName?: string };
};

type ReviewRow = {
  account_id: string;
  platform_review_id: string;
  rating: number | null;
  recommendation_type: 'positive' | 'negative' | string | null;
  review_text: string | null;
  reviewer_name: string | null;
  reviewer_id: string | null;
  permalink_url: string | null;
  created_time: string | null;
  captured_at: string | null;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  reviews: ReviewRow[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const [identityDoc, reviewDocs] = await Promise.all([
      db.collection('identity_snapshots').findOne({ $or: filters }),
      db
        .collection('page_ratings')
        .find({ account_id: id })
        .sort({ created_time: -1, captured_at: -1 })
        .limit(100)
        .toArray(),
    ]);
    const identity = identityDoc
      ? (toPlainJson(identityDoc) as IdentitySnapshot)
      : null;
    if (identity && identity.platform !== 'facebook') {
      return { redirect: { destination: `/account/${id}`, permanent: false } };
    }
    return {
      props: {
        id,
        identity,
        reviews: reviewDocs.map((d) => toPlainJson(d) as ReviewRow),
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, reviews: [] } };
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

export default function ReviewsPage({ id, identity, reviews }: PageProps) {
  const ownerHandle = identity?.data?.username ?? identity?.data?.displayName;

  const stats = useMemo(() => {
    const total = reviews.length;
    const positive = reviews.filter(
      (r) => r.recommendation_type === 'positive' || (r.rating ?? 0) >= 4,
    ).length;
    const negative = reviews.filter(
      (r) => r.recommendation_type === 'negative' || (r.rating !== null && r.rating < 3),
    ).length;
    const ratings = reviews
      .map((r) => r.rating)
      .filter((n): n is number => typeof n === 'number');
    const avg = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : null;
    return { total, positive, negative, avg };
  }, [reviews]);

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Link href={`/account/${id}`} className="v-meta">
            ← Overview
          </Link>
          <Link href={`/account/${id}/mentions`} className="v-meta">
            Mentions →
          </Link>
          <div style={{ flex: 1 }} />
          <span className="v-tag outline">{reviews.length} reviews</span>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span className="v-kicker mint">Reputation</span>
          <span className="v-eyebrow" style={{ color: '#fff' }}>
            What people say about{' '}
            {ownerHandle ? <span>@{ownerHandle}</span> : 'this Page'}
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
        </div>

        <h1 className="v-display size-secondary" style={{ marginBottom: 32 }}>
          Voice of the audience.
        </h1>

        {reviews.length === 0 ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <span className="v-kicker mint">No reviews yet</span>
            <h2 className="v-display size-tertiary" style={{ marginTop: 8 }}>
              The Page hasn&apos;t been reviewed yet
            </h2>
            <p className="v-body" style={{ marginTop: 10 }}>
              Trigger a review pull from the admin panel:{' '}
              <code style={{ fontFamily: 'var(--v-mono)' }}>
                POST /admin/ca/ratings/sync/{id}
              </code>
              . Once reviewers leave star/recommendation feedback on Facebook
              they will appear here.
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
              <KpiTile label="Total reviews" value={fmtNumber(stats.total)} kind="outline" />
              <KpiTile
                label="Avg rating"
                value={stats.avg != null ? `${stats.avg.toFixed(1)} / 5` : '—'}
                kind="mint"
              />
              <KpiTile
                label="Positive"
                value={fmtNumber(stats.positive)}
                kind="outline"
              />
              <KpiTile
                label="Negative"
                value={fmtNumber(stats.negative)}
                kind="uv"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
              }}
            >
              {reviews.map((r) => (
                <ReviewCard key={r.platform_review_id} review={r} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewRow }) {
  const isPositive =
    review.recommendation_type === 'positive' || (review.rating ?? 0) >= 4;
  const accent = isPositive ? '#3cffd0' : '#5200ff';

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 18,
        border: `1px solid ${accent}`,
        background:
          'radial-gradient(120% 80% at 0% 0%, rgba(60,255,208,0.06) 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="v-tag"
          style={{
            background: isPositive ? '#3cffd0' : '#5200ff',
            color: isPositive ? '#000' : '#fff',
          }}
        >
          {review.recommendation_type ?? (isPositive ? 'positive' : 'negative')}
        </span>
        {typeof review.rating === 'number' && (
          <span className="v-tag outline-mint">
            {'★'.repeat(Math.round(review.rating))}
            <span style={{ opacity: 0.4, marginLeft: 4 }}>
              {'★'.repeat(5 - Math.round(review.rating))}
            </span>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span className="v-meta" style={{ fontSize: 10 }}>
          <RelativeTime value={review.created_time} />
        </span>
      </div>

      <div
        style={{
          fontFamily: 'var(--v-sans)',
          fontWeight: 500,
          fontSize: 14,
          lineHeight: 1.5,
          color: '#fff',
          minHeight: 48,
        }}
      >
        {review.review_text || (
          <span style={{ color: 'var(--v-text-muted)' }}>
            (recommendation without text)
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          fontFamily: 'var(--v-mono)',
          fontSize: 11,
        }}
      >
        <span style={{ color: '#fff' }}>
          {review.reviewer_name ?? 'anonymous reviewer'}
        </span>
        <div style={{ flex: 1 }} />
        {review.permalink_url && (
          <a
            href={review.permalink_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--v-mint)', textDecoration: 'none' }}
          >
            ↗ open
          </a>
        )}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  kind,
}: {
  label: string;
  value: string;
  kind: 'outline' | 'mint' | 'uv';
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
            ? 'linear-gradient(135deg, rgba(82,0,255,0.22) 0%, rgba(19,19,19,0.6) 100%)'
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
