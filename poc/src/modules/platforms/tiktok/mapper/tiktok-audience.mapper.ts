// TikTok audience demographics mapper. v1.3 flow.

import type {
  AudienceActivityBucket,
  DailySeriesPoint,
  DistributionBucket,
} from '../../shared/platform-types';
import type {
  TikTokAccountDailyMetric,
  TikTokAudienceBucket,
  TikTokBusinessAccount,
} from '../../shared/tiktok-api';

/**
 * /business/get/ returns demographics as `[{country|city|gender|age, percentage}]`.
 * Percentages arrive as fractions (0..1). We pass them through untouched so
 * the rest of the pipeline (UI, exports) renders them with one consistent
 * formatter. Empty arrays here usually mean "TikTok refused — account
 * below the 100-follower demographics threshold".
 */
function bucketsFromAudience(
  raw: TikTokAudienceBucket[] | undefined,
  pickLabel: (b: TikTokAudienceBucket) => string | undefined,
): DistributionBucket[] {
  return (raw ?? [])
    .filter((b) => typeof b.percentage === 'number' && pickLabel(b) != null)
    .map((b) => ({
      label: pickLabel(b) as string,
      value: b.percentage,
      unit: 'percent' as const,
    }));
}

export function parseAudienceCountries(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return bucketsFromAudience(account.audience_countries, (b) => b.country);
}

export function parseAudienceCities(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return bucketsFromAudience(account.audience_cities, (b) => b.city);
}

export function parseAudienceGenders(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return bucketsFromAudience(account.audience_genders, (b) => b.gender);
}

export function parseAudienceAges(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return bucketsFromAudience(account.audience_ages, (b) => b.age);
}

/**
 * 24-hour activity heatmap. TikTok returns one entry per day; we sum across
 * the period so callers get a single 24-bucket histogram. `hour` arrives as
 * a numeric string ("0".."23") — coerced to number here.
 */
export function parseAudienceActivity(
  account: TikTokBusinessAccount,
): AudienceActivityBucket[] {
  const totals = new Map<number, number>();
  for (const day of account.metrics ?? []) {
    for (const entry of day.audience_activity ?? []) {
      const hour = Number(entry.hour);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
      totals.set(hour, (totals.get(hour) ?? 0) + (entry.count ?? 0));
    }
  }
  // Always emit 24 buckets (zero-fill) so the UI can render a stable axis.
  const out: AudienceActivityBucket[] = [];
  for (let h = 0; h < 24; h++) out.push({ hour: h, count: totals.get(h) ?? 0 });
  return out;
}

/**
 * Project one numeric field out of `metrics[]` into a daily series. Skips
 * days where the field is missing — the UI will render gaps as gaps.
 */
export function extractDailySeries(
  metrics: TikTokAccountDailyMetric[] | undefined,
  pick: (m: TikTokAccountDailyMetric) => number | undefined,
): DailySeriesPoint[] {
  return (metrics ?? [])
    .filter((m) => typeof pick(m) === 'number' && m.date)
    .map((m) => ({ endTime: m.date, value: pick(m) as number }));
}
