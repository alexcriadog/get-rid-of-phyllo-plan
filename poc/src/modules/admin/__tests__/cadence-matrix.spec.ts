import {
  buildCadenceMatrix,
  supportedProductsForAdapter,
  type CadenceRowLike,
} from '../cadence-matrix';
import { DEFAULT_FALLBACK_SECONDS } from '@modules/sync/cadence.service';
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  DEFAULT_REFRESH_WINDOW_DAYS,
} from '@modules/outbound-webhooks/refresh-cadence.service';

// Synthetic adapters — only the capability flags the matrix inspects.
const threads = { fetchMentions: () => undefined }; // identity/audience/engagement_new + mentions
const facebook = {
  fetchStories: () => undefined,
  fetchComments: () => undefined,
}; // + stories, comments, and fb-only ratings/ads

describe('supportedProductsForAdapter', () => {
  it('always includes the universal products', () => {
    expect(supportedProductsForAdapter('threads', {})).toEqual([
      'identity',
      'audience',
      'engagement_new',
    ]);
  });

  it('adds capability-gated products when the adapter supports them', () => {
    expect(supportedProductsForAdapter('threads', threads)).toContain(
      'mentions',
    );
    expect(supportedProductsForAdapter('instagram', facebook)).toEqual(
      expect.arrayContaining(['stories', 'comments']),
    );
  });

  it('adds ratings + ads only for facebook', () => {
    expect(supportedProductsForAdapter('facebook', facebook)).toEqual(
      expect.arrayContaining(['ratings', 'ads']),
    );
    expect(supportedProductsForAdapter('instagram', facebook)).not.toContain(
      'ads',
    );
  });
});

describe('buildCadenceMatrix', () => {
  const adapters = { threads, facebook };

  it('surfaces unconfigured combos at the effective fallback cadence', () => {
    const items = buildCadenceMatrix(adapters, []);
    const row = items.find(
      (i) => i.platform === 'threads' && i.product === 'engagement_new',
    )!;

    expect(row.default_interval_seconds).toBe(DEFAULT_FALLBACK_SECONDS);
    expect(row.refresh_interval_seconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
    expect(row.refresh_window_days).toBe(DEFAULT_REFRESH_WINDOW_DAYS);
    expect(row.sync_configured).toBe(false);
    expect(row.refresh_configured).toBe(false);
    expect(row.updated_at).toBeNull();
  });

  it('overlays a persisted row and marks it configured', () => {
    const updatedAt = new Date('2026-06-16T08:00:00.000Z');
    const rows: CadenceRowLike[] = [
      {
        platform: 'threads',
        product: 'engagement_new',
        defaultIntervalSeconds: 900,
        refreshIntervalSeconds: 300,
        refreshWindowDays: 30,
        updatedAt,
      },
    ];
    const items = buildCadenceMatrix(adapters, rows);
    const row = items.find(
      (i) => i.platform === 'threads' && i.product === 'engagement_new',
    )!;

    expect(row.default_interval_seconds).toBe(900);
    expect(row.refresh_interval_seconds).toBe(300);
    expect(row.refresh_window_days).toBe(30);
    expect(row.sync_configured).toBe(true);
    expect(row.refresh_configured).toBe(true);
    expect(row.updated_at).toBe(updatedAt.toISOString());
  });

  it('treats a sync-only row as refresh-unconfigured (falls back)', () => {
    const rows: CadenceRowLike[] = [
      {
        platform: 'threads',
        product: 'identity',
        defaultIntervalSeconds: 3600,
        refreshIntervalSeconds: null,
        refreshWindowDays: null,
        updatedAt: new Date('2026-06-16T08:00:00.000Z'),
      },
    ];
    const row = buildCadenceMatrix(adapters, rows).find(
      (i) => i.platform === 'threads' && i.product === 'identity',
    )!;

    expect(row.sync_configured).toBe(true);
    expect(row.default_interval_seconds).toBe(3600);
    expect(row.refresh_configured).toBe(false);
    expect(row.refresh_interval_seconds).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
  });

  it('returns rows sorted by platform then product', () => {
    const items = buildCadenceMatrix(adapters, []);
    const ordered = [...items].sort(
      (a, b) =>
        a.platform.localeCompare(b.platform) ||
        a.product.localeCompare(b.product),
    );
    expect(items).toEqual(ordered);
    // facebook sorts before threads.
    expect(items[0].platform).toBe('facebook');
  });
});
