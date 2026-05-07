// Watchlist detail — every public field PPCA returns for a single Page,
// plus its 12 most recent posts with engagement counts. SSR-fetched so
// the URL is shareable.

import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  Heart,
  MapPin,
  MessageSquare,
  RefreshCw,
  Repeat2,
  Trash2,
} from 'lucide-react';
import AdminLayout from '../../../components/AdminLayout';
import { adminDelete, adminPost } from '../../../lib/api';
import { fmtNumber } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';

interface PublicPagePost {
  id: string;
  message: string | null;
  story: string | null;
  created_time: string | null;
  permalink_url: string | null;
  full_picture: string | null;
  reactions_total: number;
  comments_total: number;
  shares_total: number;
}

interface Snapshot {
  page_id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  category_list: Array<{ id: string; name: string }> | null;
  about: string | null;
  description: string | null;
  bio: string | null;
  link: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fan_count: number | null;
  followers_count: number | null;
  talking_about_count: number | null;
  were_here_count: number | null;
  verification_status: string | null;
  is_verified: boolean | null;
  location: Record<string, unknown> | null;
  phone: string | null;
  website: string | null;
  emails: string[] | null;
  company_overview: string | null;
  founded: string | null;
  mission: string | null;
  products: string | null;
  parent_page: { id: string; name: string } | null;
  rating_count: number | null;
  overall_star_rating: number | null;
  price_range: string | null;
  recent_posts: PublicPagePost[];
  captured_at: string | null;
  tracked_at: string | null;
}

type Props = { snap: Snapshot | null; pageId: string };

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const pageId = String(ctx.params?.pageId || '');
  try {
    const apiBase =
      process.env.CONNECTOR_API_URL ??
      process.env.NEXT_PUBLIC_CONNECTOR_API_URL ??
      'http://api:3000';
    const res = await fetch(
      `${apiBase}/admin/watchlist/${encodeURIComponent(pageId)}`,
    );
    if (!res.ok) {
      return { props: { snap: null, pageId } };
    }
    const body = (await res.json()) as { item: Snapshot | null };
    return { props: { snap: body.item ?? null, pageId } };
  } catch {
    return { props: { snap: null, pageId } };
  }
};

export default function WatchlistDetail({ snap, pageId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);

  if (!snap) {
    return (
      <AdminLayout title="Page not tracked">
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="mb-4 text-muted-foreground">
            <code>{pageId}</code> is not in the watchlist (or the snapshot
            hasn&apos;t loaded yet).
          </p>
          <Link
            href="/admin/watchlist"
            className="inline-flex items-center gap-2 text-sm underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to watchlist
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const refresh = async () => {
    setBusy('refresh');
    try {
      await adminPost(`/admin/watchlist/${snap.page_id}/refresh`);
      router.replace(router.asPath);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Untrack ${snap.name ?? snap.page_id}?`)) return;
    setBusy('remove');
    try {
      await adminDelete(`/admin/watchlist/${snap.page_id}`);
      router.push('/admin/watchlist');
    } finally {
      setBusy(null);
    }
  };

  const fans =
    typeof snap.fan_count === 'number' ? snap.fan_count : snap.followers_count;
  const followers =
    typeof snap.followers_count === 'number' && snap.followers_count !== fans
      ? snap.followers_count
      : null;
  const loc = snap.location
    ? [
        (snap.location.street as string) ?? '',
        (snap.location.city as string) ?? '',
        (snap.location.state as string) ?? '',
        (snap.location.country as string) ?? '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <AdminLayout
      title={snap.name ?? snap.page_id}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Untrack
          </button>
        </div>
      }
    >
      <Link
        href="/admin/watchlist"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Watchlist
      </Link>

      <div className="overflow-hidden rounded-xl border border-border bg-card/60">
        {snap.cover_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={snap.cover_url}
            alt=""
            className="h-48 w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-48 w-full bg-gradient-to-br from-muted to-card" />
        )}
        <div className="px-6 pb-6 pt-2">
          <div className="-mt-16 mb-4 flex items-end gap-4">
            {snap.picture_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={snap.picture_url}
                alt=""
                width={120}
                height={120}
                className="h-28 w-28 rounded-full border-4 border-card object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-28 w-28 rounded-full border-4 border-card bg-muted" />
            )}
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold">
                  {snap.name ?? snap.page_id}
                </h1>
                {snap.is_verified && (
                  <BadgeCheck className="h-5 w-5 text-mint" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {snap.username && <span>@{snap.username}</span>}
                {snap.category && <span>· {snap.category}</span>}
                {snap.link && (
                  <a
                    href={snap.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    facebook.com
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
            <Kpi label="Fans" value={fans} />
            <Kpi label="Followers" value={followers ?? snap.followers_count} />
            <Kpi label="Talking about" value={snap.talking_about_count} />
            <Kpi label="Were here" value={snap.were_here_count} />
          </div>

          {snap.about && (
            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {snap.about}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <DetailSection title="About">
          <Field label="Description" value={snap.description} />
          <Field label="Bio" value={snap.bio} />
          <Field label="Mission" value={snap.mission} />
          <Field label="Company overview" value={snap.company_overview} />
          <Field label="Products" value={snap.products} />
          <Field label="Founded" value={snap.founded} />
          <Field label="Price range" value={snap.price_range} />
          {typeof snap.overall_star_rating === 'number' && (
            <Field
              label="Rating"
              value={`${snap.overall_star_rating.toFixed(1)} ★ (${fmtNumber(snap.rating_count ?? 0)})`}
            />
          )}
          <Field
            label="Categories"
            value={
              snap.category_list?.length
                ? snap.category_list.map((c) => c.name).join(', ')
                : null
            }
          />
          <Field
            label="Parent page"
            value={snap.parent_page ? snap.parent_page.name : null}
          />
        </DetailSection>

        <DetailSection title="Contact">
          {loc && (
            <div className="mb-3 flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm">{loc}</span>
            </div>
          )}
          <Field label="Phone" value={snap.phone} />
          <Field
            label="Website"
            value={
              snap.website ? (
                <a
                  href={
                    snap.website.startsWith('http') ? snap.website : `https://${snap.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {snap.website}
                </a>
              ) : null
            }
          />
          <Field
            label="Emails"
            value={snap.emails?.length ? snap.emails.join(', ') : null}
          />
        </DetailSection>

        <DetailSection title="Capture">
          <Field
            label="Tracked"
            value={
              snap.tracked_at ? (
                <RelativeTime value={snap.tracked_at} />
              ) : null
            }
          />
          <Field
            label="Captured"
            value={
              snap.captured_at ? (
                <RelativeTime value={snap.captured_at} />
              ) : null
            }
          />
          <Field
            label="Verification"
            value={snap.verification_status}
          />
          <Field label="Page id" value={<code>{snap.page_id}</code>} />
        </DetailSection>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent posts · {snap.recent_posts.length}
        </h2>
        {snap.recent_posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            This Page hasn&apos;t exposed posts via PPCA, or has none.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {snap.recent_posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function Kpi({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">
        {typeof value === 'number' ? fmtNumber(value) : '—'}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null | undefined;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-0.5 break-words">{value}</div>
    </div>
  );
}

function PostCard({ post }: { post: PublicPagePost }) {
  return (
    <a
      href={post.permalink_url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-xl border border-border bg-card/60 transition hover:border-foreground/30"
    >
      {post.full_picture && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.full_picture}
          alt=""
          className="aspect-video w-full object-cover"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="p-4">
        {post.created_time && (
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <RelativeTime value={post.created_time} />
          </div>
        )}
        <p className="mb-3 line-clamp-3 text-sm">
          {post.message ?? post.story ?? '(no caption)'}
        </p>
        <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            {fmtNumber(post.reactions_total)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {fmtNumber(post.comments_total)}
          </span>
          {post.shares_total > 0 && (
            <span className="inline-flex items-center gap-1">
              <Repeat2 className="h-3.5 w-3.5" />
              {fmtNumber(post.shares_total)}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
