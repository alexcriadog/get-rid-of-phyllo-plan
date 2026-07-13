import { getDb } from './mongo';
import { CONNECTOR_API_URL } from './api';
import { selectPage, type AccountRow, type ShowroomCard } from './showroom';

const API_BASE =
  process.env.CONNECTOR_API_URL || CONNECTOR_API_URL || 'http://localhost:3000';
const DEFAULT_LIMIT = 10;

type ProfileDoc = {
  account_pk: string;
  updated_at?: string;
  doc?: {
    platform_username?: string | null;
    username?: string | null;
    full_name?: string | null;
    introduction?: string | null;
    image_url?: string | null;
    is_verified?: boolean | null;
    reputation?: {
      follower_count?: number | null;
      following_count?: number | null;
      content_count?: number | null;
    } | null;
  };
};
type AudienceDoc = {
  account_pk: string;
  doc?: {
    cities?: Array<{ name: string; value: number }>;
    countries?: Array<{ code: string; value: number }>;
  };
};

/**
 * Load a bounded page of showroom cards. Fetches the lightweight account
 * registry from the backend, bounds the page with selectPage, THEN joins
 * profile + audience for that page only via an indexed $in.
 *
 * The Mongo join is bounded to <= `limit` docs — this eliminates the old
 * index.tsx's two full-collection scans (the real cost). The account-registry
 * hop (`/admin/accounts?workspace=`) is still unbounded per workspace and
 * filtered in-process; fine at PoC scale, but add server-side search+limit on
 * that endpoint if a single workspace grows large.
 */
export async function loadShowroomCards(opts: {
  workspace?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ cards: ShowroomCard[]; nextCursor: string | null }> {
  const workspace = (opts.workspace ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 50);

  const url = `${API_BASE}/admin/accounts${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`account registry ${r.status}`);
  const json = (await r.json()) as { items?: AccountRow[] };
  const rows = json.items ?? [];

  const { page, nextCursor } = selectPage(rows, {
    search: opts.search,
    limit,
    cursor: opts.cursor,
  });
  const ids = page.map((p) => String(p.id));
  if (ids.length === 0) return { cards: [], nextCursor: null };

  const profByPk = new Map<string, ProfileDoc>();
  const audByPk = new Map<string, AudienceDoc>();
  try {
    const db = await getDb();
    const [profiles, audience] = await Promise.all([
      db.collection<ProfileDoc>('profiles').find({ account_pk: { $in: ids } }).toArray(),
      db.collection<AudienceDoc>('audience').find({ account_pk: { $in: ids } }).toArray(),
    ]);
    for (const p of profiles) profByPk.set(String(p.account_pk), p);
    for (const a of audience) audByPk.set(String(a.account_pk), a);
  } catch (err) {
    // Degrade: identity from the registry only, no enrichment.
    console.error('[showroom] enrichment failed:', (err as Error).message);
  }

  const cards: ShowroomCard[] = page.map((row) => {
    const id = String(row.id);
    const prof = profByPk.get(id);
    const doc = prof?.doc ?? {};
    const rep = doc.reputation ?? {};
    const aud = audByPk.get(id)?.doc ?? {};
    const countries = aud.countries ?? [];
    const cities = aud.cities ?? [];
    const topCountry = countries.length
      ? (() => {
          const t = [...countries].sort((a, b) => b.value - a.value)[0];
          return { country: t.code, pct: t.value };
        })()
      : null;
    const topCity = cities.length
      ? (() => {
          const t = [...cities].sort((a, b) => b.value - a.value)[0];
          return { city: t.name, value: t.value };
        })()
      : null;
    return {
      id,
      platform: row.platform,
      handle: doc.platform_username ?? doc.username ?? row.handle ?? null,
      name: doc.full_name ?? row.handle ?? null,
      biography: doc.introduction ?? null,
      avatarUrl: doc.image_url ?? null,
      verified: doc.is_verified ?? null,
      followers: rep.follower_count ?? null,
      following: rep.following_count ?? null,
      posts: rep.content_count ?? null,
      topCountry,
      topCity,
      updatedAt: prof?.updated_at ?? row.connected_at ?? null,
    };
  });

  return { cards, nextCursor };
}
