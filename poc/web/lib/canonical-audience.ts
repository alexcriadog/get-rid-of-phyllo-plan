/**
 * Canonical `audience` → the account page's AudienceData shape.
 *
 * Sibling of canonical-content.ts, same job: reverse the poc data-schema
 * mappers back into the camelCase shape the components expect, so the pages
 * can read the live canonical store without rewriting their render code.
 *
 * Unit note: unlike canonical-content.ts, values here are NOT rescaled. The
 * demographics panels re-normalize each bucket against the sum of its
 * distribution, so the canonical 0..100 percentages pass through unchanged —
 * which is what the page's inline mapping already did.
 *
 * Everything past the four follower-level distributions is only-when-present
 * (see poc/src/modules/data-schema/api-types.ts §ApiAudience): audiences
 * synced before 2026-07-17 carry none of it, and must degrade to exactly the
 * old shape rather than rendering empty panels.
 */

export type Distribution = Array<{ label: string; value: number }>;

export type DemographicBreakdownError = {
  breakdown: 'age' | 'gender' | 'country' | 'city';
  message: string;
  code?: number;
  subcode?: number;
};

export type DemographicGroup = {
  genderDistribution?: Distribution;
  ageDistribution?: Distribution;
  countryDistribution?: Distribution;
  cityDistribution?: Distribution;
  errors?: DemographicBreakdownError[];
  byTimeframe?: Record<string, DemographicGroup>;
};

export type AccountInsights = {
  periodDays?: number;
  reach?: number;
  // No `impressions`: Meta retired page_impressions on 2025-11-15 and the
  // connector stopped emitting it (see poc api-types.ts §ApiAudience). `views`
  // is the replacement.
  accountsEngaged?: number;
  totalInteractions?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  replies?: number;
  views?: number;
  profileViews?: number;
  websiteClicks?: number;
  emailContacts?: number;
  phoneCallClicks?: number;
  textMessageClicks?: number;
  getDirectionsClicks?: number;
  lifetimeLikes?: number;
  videosCount?: number;
  followerCountSeries?: Array<{ endTime: string; value: number }>;
  newFollowersSeries?: Array<{ endTime: string; value: number }>;
  lostFollowersSeries?: Array<{ endTime: string; value: number }>;
  videoViewsSeries?: Array<{ endTime: string; value: number }>;
  uniqueVideoViewsSeries?: Array<{ endTime: string; value: number }>;
  profileViewsSeries?: Array<{ endTime: string; value: number }>;
  likesSeries?: Array<{ endTime: string; value: number }>;
  commentsSeries?: Array<{ endTime: string; value: number }>;
  sharesSeries?: Array<{ endTime: string; value: number }>;
  engagedAudienceSeries?: Array<{ endTime: string; value: number }>;
  audienceActivity?: Array<{ hour: number; count: number }>;
  audienceActivityWeekly?: Array<{
    dayOfWeek: number;
    hour: number;
    count: number;
  }>;
  extra?: Record<string, number>;
};

export type AudienceData = DemographicGroup & {
  reachedDemographics?: DemographicGroup;
  engagedDemographics?: DemographicGroup;
  accountInsights?: AccountInsights;
  fetchedAt?: string;
};

export type CanonicalAudienceWrapper = {
  doc?: Record<string, unknown> | null;
  updated_at?: string;
};

type Row = Record<string, unknown>;

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

/** `[{code|name|label, value}]` → `[{label, value}]`, dropping malformed rows. */
function toDistribution(
  v: unknown,
  labelKey: 'code' | 'name' | 'label',
): Distribution {
  return rows(v)
    .map((r) => ({ label: r[labelKey], value: r.value }))
    .filter(
      (r): r is { label: string; value: number } =>
        typeof r.label === 'string' && typeof r.value === 'number',
    );
}

function toSeries(
  v: unknown,
): Array<{ endTime: string; value: number }> | undefined {
  const out = rows(v)
    .map((r) => ({ endTime: r.end_time, value: r.value }))
    .filter(
      (r): r is { endTime: string; value: number } =>
        typeof r.endTime === 'string' && typeof r.value === 'number',
    );
  return out.length > 0 ? out : undefined;
}

/** Emit `{ [key]: dist }` only when the distribution has rows. */
function whenFilled(
  key: string,
  dist: Distribution,
): Record<string, Distribution> {
  return dist.length > 0 ? { [key]: dist } : {};
}

/**
 * One reached/engaged scope → camelCase. Returns undefined when the scope
 * carries nothing, so the page's `hasReached`/`hasEngaged` checks stay honest
 * and the tab remains disabled instead of opening onto an empty panel.
 */
function toGroup(v: unknown): DemographicGroup | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const src = v as Row;

  const byTimeframe: Record<string, DemographicGroup> = {};
  const rawByTf = src.by_timeframe;
  if (rawByTf && typeof rawByTf === 'object' && !Array.isArray(rawByTf)) {
    for (const [window, variant] of Object.entries(rawByTf as Row)) {
      const mapped = toGroup(variant);
      if (mapped) byTimeframe[window] = mapped;
    }
  }

  const errors = rows(src.errors).filter(
    (e) => typeof e.breakdown === 'string' && typeof e.message === 'string',
  ) as unknown as DemographicBreakdownError[];

  const out: DemographicGroup = {
    ...whenFilled(
      'genderDistribution',
      toDistribution(src.gender_distribution, 'label'),
    ),
    ...whenFilled('ageDistribution', toDistribution(src.age_distribution, 'label')),
    ...whenFilled('countryDistribution', toDistribution(src.countries, 'code')),
    ...whenFilled('cityDistribution', toDistribution(src.cities, 'name')),
    ...(errors.length > 0 ? { errors } : {}),
    ...(Object.keys(byTimeframe).length > 0 ? { byTimeframe } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** snake_case scalar → camelCase, in ApiAudienceAccountInsights order. */
const SCALARS: ReadonlyArray<[string, keyof AccountInsights]> = [
  ['period_days', 'periodDays'],
  ['reach', 'reach'],
  ['accounts_engaged', 'accountsEngaged'],
  ['total_interactions', 'totalInteractions'],
  ['likes', 'likes'],
  ['comments', 'comments'],
  ['saves', 'saves'],
  ['shares', 'shares'],
  ['replies', 'replies'],
  ['views', 'views'],
  ['profile_views', 'profileViews'],
  ['website_clicks', 'websiteClicks'],
  ['email_contacts', 'emailContacts'],
  ['phone_call_clicks', 'phoneCallClicks'],
  ['text_message_clicks', 'textMessageClicks'],
  ['get_directions_clicks', 'getDirectionsClicks'],
  ['lifetime_likes', 'lifetimeLikes'],
  ['videos_count', 'videosCount'],
];

const SERIES: ReadonlyArray<[string, keyof AccountInsights]> = [
  ['follower_count_series', 'followerCountSeries'],
  ['new_followers_series', 'newFollowersSeries'],
  ['lost_followers_series', 'lostFollowersSeries'],
  ['video_views_series', 'videoViewsSeries'],
  ['unique_video_views_series', 'uniqueVideoViewsSeries'],
  ['profile_views_series', 'profileViewsSeries'],
  ['likes_series', 'likesSeries'],
  ['comments_series', 'commentsSeries'],
  ['shares_series', 'sharesSeries'],
  ['engaged_audience_series', 'engagedAudienceSeries'],
];

function toAccountInsights(v: unknown): AccountInsights | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const src = v as Row;
  const out: Record<string, unknown> = {};

  for (const [from, to] of SCALARS) {
    const n = num(src[from]);
    if (n !== undefined) out[to] = n;
  }
  for (const [from, to] of SERIES) {
    const s = toSeries(src[from]);
    if (s) out[to] = s;
  }

  const activity = rows(src.audience_activity)
    .map((b) => ({ hour: b.hour, count: b.count }))
    .filter(
      (b): b is { hour: number; count: number } =>
        typeof b.hour === 'number' && typeof b.count === 'number',
    );
  if (activity.length > 0) out.audienceActivity = activity;

  const weekly = rows(src.audience_activity_weekly)
    .map((b) => ({ dayOfWeek: b.day_of_week, hour: b.hour, count: b.count }))
    .filter(
      (b): b is { dayOfWeek: number; hour: number; count: number } =>
        typeof b.dayOfWeek === 'number' &&
        typeof b.hour === 'number' &&
        typeof b.count === 'number',
    );
  if (weekly.length > 0) out.audienceActivityWeekly = weekly;

  const extra = src.extra;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    if (Object.keys(extra).length > 0) out.extra = extra as Record<string, number>;
  }

  return Object.keys(out).length > 0 ? (out as AccountInsights) : undefined;
}

export function canonicalToAudience(
  wrapper: CanonicalAudienceWrapper,
): AudienceData {
  const doc = (wrapper.doc ?? {}) as Row;
  const reached = toGroup(doc.reached_demographics);
  const engaged = toGroup(doc.engaged_demographics);
  const accountInsights = toAccountInsights(doc.account_insights);

  return {
    countryDistribution: toDistribution(doc.countries, 'code'),
    cityDistribution: toDistribution(doc.cities, 'name'),
    genderDistribution: toDistribution(doc.gender_distribution, 'label'),
    ageDistribution: toDistribution(doc.age_distribution, 'label'),
    ...(reached ? { reachedDemographics: reached } : {}),
    ...(engaged ? { engagedDemographics: engaged } : {}),
    ...(accountInsights ? { accountInsights } : {}),
  };
}
