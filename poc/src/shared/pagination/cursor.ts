// Cursor-based pagination helpers + canonical envelope shape.
//
// Every list-returning endpoint in the API wraps its response in
//   { data: T[], meta: { count, has_more, next_cursor } }
// so clients can iterate large collections deterministically. Cursors are
// opaque base64-url strings so we can change the underlying representation
// (BigInt id vs composite "<isoTimestamp>|<id>") without breaking clients.
//
// Why cursor and not offset?
//   - Offset breaks under concurrent inserts (a new row at position 0
//     shifts every page by one, items appear twice or get skipped).
//   - Cursor on a monotonic field (the PK) is stable: "give me everything
//     older than X" returns the same set regardless of what got inserted
//     since the last page.
//   - Index-friendly: WHERE id < cursor uses the PK index directly.

/**
 * Standard list response envelope. Use for every collection endpoint —
 * even small natural ones (cadences, queues) — so clients see a uniform
 * shape.
 */
export interface Paginated<T> {
  data: T[];
  meta: {
    /** Number of items in `data` (this page only). */
    count: number;
    /** True if more items exist past this page. Use `next_cursor` to fetch them. */
    has_more: boolean;
    /** Opaque token. Pass back as `?cursor=…` to fetch the next page. */
    next_cursor: string | null;
  };
}

export function encodeCursor(value: string | number | bigint): string {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function decodeBigIntCursor(raw: string | null | undefined): bigint | null {
  const decoded = decodeCursor(raw);
  if (decoded === null) return null;
  if (!/^\d+$/.test(decoded)) return null;
  try {
    return BigInt(decoded);
  } catch {
    return null;
  }
}

/**
 * Composite cursor for tables ordered by a timestamp + tiebreaker id.
 * Wire format: "<isoTimestamp>|<id>" (base64-encoded). The pipe is safe
 * because ISO timestamps contain no pipes; id can be any string.
 */
export function encodeCompositeCursor(
  timestamp: Date,
  id: string,
): string {
  return encodeCursor(`${timestamp.toISOString()}|${id}`);
}

export interface CompositeCursorValue {
  timestamp: Date;
  id: string;
}

export function decodeCompositeCursor(
  raw: string | null | undefined,
): CompositeCursorValue | null {
  const decoded = decodeCursor(raw);
  if (decoded === null) return null;
  const sep = decoded.indexOf('|');
  if (sep < 0) return null;
  const ts = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const date = new Date(ts);
  if (Number.isNaN(date.getTime()) || id.length === 0) return null;
  return { timestamp: date, id };
}

/**
 * Parse a positive int query param with a default, min, and max.
 * Re-exported here so endpoints don't have to import from /api separately.
 */
export function parseLimit(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Wrap a findMany-like fetcher and compute the next cursor. The fetcher is
 * called with `take: limit + 1` to detect whether more rows exist past
 * this page without an extra COUNT query.
 *
 * @param limit  Page size requested by the caller (already clamped).
 * @param fetch  Function that runs the findMany. Receives the take value
 *               (`limit + 1`); the caller is responsible for applying the
 *               cursor's `where` clause and the orderBy.
 * @param mapRow Convert a DB row to the public view object.
 * @param cursorOf Compute the next page's cursor from the last row of the
 *                 current page. Pure function; called once per page.
 */
export async function paginate<Row, Out>(
  limit: number,
  fetch: (take: number) => Promise<Row[]>,
  mapRow: (row: Row) => Out,
  cursorOf: (row: Row) => string,
): Promise<Paginated<Out>> {
  const rows = await fetch(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    data: page.map(mapRow),
    meta: {
      count: page.length,
      has_more: hasMore,
      next_cursor: hasMore && page.length > 0 ? cursorOf(page[page.length - 1]) : null,
    },
  };
}

/**
 * Wrap a non-paginated collection (e.g. a small lookup table, or an
 * upstream API call we don't yet plumb a cursor through) in the standard
 * envelope. has_more is always false, next_cursor always null. Use this
 * to keep the response shape consistent across the API even when the
 * underlying source returns a single non-paginatable page.
 */
export function envelopeStatic<T>(items: T[]): Paginated<T> {
  return {
    data: items,
    meta: { count: items.length, has_more: false, next_cursor: null },
  };
}
