import {
  decodeBigIntCursor,
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
  envelopeStatic,
  paginate,
  parseLimit,
} from '../cursor';

describe('encode/decodeCursor', () => {
  it('round-trips a plain string', () => {
    const c = encodeCursor('hello');
    expect(decodeCursor(c)).toBe('hello');
  });
  it('round-trips a bigint via String()', () => {
    const c = encodeCursor(BigInt('4210'));
    expect(decodeCursor(c)).toBe('4210');
  });
  it('returns null for empty / undefined / malformed', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});

describe('decodeBigIntCursor', () => {
  it('parses a valid encoded bigint', () => {
    expect(decodeBigIntCursor(encodeCursor(42n))).toBe(42n);
  });
  it('rejects non-digit payloads', () => {
    expect(decodeBigIntCursor(encodeCursor('abc'))).toBeNull();
    expect(decodeBigIntCursor(encodeCursor('1.5'))).toBeNull();
    expect(decodeBigIntCursor(encodeCursor('-5'))).toBeNull();
  });
  it('returns null on missing cursor', () => {
    expect(decodeBigIntCursor(undefined)).toBeNull();
  });
});

describe('encode/decodeCompositeCursor', () => {
  it('round-trips a date + id pair', () => {
    const d = new Date('2026-05-28T13:45:00.000Z');
    const c = encodeCompositeCursor(d, 'cm123abc');
    const back = decodeCompositeCursor(c);
    expect(back?.timestamp.toISOString()).toBe(d.toISOString());
    expect(back?.id).toBe('cm123abc');
  });
  it('rejects payloads without a separator', () => {
    expect(decodeCompositeCursor(encodeCursor('justatimestamp'))).toBeNull();
  });
  it('rejects payloads with an invalid timestamp', () => {
    expect(decodeCompositeCursor(encodeCursor('not-a-date|cm123'))).toBeNull();
  });
});

describe('parseLimit', () => {
  it('uses the fallback when missing / empty / non-numeric', () => {
    expect(parseLimit(undefined, 100, 1, 500)).toBe(100);
    expect(parseLimit('', 100, 1, 500)).toBe(100);
    expect(parseLimit('abc', 100, 1, 500)).toBe(100);
  });
  it('clamps to the [min,max] range', () => {
    expect(parseLimit('0', 100, 1, 500)).toBe(1);
    expect(parseLimit('999', 100, 1, 500)).toBe(500);
    expect(parseLimit('25', 100, 1, 500)).toBe(25);
  });
});

describe('paginate', () => {
  it('detects has_more by fetching limit+1', async () => {
    const result = await paginate(
      3,
      async (take) => {
        expect(take).toBe(4);
        return [{ id: 5n }, { id: 4n }, { id: 3n }, { id: 2n }];
      },
      (r) => ({ id: r.id.toString() }),
      (r) => encodeCursor(r.id),
    );
    expect(result.data).toEqual([{ id: '5' }, { id: '4' }, { id: '3' }]);
    expect(result.meta.count).toBe(3);
    expect(result.meta.has_more).toBe(true);
    expect(decodeCursor(result.meta.next_cursor)).toBe('3');
  });

  it('returns next_cursor=null on the last page', async () => {
    const result = await paginate(
      10,
      async () => [{ id: 1n }, { id: 2n }],
      (r) => ({ id: r.id.toString() }),
      (r) => encodeCursor(r.id),
    );
    expect(result.meta.has_more).toBe(false);
    expect(result.meta.next_cursor).toBeNull();
    expect(result.meta.count).toBe(2);
  });

  it('handles an empty result', async () => {
    const result = await paginate(
      10,
      async () => [],
      (r: { id: bigint }) => ({ id: r.id.toString() }),
      (r) => encodeCursor(r.id),
    );
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ count: 0, has_more: false, next_cursor: null });
  });
});

describe('envelopeStatic', () => {
  it('wraps a list without pagination metadata', () => {
    expect(envelopeStatic(['a', 'b', 'c'])).toEqual({
      data: ['a', 'b', 'c'],
      meta: { count: 3, has_more: false, next_cursor: null },
    });
  });
  it('handles empty input', () => {
    expect(envelopeStatic([])).toEqual({
      data: [],
      meta: { count: 0, has_more: false, next_cursor: null },
    });
  });
});
