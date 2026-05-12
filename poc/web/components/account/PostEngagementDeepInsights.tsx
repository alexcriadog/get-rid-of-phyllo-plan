// Per-post engagement-deep insights — rendered inside the PostDialog
// "Insights" tab when an engagement_deep_snapshot item exists for the
// open post. Cross-platform in shape; today YouTube is the only producer.
//
// Renders, in order:
//   - 28-day metrics grid (views, watch min, retention %, likes, comments,
//     subs±, playlist±, card/teaser/annotation CTRs, ...).
//   - Cross-tab strip (traffic / countries / devices / sharing services).
//   - Audience demographics bars (age × gender).
//   - Audience retention curve when the post is the top of the snapshot.

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

interface Props {
  item: EngagementDeepItem;
  /** Snapshot-wide retention curve. Rendered only when its contentId
   *  matches the open post — retention is captured for the top video. */
  retention?: RetentionCurve | null;
  /** Sync window the snapshot was taken over. Surfaced as a context line. */
  periodDays?: number;
}

export function PostEngagementDeepInsights({ item, retention, periodDays }: Props) {
  const showRetention =
    retention && retention.contentId === item.contentId && retention.points.length > 0;

  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--v-text-muted)',
          marginBottom: 10,
        }}
      >
        Engagement deep · {periodDays ?? 28}-day window
      </div>

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

      {showRetention && (
        <div style={{ marginTop: 14 }}>
          <h4 style={subHeadingStyle}>
            Audience retention · {retention!.periodDays}d
          </h4>
          <RetentionChart points={retention!.points} />
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary style={rawSummaryStyle}>Raw engagement_deep payload</summary>
        <pre style={preStyle}>{JSON.stringify(item, null, 2)}</pre>
      </details>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function MetricsGrid({ metrics }: { metrics: Record<string, number> }) {
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
    { key: 'annotationImpressions', label: 'Annotation imp.' },
    { key: 'annotationClicks', label: 'Annotation clicks' },
    { key: 'annotationClickThroughRate', label: 'Annotation CTR' },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
        marginBottom: 14,
      }}
    >
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 14,
        marginTop: 6,
      }}
    >
      {traffic && traffic.length > 0 && (
        <Column
          title="Traffic sources"
          rows={traffic.slice(0, 6).map((r) => ({ label: r.source, value: r.views }))}
        />
      )}
      {countries && countries.length > 0 && (
        <Column
          title="Top countries"
          rows={countries.slice(0, 6).map((r) => ({ label: r.country, value: r.views }))}
        />
      )}
      {devices && devices.length > 0 && (
        <Column
          title="Devices"
          rows={devices.map((r) => ({ label: r.deviceType, value: r.views }))}
        />
      )}
      {sharing && sharing.length > 0 && (
        <Column
          title="Sharing services"
          rows={sharing.slice(0, 6).map((r) => ({ label: r.service, value: r.shares }))}
        />
      )}
    </div>
  );
}

function Column({
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
          <div key={r.label} style={listRowStyle}>
            <span style={{ fontSize: 12, color: '#fff' }}>{r.label}</span>
            <span
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 12,
                color: '#3cffd0',
              }}
            >
              {r.value.toLocaleString()}
            </span>
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
                  <span style={barValueStyle}>
                    {r.viewerPercentage.toFixed(1)}%
                  </span>
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
      <text
        x={padding}
        y={H - 1}
        fontSize="9"
        fill="rgba(255,255,255,0.4)"
        fontFamily="var(--v-mono)"
      >
        0%
      </text>
      <text
        x={W - 24}
        y={H - 1}
        fontSize="9"
        fill="rgba(255,255,255,0.4)"
        fontFamily="var(--v-mono)"
      >
        100%
      </text>
    </svg>
  );
}

// ─── styles ────────────────────────────────────────────────────────────

const subHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  margin: '0 0 6px',
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
const listRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
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

function formatMetricValue(v: number, key: string): string {
  if (key.toLowerCase().includes('rate') || key === 'averageViewPercentage') {
    return `${v.toFixed(2)}${v > 1 ? '%' : ''}`;
  }
  return v.toLocaleString();
}
