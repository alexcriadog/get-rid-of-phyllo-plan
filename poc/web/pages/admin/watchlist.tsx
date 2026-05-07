// Global FB Watchlist — search any public Page, track it, see summary
// cards. Backed by /admin/watchlist (PPCA, app token).
//
// Search has a 300ms debounce and queries /admin/watchlist/search?q=…
// Track posts to /admin/watchlist with body { page: <id|username|url> }.
// Each card links to /admin/watchlist/[pageId] for full detail.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminDelete, adminPost, CONNECTOR_API_URL } from '../../lib/api';
import { fmtNumber } from '../../lib/format';

interface SearchHit {
  id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  verification_status: string | null;
  is_verified: boolean | null;
  fan_count: number | null;
  followers_count: number | null;
  link: string | null;
  picture_url: string | null;
  already_tracked: boolean;
}

interface WatchedPage {
  page_id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  about: string | null;
  description: string | null;
  link: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fan_count: number | null;
  followers_count: number | null;
  talking_about_count: number | null;
  verification_status: string | null;
  is_verified: boolean | null;
  location: { city?: string; country?: string } | null;
  recent_posts: Array<{ id: string }>;
  captured_at: string | null;
  tracked_at: string | null;
}

export default function Watchlist() {
  const live = useLive<{ items?: WatchedPage[] } | WatchedPage[]>(
    '/admin/watchlist',
    5000,
  );
  const items = useMemo<WatchedPage[]>(() => {
    const d = live.data;
    if (!d) return [];
    return Array.isArray(d) ? d : (d.items ?? []);
  }, [live.data]);

  return (
    <AdminLayout title="Watchlist">
      <SearchPanel onTracked={() => live.refresh?.()} />
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tracked pages · {items.length}
        </h2>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Nothing tracked yet. Use the search bar above to find a Facebook
            Page and click <em>Track</em>.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <PageCard
                key={p.page_id}
                page={p}
                onChanged={() => live.refresh?.()}
              />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// ─── Search panel ────────────────────────────────────────────────────────

function SearchPanel({ onTracked }: { onTracked: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${CONNECTOR_API_URL}/admin/watchlist/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as { items?: SearchHit[] };
        setHits(body.items ?? []);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q]);

  const onTrack = async (id: string) => {
    try {
      await adminPost('/admin/watchlist', { page: id });
      onTracked();
      setHits((cur) =>
        (cur ?? []).map((h) =>
          h.id === id ? { ...h, already_tracked: true } : h,
        ),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any Facebook Page (e.g. Nike, BBC, …)"
            className="h-10 w-full rounded-md border border-border bg-background pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {err && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {hits && hits.length > 0 && (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border">
          {hits.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-3 bg-background/50 px-3 py-2"
            >
              {h.picture_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={h.picture_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {h.name ?? h.id}
                  </span>
                  {h.is_verified && (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-mint" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {h.username && <span>@{h.username}</span>}
                  {h.category && <span>· {h.category}</span>}
                  {typeof h.fan_count === 'number' && h.fan_count > 0 && (
                    <span>· {fmtNumber(h.fan_count)} fans</span>
                  )}
                </div>
              </div>
              {h.already_tracked ? (
                <span className="shrink-0 rounded-full border border-mint/40 px-3 py-1 text-xs text-mint">
                  Tracked
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onTrack(h.id)}
                  className="shrink-0 rounded-full border border-border bg-foreground px-3 py-1 text-xs font-medium text-background transition hover:opacity-80"
                >
                  Track
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {hits && hits.length === 0 && q.trim().length >= 2 && !loading && (
        <div className="mt-4 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No matches for <em>{q}</em>.
        </div>
      )}
    </div>
  );
}

// ─── Page card ───────────────────────────────────────────────────────────

function PageCard({
  page,
  onChanged,
}: {
  page: WatchedPage;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);

  const refresh = async () => {
    setBusy('refresh');
    try {
      await adminPost(`/admin/watchlist/${page.page_id}/refresh`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Untrack ${page.name ?? page.page_id}?`)) return;
    setBusy('remove');
    try {
      await adminDelete(`/admin/watchlist/${page.page_id}`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const fans =
    typeof page.fan_count === 'number' ? page.fan_count : page.followers_count;
  const followers =
    typeof page.followers_count === 'number' && page.followers_count !== fans
      ? page.followers_count
      : null;
  const loc = page.location
    ? [page.location.city, page.location.country].filter(Boolean).join(', ')
    : '';

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/60">
      {page.cover_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={page.cover_url}
          alt=""
          className="h-28 w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-28 w-full bg-gradient-to-br from-muted to-card" />
      )}
      <div className="p-5">
        <div className="-mt-12 mb-3 flex items-end gap-3">
          {page.picture_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={page.picture_url}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 rounded-full border-4 border-card object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-16 w-16 rounded-full border-4 border-card bg-muted" />
          )}
          <div className="min-w-0 flex-1 pb-1">
            <Link
              href={`/admin/watchlist/${page.page_id}`}
              className="flex items-center gap-1.5 truncate text-base font-semibold hover:underline"
            >
              {page.name ?? page.page_id}
              {page.is_verified && (
                <BadgeCheck className="h-4 w-4 shrink-0 text-mint" />
              )}
            </Link>
            <div className="truncate text-xs text-muted-foreground">
              {page.username ? `@${page.username}` : page.page_id}
              {page.category && <span> · {page.category}</span>}
            </div>
          </div>
        </div>

        {page.about && (
          <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
            {page.about}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
          <Stat label="Fans" value={fans} />
          <Stat label="Followers" value={followers} />
          <Stat label="Talking" value={page.talking_about_count} />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <UsersIcon className="h-3.5 w-3.5" />
            <span>{loc || '—'}</span>
          </div>
          <div className="flex items-center gap-1">
            {page.link && (
              <a
                href={page.link}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="Open on Facebook"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={!!busy}
              title="Re-snapshot"
              className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={!!busy}
              title="Untrack"
              className="rounded p-1.5 text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div className="text-base font-semibold tabular-nums">
        {typeof value === 'number' ? fmtNumber(value) : '—'}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
