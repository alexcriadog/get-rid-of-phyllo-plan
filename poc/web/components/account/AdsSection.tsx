// Google Ads section — renders advertiser-side data (campaigns, spend,
// CPV) the connected user runs on YouTube. Source: Mongo `ads_campaigns`
// collection, produced by the POC sync worker's `ads` product on YouTube
// accounts.

export interface AdsCampaignRow {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType?: string;
  videoViews?: number;
  videoViewRate?: number | null;
  averageCpvUsd?: number | null;
  costUsd?: number;
  impressions?: number;
}

export interface AdsCustomerSummary {
  id: string;
  resourceName: string;
}

export interface AdsSnapshot {
  customers: AdsCustomerSummary[];
  primaryCustomerId?: string | null;
  campaigns: AdsCampaignRow[];
  totalViews: number;
  totalCostUsd: number;
  notes?: string[];
  fetchedAt?: string;
}

interface Props {
  snapshot: AdsSnapshot | null;
  fetchedAt?: string;
}

export function AdsSection({ snapshot, fetchedAt }: Props) {
  if (!snapshot) {
    return (
      <section style={sectionStyle}>
        <SectionHeader
          title="Google Ads"
          subtitle="ads · campaigns the connected user runs on YouTube (last 30d)"
        />
        <p style={mutedTextStyle}>
          No snapshot yet. The next <code>ads</code> sync will populate this
          section. Requires <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> set on
          the POC server.
        </p>
      </section>
    );
  }

  const hasNotes = snapshot.notes && snapshot.notes.length > 0;
  const hasCampaigns = snapshot.campaigns.length > 0;

  return (
    <section style={sectionStyle}>
      <SectionHeader
        title="Google Ads"
        subtitle={`ads · ${snapshot.campaigns.length} ${snapshot.campaigns.length === 1 ? 'campaign' : 'campaigns'} · last 30d${fetchedAt ? ` · updated ${formatDate(fetchedAt)}` : ''}`}
      />

      {hasNotes && (
        <div style={notesBannerStyle}>
          {snapshot.notes!.map((n, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              {n}
            </div>
          ))}
        </div>
      )}

      <div style={statsRowStyle}>
        <SummaryStat
          label="Accessible customers"
          value={snapshot.customers.length}
          hint={
            snapshot.customers.length > 0
              ? snapshot.customers.map((c) => c.id).join(' · ')
              : undefined
          }
        />
        <SummaryStat label="Video views · 30d" value={snapshot.totalViews} />
        <SummaryStat
          label="Spend · USD"
          value={snapshot.totalCostUsd}
          format="usd"
        />
        {snapshot.primaryCustomerId && (
          <SummaryStat
            label="Primary customer"
            value={snapshot.primaryCustomerId}
            format="raw"
          />
        )}
      </div>

      {!hasCampaigns ? (
        <p style={mutedTextStyle}>
          No campaigns served in the window.
          {snapshot.customers.length > 0
            ? ' The advertiser account is reachable but has no video campaigns active in the last 30 days.'
            : ''}
        </p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Campaign</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Views</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>View rate</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Avg CPV</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Spend</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.campaigns.map((c) => (
              <tr key={c.campaignId}>
                <td style={tdStyle}>{c.campaignName}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {(c.videoViews ?? 0).toLocaleString()}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {c.videoViewRate != null
                    ? `${(c.videoViewRate * 100).toFixed(1)}%`
                    : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {c.averageCpvUsd != null
                    ? `$${c.averageCpvUsd.toFixed(3)}`
                    : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  ${(c.costUsd ?? 0).toFixed(2)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details style={{ marginTop: 14 }}>
        <summary style={rawSummaryStyle}>Show raw payload</summary>
        <pre style={preStyle}>{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  format,
}: {
  label: string;
  value: number | string;
  hint?: string;
  format?: 'usd' | 'raw';
}) {
  const display =
    format === 'usd' && typeof value === 'number'
      ? `$${value.toFixed(2)}`
      : format === 'raw'
        ? String(value)
        : typeof value === 'number'
          ? value.toLocaleString()
          : value;
  return (
    <div style={summaryStatStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={metricValueStyle}>{display}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
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
const notesBannerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid rgba(60,255,208,0.4)',
  background: 'rgba(60,255,208,0.06)',
  color: '#3cffd0',
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  marginBottom: 16,
  lineHeight: 1.5,
};
const statsRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 16,
};
const summaryStatStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  padding: '12px 14px',
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
  fontSize: 26,
  color: '#fff',
  lineHeight: 1.1,
  marginTop: 4,
};
const hintStyle: React.CSSProperties = {
  fontFamily: 'var(--v-mono)',
  fontSize: 10,
  color: 'rgba(255,255,255,0.5)',
  marginTop: 4,
  wordBreak: 'break-all',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  marginTop: 6,
};
const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.85)',
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
