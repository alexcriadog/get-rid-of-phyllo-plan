// Bundle of YouTube Analytics reports → canonical AudienceData.
//
// The fetcher fires 6 reports.query calls in parallel:
//   - daily       (dimensions=day, engagement metrics)
//   - demo        (dimensions=ageGroup,gender, viewerPercentage)
//   - geo         (dimensions=country, views/watch_time)
//   - traffic     (dimensions=insightTrafficSourceType, views)
//   - devices     (dimensions=deviceType, views)
//   - monetization(dimensions=day, revenue/cpm/monetizedPlaybacks/adImpressions)
//
// We pivot each row-array using its `columnHeaders[]` order then merge into
// AudienceData. Every report is best-effort: if Promise.allSettled rejected
// any of them (small audience, scope missing, channel not in YPP) the
// fetcher passes `null` and we record a per-bucket error.

import type {
  AccountInsightsData,
  AudienceData,
  DailySeriesPoint,
  DemographicBreakdownError,
  DistributionBucket,
} from '../../shared/platform-types';
import type { YoutubeAnalyticsReport } from '../../shared/youtube-api/youtube-types';

export interface AnalyticsBundle {
  daily: YoutubeAnalyticsReport | null;
  demo: YoutubeAnalyticsReport | null;
  geo: YoutubeAnalyticsReport | null;
  traffic: YoutubeAnalyticsReport | null;
  devices: YoutubeAnalyticsReport | null;
  monetization: YoutubeAnalyticsReport | null;
  errors: DemographicBreakdownError[];
}

export function analyticsToAudience(bundle: AnalyticsBundle): AudienceData {
  const insights: AccountInsightsData = { extra: {} };
  const errors: DemographicBreakdownError[] = [...bundle.errors];

  const genderDistribution: DistributionBucket[] = [];
  const ageDistribution: DistributionBucket[] = [];
  if (bundle.demo) {
    const rows = pivotRows(bundle.demo);
    const genderTotals = new Map<string, number>();
    const ageTotals = new Map<string, number>();
    for (const row of rows) {
      const gender = String(row['gender'] ?? '').toLowerCase();
      const age = stripAgePrefix(String(row['ageGroup'] ?? ''));
      const pct = numericOr0(row['viewerPercentage']);
      if (gender) genderTotals.set(gender, (genderTotals.get(gender) ?? 0) + pct);
      if (age) ageTotals.set(age, (ageTotals.get(age) ?? 0) + pct);
    }
    for (const [label, value] of genderTotals) {
      genderDistribution.push({ label: normalizeGender(label), value, unit: 'percent' });
    }
    for (const [label, value] of ageTotals) {
      ageDistribution.push({ label, value, unit: 'percent' });
    }
  } else {
    errors.push({ breakdown: 'age', message: 'analytics demo bucket missing' });
    errors.push({ breakdown: 'gender', message: 'analytics demo bucket missing' });
  }

  const countryDistribution: DistributionBucket[] = [];
  if (bundle.geo) {
    for (const row of pivotRows(bundle.geo)) {
      const country = String(row['country'] ?? '').toUpperCase();
      const views = numericOr0(row['views']);
      if (country) countryDistribution.push({ label: country, value: views, unit: 'count' });
    }
  } else {
    errors.push({ breakdown: 'country', message: 'analytics geo bucket missing' });
  }

  if (bundle.daily) {
    const series = pivotRows(bundle.daily);
    insights.periodDays = series.length || undefined;
    insights.newFollowersSeries = collectSeries(series, 'subscribersGained');
    insights.lostFollowersSeries = collectSeries(series, 'subscribersLost');
    insights.videoViewsSeries = collectSeries(series, 'views');
    insights.likesSeries = collectSeries(series, 'likes');
    insights.commentsSeries = collectSeries(series, 'comments');
    insights.sharesSeries = collectSeries(series, 'shares');

    insights.views = sumSeries(insights.videoViewsSeries);
    insights.likes = sumSeries(insights.likesSeries);
    insights.comments = sumSeries(insights.commentsSeries);
    insights.shares = sumSeries(insights.sharesSeries);
    const watch = sumColumn(series, 'estimatedMinutesWatched');
    if (watch != null) insights.extra!['watchTimeMinutes'] = watch;
    const avgDur = avgColumn(series, 'averageViewDuration');
    if (avgDur != null) insights.extra!['averageViewDurationSeconds'] = avgDur;
  }

  if (bundle.traffic) {
    for (const row of pivotRows(bundle.traffic)) {
      const src = String(row['insightTrafficSourceType'] ?? 'UNKNOWN');
      insights.extra![`trafficSource_${src}`] = numericOr0(row['views']);
    }
  }

  if (bundle.devices) {
    for (const row of pivotRows(bundle.devices)) {
      const dev = String(row['deviceType'] ?? 'UNKNOWN');
      insights.extra![`device_${dev}`] = numericOr0(row['views']);
    }
  }

  if (bundle.monetization) {
    let totalRevenue = 0;
    let totalMonetizedPlaybacks = 0;
    let totalAdImpressions = 0;
    let cpmCount = 0;
    let cpmSum = 0;
    for (const row of pivotRows(bundle.monetization)) {
      totalRevenue += numericOr0(row['estimatedRevenue']);
      totalMonetizedPlaybacks += numericOr0(row['monetizedPlaybacks']);
      totalAdImpressions += numericOr0(row['adImpressions']);
      const cpm = numericOr0(row['cpm']);
      if (cpm > 0) {
        cpmSum += cpm;
        cpmCount += 1;
      }
    }
    insights.extra!['estimatedRevenue'] = totalRevenue;
    insights.extra!['monetizedPlaybacks'] = totalMonetizedPlaybacks;
    insights.extra!['adImpressions'] = totalAdImpressions;
    if (cpmCount > 0) insights.extra!['averageCpm'] = cpmSum / cpmCount;
  }

  // AudienceData has no top-level `errors` field — per-breakdown errors live
  // inside reachedDemographics/engagedDemographics. We surface ours via the
  // engagedDemographics envelope (the YouTube fetcher doesn't otherwise
  // populate it) so the admin UI's "missing data" panel keeps working.
  const engaged =
    errors.length > 0
      ? { errors: errors.length > 0 ? errors : undefined }
      : undefined;

  return {
    genderDistribution,
    ageDistribution,
    countryDistribution,
    cityDistribution: [],
    engagedDemographics: engaged,
    accountInsights: insights,
    fetchedAt: new Date(),
  };
}

// ---------------- helpers ----------------

function pivotRows(report: YoutubeAnalyticsReport): Array<Record<string, string | number>> {
  const headers = (report.columnHeaders ?? []).map((h) => h.name ?? '');
  const rows = report.rows ?? [];
  return rows.map((row) => {
    const o: Record<string, string | number> = {};
    for (let i = 0; i < headers.length; i++) {
      o[headers[i]] = row[i];
    }
    return o;
  });
}

function collectSeries(
  rows: Array<Record<string, string | number>>,
  key: string,
): DailySeriesPoint[] | undefined {
  if (rows.length === 0 || rows[0]['day'] === undefined) return undefined;
  return rows.map((r) => ({
    endTime: String(r['day']),
    value: numericOr0(r[key]),
  }));
}

function sumSeries(series: DailySeriesPoint[] | undefined): number | undefined {
  if (!series) return undefined;
  return series.reduce((acc, p) => acc + p.value, 0);
}

function sumColumn(
  rows: Array<Record<string, string | number>>,
  key: string,
): number | null {
  if (rows.length === 0 || rows[0][key] === undefined) return null;
  return rows.reduce((acc, r) => acc + numericOr0(r[key]), 0);
}

function avgColumn(
  rows: Array<Record<string, string | number>>,
  key: string,
): number | null {
  if (rows.length === 0 || rows[0][key] === undefined) return null;
  const total = rows.reduce((acc, r) => acc + numericOr0(r[key]), 0);
  return total / rows.length;
}

function numericOr0(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return 0;
}

function stripAgePrefix(raw: string): string {
  return raw.replace(/^age/i, '').toUpperCase();
}

function normalizeGender(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'male':
      return 'M';
    case 'female':
      return 'F';
    case 'gender_other':
      return 'OTHER';
    case 'user_specified':
      return 'SELF_DESCRIBED';
    default:
      return raw.toUpperCase();
  }
}
