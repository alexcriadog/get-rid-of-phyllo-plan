// Engagement-deep section — renders per-video drill-down + retention curve
// for an account. Source: Mongo `engagement_deep_snapshots` collection,
// produced by the POC sync worker's `engagement_deep` product.
//
// Read-only; the public dashboard never triggers a refresh. Operators
// trigger refreshes via /admin → Run now.

import { useState } from 'react';

export interface EngagementDeepItem {
  contentId: string;
  metrics: Record<string, number>;
  trafficSources?: Array<{ source: string; views: number; minutes: number }>;
  countries?: Array<{ country: string; views: number; minutes: number }>;
  devices?: Array<{ deviceType: string; views: number; minutes: number }>;
  demographics?: Array<{
    ageGroup: string;
    gender: string;
    viewerPercentage: number;
  }>;
  sharing?: Array<{ service: string; shares: number }>;
}

export interface RetentionCurve {
  contentId: string;
  periodDays: number;
  points: Array<{
    elapsedRatio: number;
    audienceWatchRatio: number;
    relativeRetentionPerformance: number;
  }>;
}

export interface EngagementDeepSnapshot {
  periodDays: number;
  items: EngagementDeepItem[];
  retention?: RetentionCurve | null;
  errors?: Array<{ bucket: string; message: string }>;
  fetchedAt?: string;
}

interface VideoMetadata {
  title?: string;
  thumbnailUrl?: string;
  duration?: string;
  publishedAt?: string;
}

interface Props {
  snapshot: EngagementDeepSnapshot | null;
  videoMeta?: Record<string, VideoMetadata>;
  fetchedAt?: string;
}

export function EngagementDeepSection({ snapshot, videoMeta = {}, fetchedAt }: Props) {
  if (!snapshot) {
    return (
      <section style={sectionStyle}>
        <SectionHeader
          title="Per-video deep dive"
          subtitle="engagement_deep · YouTube Analytics filtered by video"
        />
        <p style={mutedTextStyle}>
          No snapshot yet. The next <code>engagement_deep</code> sync will
          populate this section.
        </p>
      </section>
    );
  }

  const items = snapshot.items ?? [];
  return (
    <section style={sectionStyle}>
      <SectionHeader
        title="Per-video deep dive"
        subtitle={`engagement_deep · ${items.length} ${items.length === 1 ? 'video' : 'videos'} · ${snapshot.periodDays}d window${fetchedAt ? ` · updated ${formatDate(fetchedAt)}` : ''}`}
      />

      {snapshot.errors && snapshot.errors.length > 0 && (
        <div style={errorBannerStyle}>
          {snapshot.errors.length} sub-query failed:{' '}
          {snapshot.errors.map((e) => `${e.bucket}=${e.message}`).join('; ')}
        </div>
      )}

      {items.length === 0 ? (
        <p style={mutedTextStyle}>
          The endpoint returned no rows in the {snapshot.periodDays}-day window.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((item, idx) => (
            <VideoCard
              key={item.contentId}
              item={item}
              meta={videoMeta[item.contentId]}
              defaultOpen={idx === 0}
              retention={
                snapshot.retention && snapshot.retention.contentId === item.contentId
                  ? snapshot.retention
                  : null
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoCard({
  item,
  meta,
  defaultOpen,
  retention,
}: {
  item: EngagementDeepItem;
  meta?: VideoMetadata;
  defaultOpen?: boolean;
  retention: RetentionCurve | null;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const views = item.metrics.views ?? 0;
  return (
    <article style={cardStyle}>
      <button
        onClick={() => setOpen(!open)}
        style={summaryButtonStyle}
        aria-expanded={open}
      >
        <span style={chevronStyle(open)}>▸</span>
        {meta?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.thumbnailUrl} alt="" style={thumbStyle} />
        ) : (
          <div style={{ ...thumbStyle, background: 'rgba(255,255,255,0.04)' }} />
        )}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={titleStyle}>
            {meta?.title ?? `(no title)`}
          </div>
          <div style={metaTextStyle}>
            <code style={codeChipStyle}>{item.contentId}</code>
            {meta?.duration ? ` · ${formatDuration(meta.duration)}` : ''}
            {meta?.publishedAt ? ` · ${formatDate(meta.publishedAt)}` : ''}
          </div>
        </div>
        <div style={summaryStatsStyle}>
          <Stat label="Views" value={views} />
          <Stat label="Watch min" value={item.metrics.estimatedMinutesWatched ?? 0} />
          <Stat label="Likes" value={item.metrics.likes ?? 0} />
          <Stat label="Subs+" value={item.metrics.subscribersGained ?? 0} />
        </div>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px' }}>
          <MetricsGrid metrics={item.metrics} />

          <CrossTabRow
            traffic={item.trafficSources}
            countries={item.countries}
            devices={item.devices}
            sharing={item.sharing}
          />

          {item.demographics && item.demographics.length > 0 && (
            <DemographicsBars rows={item.demographics} />
          )}

          {retention && retention.points.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h4 style={subHeadingStyle}>
                Audience retention · {retention.periodDays}d ·
                audienceWatchRatio
              </h4>
              <RetentionChart points={retention.points} />
            </div>
          )}

          <details style={{ marginTop: 14 }}>
            <summary style={rawSummaryStyle}>Show raw payload</summary>
            <pre style={preStyle}>{JSON.stringify(item, null, 2)}</pre>
          </details>
        </div>
      )}
    </article>
  );
}

function MetricsGrid({ metrics }: { metrics: Record<string, number> }) {
  // Ordered list of "interesting" metric keys; everything else lands under
  // the "More" block via the raw payload disclosure.
  const ORDER: Array<{ key: string; label: string }> = [
    { key: 'views', label: 'Views' },
    { key: 'engagedViews', label: 'Engaged views' },
    { key: 'estimatedMinutesWatched', label: 'Watch (min)' },
    { key: 'averageViewDuration', label: 'Avg view (s)' },
    { key: 'averageViewPercentage', label: 'Avg view %' },
    { key: 'likes', label: 'Likes' },
    { key: 'dislikes', label: 'Dislikes' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
    { key: 'subscribersGained', label: 'Subs gained' },
    { key: 'subscribersLost', label: 'Subs lost' },
    { key: 'videosAddedToPlaylists', label: 'Added to playlists' },
    { key: 'videosRemovedFromPlaylists', label: 'Removed from playlists' },
    { key: 'cardImpressions', label: 'Card impressions' },
    { key: 'cardClicks', label: 'Card clicks' },
    { key: 'cardClickRate', label: 'Card CTR' },
    { key: 'cardTeaserImpressions', label: 'Teaser impressions' },
    { key: 'cardTeaserClicks', label: 'Teaser clicks' },
    { key: 'cardTeaserClickRate', label: 'Teaser CTR' },
    { key: 'annotationImpressions', label: 'Annotation impressions' },
    { key: 'annotationClicks', label: 'Annotation clicks' },
    { key: 'annotationClickThroughRate', label: 'Annotation CTR' },
  ];
  return (
    <div style={metricsGridStyle}>
      {ORDER.map(({ key, label }) => (
        <div key={key} style={metricCellStyle}>
          <div style={metricLabelStyle}>{label}</div>
          <div style={metricValueStyle}>
            {formatMetricValue(metrics[key] ?? 0, key)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CrossTabRow({
  traffic,
  countries,
  devices,
  sharing,
}: {
  traffic?: EngagementDeepItem['trafficSources'];
  countries?: EngagementDeepItem['countries'];
  devices?: EngagementDeepItem['devices'];
  sharing?: EngagementDeepItem['sharing'];
}) {
  const hasAny =
    (traffic && traffic.length > 0) ||
    (countries && countries.length > 0) ||
    (devices && devices.length > 0) ||
    (sharing && sharing.length > 0);
  if (!hasAny) return null;
  return (
    <div style={crossTabGridStyle}>
      {traffic && traffic.length > 0 && (
        <CrossTabColumn
          title="Traffic sources"
          rows={traffic.slice(0, 6).map((r) => ({
            label: r.source,
            value: r.views,
          }))}
        />
      )}
      {countries && countries.length > 0 && (
        <CrossTabColumn
          title="Top countries"
          rows={countries.slice(0, 6).map((r) => ({
            label: r.country,
            value: r.views,
          }))}
        />
      )}
      {devices && devices.length > 0 && (
        <CrossTabColumn
          title="Devices"
          rows={devices.map((r) => ({ label: r.deviceType, value: r.views }))}
        />
      )}
      {sharing && sharing.length > 0 && (
        <CrossTabColumn
          title="Sharing services"
          rows={sharing
            .slice(0, 6)
            .map((r) => ({ label: r.service, value: r.shares }))}
        />
      )}
    </div>
  );
}

function CrossTabColumn({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
}) {
  return (
    <div>
      <h4 style={subHeadingStyle}>{title}</h4>
      <div>
        {rows.map((r) => (
          <div key={r.label} style={crossRowStyle}>
            <span style={crossLabelStyle}>{r.label}</span>
            <span style={crossValueStyle}>{r.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemographicsBars({
  rows,
}: {
  rows: Array<{ ageGroup: string; gender: string; viewerPercentage: number }>;
}) {
  const byGender: Record<
    string,
    Array<{ ageGroup: string; viewerPercentage: number }>
  > = {};
  for (const r of rows) {
    (byGender[r.gender] ?? (byGender[r.gender] = [])).push({
      ageGroup: r.ageGroup,
      viewerPercentage: r.viewerPercentage,
    });
  }
  const genders = Object.keys(byGender);
  if (genders.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.viewerPercentage), 1);
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={subHeadingStyle}>Audience demographics</h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${genders.length}, 1fr)`,
          gap: 24,
        }}
      >
        {genders.map((g) => (
          <div key={g}>
            <div style={{ ...metricLabelStyle, marginBottom: 6 }}>{g}</div>
            {byGender[g]
              .slice()
              .sort((a, b) => a.ageGroup.localeCompare(b.ageGroup))
              .map((r) => (
                <div style={barRowStyle} key={r.ageGroup + g}>
                  <span style={barLabelStyle}>{r.ageGroup.replace('age', '')}</span>
                  <div style={barTrackStyle}>
                    <div
                      style={{
                        ...barFillStyle,
                        width: `${Math.min(100, (r.viewerPercentage / max) * 100)}%`,
                        background:
                          g.toLowerCase() === 'female'
                            ? 'linear-gradient(90deg, #ff3c5e, rgba(255,60,94,0.45))'
                            : 'linear-gradient(90deg, #3cffd0, rgba(60,255,208,0.45))',
                      }}
                    />
                  </div>
                  <span style={barValueStyle}>{r.viewerPercentage.toFixed(1)}%</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RetentionChart({
  points,
}: {
  points: Array<{ elapsedRatio: number; audienceWatchRatio: number }>;
}) {
  const W = 560;
  const H = 100;
  const padding = 4;
  const max = Math.max(...points.map((p) => p.audienceWatchRatio), 1);
  const pathD = points
    .map((p, i) => {
      const x = padding + p.elapsedRatio * (W - padding * 2);
      const y = H - padding - (p.audienceWatchRatio / max) * (H - padding * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaD =
    pathD +
    ` L${(W - padding).toFixed(1)},${(H - padding).toFixed(1)} L${padding.toFixed(1)},${(H - padding).toFixed(1)} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        height: H,
        display: 'block',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 8,
      }}
      preserveAspectRatio="none"
    >
      <path d={areaD} fill="rgba(60,255,208,0.12)" />
      <path d={pathD} fill="none" stroke="#3cffd0" strokeWidth="1.5" />
      <text x={padding} y={H - 1} fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="var(--v-mono)">
        0%
      </text>
      <text x={W - 24} y={H - 1} fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="var(--v-mono)">
        100%
      </text>
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span style={smallLabelStyle}>{label}</span>
      <span style={smallValueStyle}>{value.toLocaleString()}</span>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={sectionHeadStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <span style={sectionScopeStyle}>{subtitle}</span>
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = { marginTop: 48 };
const sectionHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 14,
  marginBottom: 18,
  paddingBottom: 10,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  flexWrap: 'wrap',
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--v-display)',
  fontSize: 28,
  color: '#fff',
  margin: 0,
};
const sectionScopeStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
};
const mutedTextStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.5)',
  fontSize: 14,
};
const errorBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,60,94,0.4)',
  background: 'rgba(255,60,94,0.08)',
  color: '#ff8fa1',
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  marginBottom: 14,
};
const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  overflow: 'hidden',
};
const summaryButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  padding: '14px 18px',
  cursor: 'pointer',
  textAlign: 'left',
};
const chevronStyle = (open: boolean): React.CSSProperties => ({
  fontFamily: 'var(--v-mono)',
  color: 'rgba(255,255,255,0.5)',
  fontSize: 10,
  flexShrink: 0,
  display: 'inline-block',
  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
  transition: 'transform 120ms ease',
});
const thumbStyle: React.CSSProperties = {
  width: 90,
  aspectRatio: '16/9',
  objectFit: 'cover',
  borderRadius: 6,
  flexShrink: 0,
};
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#fff',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const metaTextStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.5)',
  marginTop: 4,
};
const codeChipStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  background: 'rgba(255,255,255,0.05)',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
};
const summaryStatsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  fontFamily: 'var(--v-mono)',
  fontSize: 11,
  color: 'rgba(255,255,255,0.85)',
  flexShrink: 0,
};
const smallLabelStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
};
const smallValueStyle: React.CSSProperties = { color: '#fff', fontSize: 13 };

const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 12,
  marginTop: 6,
};
const metricCellStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  padding: '10px 12px',
};
const metricLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
};
const metricValueStyle: React.CSSProperties = {
  fontFamily: 'var(--v-display)',
  fontSize: 22,
  color: '#fff',
  lineHeight: 1.1,
  marginTop: 4,
};

const crossTabGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
  marginTop: 14,
};
const subHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  margin: '0 0 6px',
};
const crossRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};
const crossLabelStyle: React.CSSProperties = { fontSize: 12, color: '#fff' };
const crossValueStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  color: '#3cffd0',
};

const barRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '60px 1fr 50px',
  alignItems: 'center',
  gap: 10,
  marginBottom: 6,
};
const barLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.5)',
};
const barTrackStyle: React.CSSProperties = {
  height: 8,
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 999,
  overflow: 'hidden',
};
const barFillStyle: React.CSSProperties = { height: '100%', borderRadius: 999 };
const barValueStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 11,
  color: '#fff',
  textAlign: 'right',
};

const rawSummaryStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
};
const preStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  lineHeight: 1.4,
  color: 'rgba(255,255,255,0.85)',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  padding: 10,
  overflowX: 'auto',
  maxHeight: 360,
  overflowY: 'auto',
  marginTop: 6,
};

// ─── helpers ───────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatDuration(iso?: string): string {
  if (!iso) return '—';
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return iso;
  const [, h = '0', mn = '0', s = '0'] = m;
  const H = Number(h), M = Number(mn), S = Number(s);
  if (H > 0) return `${H}:${String(M).padStart(2, '0')}:${String(S).padStart(2, '0')}`;
  return `${M}:${String(S).padStart(2, '0')}`;
}

function formatMetricValue(v: number, key: string): string {
  if (key.toLowerCase().includes('rate') || key === 'averageViewPercentage') {
    return `${v.toFixed(2)}${v > 1 ? '%' : ''}`;
  }
  return v.toLocaleString();
}
