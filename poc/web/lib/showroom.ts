export interface AccountRow {
  id: string;
  platform: string;
  handle?: string | null;
  connected_at?: string;
}

export interface ShowroomCard {
  id: string;
  platform: string;
  handle: string | null;
  name: string | null;
  biography: string | null;
  avatarUrl: string | null;
  verified: boolean | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  topCountry: { country: string; pct: number } | null;
  topCity: { city: string; value: number } | null;
  updatedAt: string | null;
}

// connected_at is compared as a raw string, which is correct only because the
// connector emits ISO-8601 UTC (…Z) uniformly. The cursor is a COMPOSITE
// `${connected_at}|${id}` so rows sharing a timestamp are still totally ordered
// and never dropped or duplicated across a page boundary.
function ts(row: AccountRow): string {
  return row.connected_at ?? '';
}
function keyOf(row: AccountRow): [string, string] {
  return [ts(row), String(row.id)];
}
/** True when key `a` sorts strictly AFTER key `b` in descending order. */
function isAfter(a: [string, string], b: [string, string]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  return a[1] < b[1];
}
function parseCursor(cursor: string): [string, string] {
  const i = cursor.indexOf('|');
  return i === -1 ? [cursor, ''] : [cursor.slice(0, i), cursor.slice(i + 1)];
}

/**
 * Pure selection: filter by handle substring, sort most-recent first (with an
 * id tiebreaker), then keyset-paginate on the composite (connected_at, id)
 * cursor. Keeps the expensive Mongo join bounded to the returned page (the
 * loader queries profiles/audience with $in on these ids only — the Mongo side
 * is never a full-collection scan).
 */
export function selectPage(
  rows: AccountRow[],
  opts: { search?: string; limit: number; cursor?: string },
): { page: AccountRow[]; nextCursor: string | null } {
  const search = (opts.search ?? '').trim().toLowerCase();
  let filtered = rows;
  if (search) {
    filtered = rows.filter((r) =>
      (r.handle ?? '').toLowerCase().includes(search),
    );
  }
  const sorted = [...filtered].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? 1 : -1;
    return ka[1] < kb[1] ? 1 : ka[1] > kb[1] ? -1 : 0;
  });
  const afterCursor = opts.cursor
    ? sorted.filter((r) => isAfter(keyOf(r), parseCursor(opts.cursor!)))
    : sorted;
  const page = afterCursor.slice(0, opts.limit);
  const last = page[page.length - 1];
  const nextCursor =
    afterCursor.length > opts.limit && last ? `${ts(last)}|${String(last.id)}` : null;
  return { page, nextCursor };
}
