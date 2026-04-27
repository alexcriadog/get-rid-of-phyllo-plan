import { useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import {
  LineChart,
  Donut,
  Heatmap,
  HBarChart,
  Sparkline,
  Gauge,
  Timeline,
  Tabs,
  TtlBar,
  STATUS_COLORS,
  compactNumber,
} from '../../components/charts';

const NOW = Date.now();

// ── Mock data ──────────────────────────────────────────────────────────────

const throughputSeries = [
  {
    label: '2xx',
    color: STATUS_COLORS.ok,
    points: minutePoints(60, () => 6 + Math.round(Math.random() * 18)),
  },
  {
    label: '4xx',
    color: STATUS_COLORS.warn,
    points: minutePoints(60, (i) =>
      i % 9 === 0 ? Math.round(Math.random() * 4) : 0,
    ),
  },
  {
    label: '5xx',
    color: STATUS_COLORS.danger,
    points: minutePoints(60, (i) => (i === 35 || i === 36 ? 2 : 0)),
  },
];

const followerSeries = [
  {
    label: 'Followers',
    color: 'var(--mint)',
    points: dayPoints(28, (i) => 475 + i * 12 + Math.round(Math.sin(i / 2) * 15)),
  },
];

const healthDonut = [
  { label: 'Fresh', value: 18 },
  { label: 'Stale', value: 4 },
  { label: 'Failing', value: 2 },
  { label: 'Paused', value: 3 },
];

const genderDonut = [
  { label: 'Female', value: 1240, color: 'var(--pink)' },
  { label: 'Male', value: 980, color: 'var(--mint)' },
  { label: 'Unknown', value: 320, color: 'var(--purple)' },
];

const heatmapAccounts = ['@padelwithjud', 'Padelwithjud', '@brand_b', '@brand_c', '@news_es'];
const heatmapHours = Array.from({ length: 24 }, (_, h) => `${pad2(h)}`);
const heatmapCells = heatmapAccounts.flatMap((a) =>
  heatmapHours.map((h) => ({
    row: a,
    col: h,
    value: Math.max(
      0,
      Math.round(
        8 * Math.random() - 1 + (parseInt(h, 10) > 8 && parseInt(h, 10) < 22 ? 4 : 0),
      ),
    ),
  })),
);

const topEndpoints = [
  { label: 'GET /936002.../insights', value: 1430 },
  { label: 'GET /936002.../posts', value: 320 },
  { label: 'GET /17841461.../media', value: 280, caption: 'p95 540 ms' },
  { label: 'GET /17841461.../insights', value: 175 },
  { label: 'GET /me/accounts', value: 28, caption: 'one-shot, discover only' },
];

const topErrors = [
  { label: '(#100) The value must be a valid insights metric', value: 11, color: STATUS_COLORS.warn },
  { label: '(#10) Application does not have permission', value: 4, color: STATUS_COLORS.warn },
  { label: 'getaddrinfo ENOTFOUND graph.facebook.com', value: 5, color: STATUS_COLORS.danger },
  { label: 'HTTP 500 (transient)', value: 1, color: STATUS_COLORS.danger },
];

const timelineRows = [
  { id: 'a3-aud', label: 'Padelwithjud · audience' },
  { id: 'a3-eng', label: 'Padelwithjud · posts' },
  { id: 'a3-id', label: 'Padelwithjud · identity' },
  { id: 'a2-aud', label: '@padelwithjud · audience' },
  { id: 'a2-eng', label: '@padelwithjud · posts' },
];

const timelineEvents = [
  { rowId: 'a3-aud', startMs: NOW + 3 * 60_000, endMs: NOW + 4 * 60_000, tone: 'info' as const, meta: [{ label: 'cadence', value: '24h' }] },
  { rowId: 'a3-eng', startMs: NOW + 8 * 60_000, endMs: NOW + 9 * 60_000, tone: 'ok' as const, meta: [{ label: 'cadence', value: '2h' }] },
  { rowId: 'a3-id', startMs: NOW + 30 * 60_000, endMs: NOW + 31 * 60_000, tone: 'ok' as const, meta: [{ label: 'cadence', value: '6h' }] },
  { rowId: 'a2-aud', startMs: NOW + 12 * 60_000, endMs: NOW + 13 * 60_000, tone: 'warn' as const, meta: [{ label: 'last_error', value: 'transient DNS' }] },
  { rowId: 'a2-eng', startMs: NOW + 22 * 60_000, endMs: NOW + 23 * 60_000, tone: 'ok' as const },
];

// ── Page ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'kpis', label: 'KPIs + trends' },
  { id: 'distrib', label: 'Distributions', badge: 2 },
  { id: 'activity', label: 'Activity' },
  { id: 'tops', label: 'Tops' },
  { id: 'ops', label: 'Operations', badge: 4 },
];

export default function ChartsDemo() {
  const [active, setActive] = useState('kpis');

  return (
    <AdminLayout title="Charts library · demo">
      <p className="muted" style={{ marginTop: 0, marginBottom: 16, maxWidth: 720 }}>
        Showcase of the chart primitives used across the redesigned admin panel.
        Hover over any element to see tooltips. <strong>All data is mocked</strong>{' '}
        — purely for validating the visual direction before wiring real endpoints.
      </p>

      <Tabs items={TABS} activeId={active} onChange={setActive} />

      {active === 'kpis' && (
        <>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 24 }}
          >
            <KpiCard label="Accounts" value="3" tone="info" />
            <KpiCard label="Success rate" value="92%" tone="ok" />
            <KpiCard label="Errors / 1h" value="5" tone="warn" />
            <KpiCard label="DLQ depth" value="0" tone="ok" />
          </div>

          <Section
            title="Throughput · last 60 min"
            subtitle="Stacked area · hover for per-status counts"
          >
            <LineChart
              series={throughputSeries}
              height={220}
              area
              stacked
              xLabels={{ left: '-60m', mid: '-30m', right: 'now' }}
            />
          </Section>

          <Section
            title="Follower count · 28 days"
            subtitle="Single-series LineChart"
          >
            <LineChart
              series={followerSeries}
              height={180}
              area
              xLabels={{ left: '28d ago', mid: '14d ago', right: 'today' }}
            />
          </Section>
        </>
      )}

      {active === 'distrib' && (
        <div
          className="grid"
          style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}
        >
          <Section
            title="Health mix"
            subtitle="Donut · hover slice or legend to focus"
          >
            <Donut slices={healthDonut} size={180} centerLabel="Accounts" />
          </Section>
          <Section title="Gender split (IG)" subtitle="Donut · custom colors">
            <Donut slices={genderDonut} size={180} centerLabel="Followers" />
          </Section>
        </div>
      )}

      {active === 'activity' && (
        <>
          <Section
            title="Activity heatmap"
            subtitle="Accounts × hour over the last 24h · darker = more calls"
          >
            <Heatmap
              rows={heatmapAccounts}
              cols={heatmapHours}
              cells={heatmapCells}
              unitLabel="calls"
              cellSize={20}
            />
          </Section>

          <Section
            title="Account cards preview"
            subtitle="Sparkline inside grid card"
          >
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
            >
              {[
                {
                  name: '@padelwithjud',
                  platform: 'instagram',
                  ok: '99.2%',
                  color: 'var(--mint)',
                },
                {
                  name: 'Padelwithjud',
                  platform: 'facebook',
                  ok: '88.7%',
                  color: 'var(--accent)',
                },
                {
                  name: '@brand_b',
                  platform: 'instagram',
                  ok: '95.1%',
                  color: 'var(--purple)',
                },
              ].map((a) => (
                <div key={a.name} className="panel" style={{ padding: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: a.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#000',
                        fontWeight: 700,
                      }}
                    >
                      {a.name.replace(/^@/, '').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div
                        className="faint"
                        style={{ fontSize: 11, fontFamily: 'var(--mono)' }}
                      >
                        {a.platform} · {a.ok} success 24h
                      </div>
                    </div>
                  </div>
                  <Sparkline
                    points={minutePoints(48, () => 60 + Math.random() * 40)}
                    color={a.color}
                    height={42}
                    showLastValue
                  />
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {active === 'tops' && (
        <div
          className="grid"
          style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}
        >
          <Section title="Top endpoints" subtitle="HBarChart · ranked + caption">
            <HBarChart items={topEndpoints} formatValue={compactNumber} />
          </Section>
          <Section title="Top errors" subtitle="HBarChart · custom colors">
            <HBarChart items={topErrors} showPct={false} />
          </Section>
        </div>
      )}

      {active === 'ops' && (
        <>
          <Section
            title="Rate buckets"
            subtitle="Radial gauges · auto-tone by fill ratio"
          >
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <Gauge value={184} max={200} label="instagram · global" />
              <Gauge value={62} max={200} label="ig · @padelwithjud" />
              <Gauge value={18} max={200} label="fb · Padelwithjud" />
              <Gauge value={195} max={200} label="threads · @brand" />
            </div>
          </Section>

          <Section
            title="Next runs · next 60 min"
            subtitle="Gantt-style Timeline with hour ticks"
          >
            <Timeline
              rows={timelineRows}
              events={timelineEvents}
              startMs={NOW}
              endMs={NOW + 60 * 60_000}
              hourTickEvery={1}
            />
          </Section>

          <Section
            title="Active throttle locks"
            subtitle="TtlBar · countdown in real time"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <TtlBar
                ttlSeconds={580}
                totalSeconds={600}
                label="account #3 · engagement_new"
              />
              <TtlBar
                ttlSeconds={300}
                totalSeconds={600}
                label="account #2 · stories"
              />
              <TtlBar
                ttlSeconds={45}
                totalSeconds={600}
                label="account #2 · audience"
              />
              <TtlBar
                ttlSeconds={4}
                totalSeconds={600}
                label="account #4 · identity (about to release)"
              />
            </div>
          </Section>
        </>
      )}
    </AdminLayout>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ marginBottom: 24, padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.02em' }}>{title}</div>
        {subtitle && (
          <div
            className="muted"
            style={{ fontSize: 11, fontFamily: 'var(--mono)', marginTop: 2 }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'danger' | 'info';
}) {
  const accent =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--accent)';
  return (
    <div className="panel" style={{ borderTop: `2px solid ${accent}`, padding: 'var(--space-4)' }}>
      <div
        className="kpi-label"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        className="kpi-value"
        style={{ color: accent, fontSize: 32, fontWeight: 600, lineHeight: 1 }}
      >
        {value}
      </div>
    </div>
  );
}

function minutePoints(n: number, gen: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => ({
    x: NOW - (n - i) * 60_000,
    y: Math.max(0, gen(i)),
  }));
}

function dayPoints(n: number, gen: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => ({
    x: NOW - (n - i) * 86_400_000,
    y: gen(i),
  }));
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
