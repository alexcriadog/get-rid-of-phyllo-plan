/**
 * Canonical `contents` → legacy Post shape.
 *
 * The account pages were written against the raw `posts` collection, which
 * the sync worker stopped writing on 2026-06-08 (canonical-only persistence,
 * poc commit 029873b). This adapter lets those pages read the live canonical
 * store (`contents`, InsightIQ-shaped `doc`) without rewriting their render
 * code: it reverses the data-schema mappers back into the camelCase shape
 * the components expect.
 *
 * Unit note: canonical percent values are 0..100 (see poc data-schema
 * buckets.ts); the UI's DistributionBucket/SecondPercentage use 0..1
 * fractions — every percent value here is divided by 100.
 */

export type DistributionBucket = {
  label: string;
  value: number; // fraction 0..1 when unit='percent', absolute count otherwise
  unit?: 'percent' | 'count';
};

export type SecondPercentage = {
  second: number;
  percentage: number; // fraction 0..1
};

export type PostInsights = {
  trafficSources?: DistributionBucket[];
  retentionCurve?: SecondPercentage[];
  likesTimeline?: SecondPercentage[];
  audienceCountries?: DistributionBucket[];
  audienceCities?: DistributionBucket[];
  audienceGenders?: DistributionBucket[];
  audienceTypes?: DistributionBucket[];
};

export type PostChild = {
  id: string;
  mediaType?: string;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  permalink?: string | null;
};

export type PostMetrics = {
  likes?: number;
  comments?: number;
  reach?: number;
  impressions?: number;
  saves?: number;
  shares?: number;
  views?: number;
  extra?: Record<string, number>;
};

export type PostData = {
  platformContentId?: string;
  contentType?: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrls?: string[];
  thumbnailUrl?: string | null;
  embedUrl?: string | null;
  metrics?: PostMetrics;
  insights?: PostInsights;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  children?: PostChild[];
  ownerHandle?: string | null;
};

export type Post = {
  account_id: string;
  platform: string;
  platform_content_id: string;
  data?: PostData;
  updated_at?: string;
  created_at?: string;
};

/** Subset of the canonical wrapper + ApiContent doc this adapter consumes. */
export type CanonicalContentWrapper = {
  account_pk?: string;
  external_id?: string;
  published_at?: string | Date | null;
  updated_at?: string | Date | null;
  created_at?: string | Date | null;
  doc?: Record<string, unknown>;
};

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const iso = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
};

/** Canonical 0..100 percent → UI 0..1 fraction bucket. */
function percentBuckets(arr: unknown, labelKey: string): DistributionBucket[] {
  if (!Array.isArray(arr)) return [];
  const out: DistributionBucket[] = [];
  for (const raw of arr) {
    const b = raw as Record<string, unknown>;
    const label = str(b[labelKey]) ?? str(b.label);
    const value = num(b.value);
    if (label === undefined || value === undefined) continue;
    out.push({ label, value: value / 100, unit: 'percent' });
  }
  return out;
}

function secondCurve(arr: unknown): SecondPercentage[] {
  if (!Array.isArray(arr)) return [];
  const out: SecondPercentage[] = [];
  for (const raw of arr) {
    const p = raw as Record<string, unknown>;
    const second = num(p.second);
    const value = num(p.value);
    if (second === undefined || value === undefined) continue;
    out.push({ second, percentage: value / 100 });
  }
  return out;
}

function trafficBuckets(arr: unknown): DistributionBucket[] {
  if (!Array.isArray(arr)) return [];
  const out: DistributionBucket[] = [];
  for (const raw of arr) {
    const t = raw as Record<string, unknown>;
    const label = str(t.source);
    if (label === undefined) continue;
    const pct = num(t.value);
    if (pct !== undefined) {
      out.push({ label, value: pct / 100, unit: 'percent' });
      continue;
    }
    const views = num(t.views);
    if (views !== undefined) out.push({ label, value: views, unit: 'count' });
  }
  return out;
}

function docToInsights(doc: Record<string, unknown>): PostInsights | undefined {
  const ins = (doc.insights ?? {}) as Record<string, unknown>;
  const aud = (doc.audience ?? {}) as Record<string, unknown>;
  const audienceTypes = percentBuckets(aud.audience_types, 'label');
  const insights: PostInsights = {
    trafficSources: trafficBuckets(ins.traffic_sources),
    retentionCurve: secondCurve(ins.retention_curve),
    likesTimeline: secondCurve(ins.likes_timeline),
    audienceCountries: percentBuckets(aud.countries, 'code'),
    audienceCities: percentBuckets(aud.cities, 'name'),
    audienceGenders: percentBuckets(aud.gender_distribution, 'label'),
    // viewer_types mirrors audience_types on TikTok; fall back to it when
    // the audience block is absent (e.g. YouTube deep-only docs).
    audienceTypes:
      audienceTypes.length > 0
        ? audienceTypes
        : percentBuckets(ins.viewer_types, 'label'),
  };
  const hasAny = Object.values(insights).some(
    (v) => Array.isArray(v) && v.length > 0,
  );
  return hasAny ? insights : undefined;
}

function docToMetrics(doc: Record<string, unknown>): PostMetrics {
  const eng = (doc.engagement ?? {}) as Record<string, unknown>;
  const metrics: PostMetrics = {};
  const base: Array<[keyof PostMetrics & string, string]> = [
    ['likes', 'like_count'],
    ['comments', 'comment_count'],
    ['shares', 'share_count'],
    ['saves', 'save_count'],
    ['views', 'view_count'],
    ['reach', 'reach_organic_count'],
    ['impressions', 'impression_organic_count'],
  ];
  for (const [out, key] of base) {
    const v = num(eng[key]);
    if (v !== undefined) (metrics as Record<string, number | undefined>)[out] = v;
  }
  const extra: Record<string, number> = {};
  const extraScalars: Array<[string, string]> = [
    ['watch_time_in_hours', 'watch_time_in_hours'],
    ['avg_watch_time_in_sec', 'avg_watch_time_in_sec'],
    ['clicks', 'click_count'],
    ['reposts', 'repost_count'],
    ['replays', 'replay_count'],
  ];
  for (const [out, key] of extraScalars) {
    const v = num(eng[key]);
    if (v !== undefined) extra[out] = v;
  }
  const additional = eng.additional_info;
  if (additional && typeof additional === 'object') {
    for (const [k, v] of Object.entries(
      additional as Record<string, unknown>,
    )) {
      const n = num(v);
      if (n !== undefined) extra[k] = n;
    }
  }
  if (Object.keys(extra).length > 0) metrics.extra = extra;
  return metrics;
}

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

function docToChildren(
  externalId: string,
  doc: Record<string, unknown>,
): PostChild[] | undefined {
  const urls = Array.isArray(doc.media_urls)
    ? (doc.media_urls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      )
    : [];
  if (urls.length <= 1) return undefined;
  return urls.map((mediaUrl, i) => ({
    id: `${externalId}-${i}`,
    mediaUrl,
    mediaType: VIDEO_EXT_RE.test(mediaUrl) ? 'video' : 'image',
  }));
}

export function platformOfDoc(
  doc: Record<string, unknown> | undefined,
): string {
  const wp = (doc?.work_platform ?? {}) as Record<string, unknown>;
  return String(wp.name ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Canonical wrapper → the Post shape the account pages render. */
export function canonicalToPost(
  wrapper: CanonicalContentWrapper,
  accountId: string,
  fallbackPlatform?: string | null,
): Post {
  const doc = (wrapper.doc ?? {}) as Record<string, unknown>;
  const externalId = String(wrapper.external_id ?? doc.external_id ?? '');
  const mediaUrl = str(doc.media_url);
  const mediaUrls =
    Array.isArray(doc.media_urls) && doc.media_urls.length > 0
      ? (doc.media_urls as unknown[]).filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        )
      : mediaUrl
        ? [mediaUrl]
        : [];
  return {
    account_id: accountId,
    platform: platformOfDoc(doc) || (fallbackPlatform ?? ''),
    platform_content_id: externalId,
    updated_at: iso(wrapper.updated_at) ?? undefined,
    created_at: iso(wrapper.created_at) ?? undefined,
    data: {
      platformContentId: externalId,
      contentType: String(doc.type ?? '').toLowerCase() || undefined,
      caption:
        (doc.description as string | null | undefined) ??
        (doc.title as string | null | undefined) ??
        null,
      permalink: (doc.url as string | null | undefined) ?? null,
      mediaUrls,
      thumbnailUrl:
        str(doc.persistent_thumbnail_url) ?? str(doc.thumbnail_url) ?? null,
      embedUrl: str(doc.embed_url) ?? null,
      metrics: docToMetrics(doc),
      insights: docToInsights(doc),
      publishedAt: iso(wrapper.published_at) ?? iso(doc.published_at),
      children: docToChildren(externalId, doc),
      ownerHandle: str(doc.owner_username) ?? null,
    },
  };
}
