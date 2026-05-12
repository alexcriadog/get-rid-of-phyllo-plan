// Engagement-deep mapper.
//
// Pivots the 6 batched YouTube Analytics reports (and an optional retention
// curve) into the canonical EngagementDeepSnapshot shape. The Analytics
// API returns flat row arrays — we group by `video` to produce the
// per-content nested shape consumers expect.

import type {
  EngagementDeepItem,
  EngagementDeepSnapshot,
  RetentionCurve,
} from '../../shared/platform-types';
import type { YoutubeAnalyticsReport } from '../../shared/youtube-api/youtube-types';

export interface EngagementDeepBundle {
  videoIds: string[];
  metricsReport: YoutubeAnalyticsReport | null;
  trafficReport: YoutubeAnalyticsReport | null;
  countriesReport: YoutubeAnalyticsReport | null;
  devicesReport: YoutubeAnalyticsReport | null;
  demoReport: YoutubeAnalyticsReport | null;
  sharingReport: YoutubeAnalyticsReport | null;
  retention: RetentionCurve | null;
  windowDays: number;
  errors: Array<{ bucket: string; message: string }>;
}

export function analyticsBundleToEngagementDeep(
  bundle: EngagementDeepBundle,
): EngagementDeepSnapshot {
  const itemsById = new Map<string, EngagementDeepItem>();

  for (const id of bundle.videoIds) {
    itemsById.set(id, {
      contentId: id,
      metrics: {},
      trafficSources: [],
      countries: [],
      devices: [],
      demographics: [],
      sharing: [],
    });
  }

  // 1. Top-level metrics — one row per video, all metrics as columns.
  if (bundle.metricsReport) {
    const headers = (bundle.metricsReport.columnHeaders ?? []).map((h) => h.name);
    const videoIdx = headers.indexOf('video');
    for (const row of bundle.metricsReport.rows ?? []) {
      const id = String(row[videoIdx] ?? '');
      if (!id) continue;
      const item = ensureItem(itemsById, id);
      for (let i = 0; i < headers.length; i++) {
        const name = headers[i];
        if (!name || name === 'video') continue;
        const v = Number(row[i] ?? 0);
        item.metrics[name] = Number.isFinite(v) ? v : 0;
      }
    }
  }

  // 2. Traffic sources — rows of (video, source, views, minutes).
  pivotByVideo(
    bundle.trafficReport,
    ['video', 'insightTrafficSourceType', 'views', 'estimatedMinutesWatched'],
    (id, row) => {
      const item = ensureItem(itemsById, id);
      item.trafficSources!.push({
        source: String(row.insightTrafficSourceType ?? ''),
        views: Number(row.views ?? 0),
        minutes: Number(row.estimatedMinutesWatched ?? 0),
      });
    },
  );

  // 3. Countries — rows of (video, country, views, minutes).
  pivotByVideo(
    bundle.countriesReport,
    ['video', 'country', 'views', 'estimatedMinutesWatched'],
    (id, row) => {
      const item = ensureItem(itemsById, id);
      item.countries!.push({
        country: String(row.country ?? ''),
        views: Number(row.views ?? 0),
        minutes: Number(row.estimatedMinutesWatched ?? 0),
      });
    },
  );

  // 4. Devices.
  pivotByVideo(
    bundle.devicesReport,
    ['video', 'deviceType', 'views', 'estimatedMinutesWatched'],
    (id, row) => {
      const item = ensureItem(itemsById, id);
      item.devices!.push({
        deviceType: String(row.deviceType ?? ''),
        views: Number(row.views ?? 0),
        minutes: Number(row.estimatedMinutesWatched ?? 0),
      });
    },
  );

  // 5. Demographics — rows of (video, ageGroup, gender, viewerPercentage).
  pivotByVideo(
    bundle.demoReport,
    ['video', 'ageGroup', 'gender', 'viewerPercentage'],
    (id, row) => {
      const item = ensureItem(itemsById, id);
      item.demographics!.push({
        ageGroup: String(row.ageGroup ?? ''),
        gender: String(row.gender ?? ''),
        viewerPercentage: Number(row.viewerPercentage ?? 0),
      });
    },
  );

  // 6. Sharing services.
  pivotByVideo(
    bundle.sharingReport,
    ['video', 'sharingService', 'shares'],
    (id, row) => {
      const item = ensureItem(itemsById, id);
      item.sharing!.push({
        service: String(row.sharingService ?? ''),
        shares: Number(row.shares ?? 0),
      });
    },
  );

  // Sort items by views desc so the UI renders the most relevant first.
  const items = Array.from(itemsById.values()).sort(
    (a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0),
  );

  return {
    periodDays: bundle.windowDays,
    items,
    retention: bundle.retention,
    errors: bundle.errors.length > 0 ? bundle.errors : undefined,
    fetchedAt: new Date(),
  };
}

function ensureItem(
  map: Map<string, EngagementDeepItem>,
  id: string,
): EngagementDeepItem {
  let item = map.get(id);
  if (!item) {
    item = {
      contentId: id,
      metrics: {},
      trafficSources: [],
      countries: [],
      devices: [],
      demographics: [],
      sharing: [],
    };
    map.set(id, item);
  }
  return item;
}

function pivotByVideo(
  report: YoutubeAnalyticsReport | null,
  expectedColumns: string[],
  consume: (videoId: string, row: Record<string, string | number>) => void,
): void {
  if (!report || !report.rows) return;
  const headers = (report.columnHeaders ?? []).map((h) => h.name);
  const idxMap = new Map<string, number>();
  for (const col of expectedColumns) {
    idxMap.set(col, headers.indexOf(col));
  }
  const videoIdx = idxMap.get('video') ?? -1;
  if (videoIdx < 0) return;

  for (const row of report.rows) {
    const id = String(row[videoIdx] ?? '');
    if (!id) continue;
    const out: Record<string, string | number> = {};
    for (const [name, idx] of idxMap.entries()) {
      if (idx >= 0) out[name] = row[idx] as string | number;
    }
    consume(id, out);
  }
}
