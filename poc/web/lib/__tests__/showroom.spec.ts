import { describe, expect, it } from 'vitest';
import { selectPage, type AccountRow } from '../showroom';

const rows: AccountRow[] = [
  { id: '1', platform: 'instagram', handle: 'alpha', connected_at: '2026-01-03T00:00:00Z' },
  { id: '2', platform: 'tiktok', handle: 'beta', connected_at: '2026-01-05T00:00:00Z' },
  { id: '3', platform: 'youtube', handle: 'AlphaBeta', connected_at: '2026-01-01T00:00:00Z' },
];

describe('selectPage', () => {
  it('sorts most-recent first and honours limit (composite cursor)', () => {
    const { page, nextCursor } = selectPage(rows, { limit: 2 });
    expect(page.map((r) => r.id)).toEqual(['2', '1']);
    expect(nextCursor).toBe('2026-01-03T00:00:00Z|1');
  });

  it('never drops rows that share a timestamp across a page boundary', () => {
    const ties: AccountRow[] = [
      { id: 'a', platform: 'x', handle: 'a', connected_at: '2026-01-05T00:00:00Z' },
      { id: 'b', platform: 'x', handle: 'b', connected_at: '2026-01-05T00:00:00Z' },
      { id: 'c', platform: 'x', handle: 'c', connected_at: '2026-01-05T00:00:00Z' },
    ];
    const p1 = selectPage(ties, { limit: 2 });
    expect(p1.page.map((r) => r.id)).toEqual(['c', 'b']);
    expect(p1.nextCursor).toBe('2026-01-05T00:00:00Z|b');
    const p2 = selectPage(ties, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.page.map((r) => r.id)).toEqual(['a']);
    expect(p2.nextCursor).toBeNull();
    // Union of both pages covers every row — no loss, no duplication.
    expect([...p1.page, ...p2.page].map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('filters by case-insensitive handle substring', () => {
    const { page } = selectPage(rows, { limit: 10, search: 'alpha' });
    expect(page.map((r) => r.id).sort()).toEqual(['1', '3']);
  });
  it('paginates past the cursor', () => {
    const { page } = selectPage(rows, { limit: 10, cursor: '2026-01-05T00:00:00Z' });
    expect(page.map((r) => r.id)).toEqual(['1', '3']);
  });
  it('returns null nextCursor when the page is the last', () => {
    const { nextCursor } = selectPage(rows, { limit: 10 });
    expect(nextCursor).toBeNull();
  });
});
