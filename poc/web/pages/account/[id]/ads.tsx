// Ads insights page — advertiser-side data across platforms.
//   - Facebook: surfaces /me/adaccounts spend/reach/CTR data captured via
//     the ads_read scope (admin endpoint /admin/ca/ads/sync). Reads from
//     Mongo `ad_insights` collection.
//   - YouTube: surfaces Google Ads video campaigns (`adwords` scope) via
//     the `ads` sync product. Reads from Mongo `ads_campaigns` collection.
// Other platforms get redirected to the overview.

import Link from 'next/link';
import { useMemo } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtNumber } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';
import {
  AdsSection,
  type AdsSnapshot,
} from '../../../components/account/AdsSection';

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: { username?: string; displayName?: string };
};

type InsightsRow = {
  account_id: string;
  ad_account_id: string;
  ad_account_name?: string | null;
  currency?: string | null;
  level: 'account' | 'campaign';
  campaign_id?: string | null;
  campaign_name?: string | null;
  date_start?: string | null;
  date_stop?: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc?: number | null;
  cpp?: number | null;
  frequency?: number | null;
  unique_clicks?: number | null;
  captured_at?: string | null;
};

type YoutubeAdsDoc = {
  account_id: string;
  platform: string;
  data?: AdsSnapshot;
  updated_at?: string;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  rows: InsightsRow[];
  /** YouTube branch only — populated when identity.platform === 'youtube'. */
  youtubeAds: YoutubeAdsDoc | null;
};

const SUPPORTED_PLATFORMS = new Set<string>(['facebook', 'youtube']);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const identityDoc = await db
      .collection('identity_snapshots')
      .findOne({ $or: filters });
    const identity = identityDoc
      ? (toPlainJson(identityDoc) as IdentitySnapshot)
      : null;
    if (identity && !SUPPORTED_PLATFORMS.has(identity.platform)) {
      return { redirect: { destination: `/account/${id}`, permanent: false } };
    }
    // Branch the data load by platform so we only pay for what we render.
    if (identity?.platform === 'youtube') {
      const adsDoc = await db
        .collection('ads_campaigns')
        .findOne({ $or: filters }, { sort: { updated_at: -1 } });
      return {
        props: {
          id,
          identity,
          rows: [],
          youtubeAds: adsDoc ? (toPlainJson(adsDoc) as YoutubeAdsDoc) : null,
        },
      };
    }
    const rowDocs = await db
      .collection('ad_insights')
      .find({ account_id: id })
      .sort({ date_stop: -1, level: 1, captured_at: -1 })
      .limit(200)
      .toArray();
    return {
      props: {
        id,
        identity,
        rows: rowDocs.map((d) => toPlainJson(d) as InsightsRow),
        youtubeAds: null,
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, rows: [], youtubeAds: null } };
  }
};

function toPlainJson(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value === 'object') {
    const maybeHex = (value as { toHexString?: () => string }).toHexString;
    if (typeof maybeHex === 'function') return maybeHex.call(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlainJson(v);
    }
    return out;
  }
  return value;
}

export default function AdsPage(props: PageProps) {
  // Platform branch so the rest of this file (the original FB rendering
  // path) stays untouched. YouTube uses the canonical AdsSnapshot shape
  // with the dedicated section component.
  if (props.identity?.platform === 'youtube') {
    return <YoutubeAdsPage {...props} />;
  }
  return <FacebookAdsPage {...props} />;
}

function YoutubeAdsPage({ id, identity, youtubeAds }: PageProps) {
  const ownerHandle =
    identity?.data?.username ?? identity?.data?.displayName ?? '';
  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          <Link href={`/account/${id}`} className="v-meta">
            ← Overview
          </Link>
          <Link href={`/account/${id}/engagement-deep`} className="v-meta">
            ← Engagement deep
          </Link>
          <div style={{ flex: 1 }} />
          {ownerHandle && (
            <span
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--v-text-muted)',
              }}
            >
              {ownerHandle}
            </span>
          )}
        </header>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <h1
            className="v-display"
            style={{ fontSize: 'clamp(36px, 5vw, 64px)', margin: 0, color: '#fff' }}
          >
            Google Ads
          </h1>
          {youtubeAds?.updated_at && (
            <span
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                color: 'var(--v-text-muted)',
              }}
            >
              updated <RelativeTime value={youtubeAds.updated_at} />
            </span>
          )}
        </div>

        <p
          className="v-body"
          style={{ maxWidth: 720, color: 'var(--v-text-subtle)', marginBottom: 24 }}
        >
          YouTube video advertising campaigns the connected user runs via
          Google Ads (<code>adwords</code> scope). Last 30 days, refreshed
          every 6 hours by the <code>ads</code> sync product. Requires{' '}
          <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> set on the POC server.
        </p>

        <AdsSection
          snapshot={youtubeAds?.data ?? null}
          fetchedAt={youtubeAds?.updated_at}
        />
      </div>
    </div>
  );
}

function FacebookAdsPage({ id, identity, rows }: PageProps) {
  const ownerHandle = identity?.data?.username ?? identity?.data?.displayName;

  const accountRow = useMemo(
    () => rows.find((r) => r.level === 'account') ?? null,
    [rows],
  );
  const campaigns = useMemo(
    () => rows.filter((r) => r.level === 'campaign'),
    [rows],
  );
  const currency = accountRow?.currency ?? campaigns[0]?.currency ?? 'EUR';

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Link href={`/account/${id}`} className="v-meta">
            ← Overview
          </Link>
          <Link href={`/account/${id}/reviews`} className="v-meta">
            Reviews →
          </Link>
          <div style={{ flex: 1 }} />
          {accountRow?.date_start && accountRow?.date_stop && (
            <span className="v-tag outline">
              {accountRow.date_start} → {accountRow.date_stop}
            </span>
          )}
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span className="v-kicker mint">Paid media</span>
          <span className="v-eyebrow" style={{ color: '#fff' }}>
            What {ownerHandle ? `@${ownerHandle}` : 'this account'} spent
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
        </div>

        <h1 className="v-display size-secondary" style={{ marginBottom: 32 }}>
          Spend, meet impact.
        </h1>

        {!accountRow ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <span className="v-kicker mint">No ad activity</span>
            <h2 className="v-display size-tertiary" style={{ marginTop: 8 }}>
              No campaigns in the chosen window
            </h2>
            <p className="v-body" style={{ marginTop: 10 }}>
              Either the ad account has no historical campaigns, or the sync
              hasn&apos;t run yet. Trigger one with{' '}
              <code style={{ fontFamily: 'var(--v-mono)' }}>
                POST /admin/ca/ads/sync/{id}
              </code>
              .
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 20,
                marginBottom: 28,
              }}
            >
              <Kpi
                label="Spend"
                value={formatMoney(accountRow.spend, currency)}
                kind="mint"
              />
              <Kpi
                label="Impressions"
                value={fmtNumber(accountRow.impressions ?? 0)}
                kind="outline"
              />
              <Kpi
                label="Reach"
                value={fmtNumber(accountRow.reach ?? 0)}
                kind="outline"
              />
              <Kpi
                label="CTR"
                value={
                  accountRow.ctr != null ? `${accountRow.ctr.toFixed(2)}%` : '—'
                }
                kind="uv"
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 20,
                marginBottom: 40,
              }}
            >
              <Kpi
                label="Clicks"
                value={fmtNumber(accountRow.clicks ?? 0)}
                kind="outline"
              />
              <Kpi
                label="CPM"
                value={formatMoney(accountRow.cpm, currency)}
                kind="outline"
              />
              <Kpi
                label="CPC"
                value={formatMoney(accountRow.cpc, currency)}
                kind="outline"
              />
              <Kpi
                label="Frequency"
                value={
                  accountRow.frequency != null
                    ? accountRow.frequency.toFixed(2)
                    : '—'
                }
                kind="outline"
              />
            </div>

            {campaigns.length > 0 && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  <span className="v-kicker mint">Breakdown</span>
                  <span className="v-eyebrow" style={{ color: '#fff' }}>
                    Per campaign
                  </span>
                  <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
                </div>
                <div
                  style={{
                    border: '1px solid #ffffff',
                    borderRadius: 16,
                    overflow: 'hidden',
                    background: '#131313',
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontFamily: 'var(--v-mono)',
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr style={{ background: 'rgba(60,255,208,0.08)' }}>
                        <Th>Campaign</Th>
                        <Th>Spend</Th>
                        <Th>Impressions</Th>
                        <Th>Reach</Th>
                        <Th>Clicks</Th>
                        <Th>CTR</Th>
                        <Th>CPM</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr
                          key={`${c.campaign_id}-${c.date_start}`}
                          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          <Td>
                            <span style={{ color: '#fff' }}>
                              {c.campaign_name ?? c.campaign_id}
                            </span>
                          </Td>
                          <Td>{formatMoney(c.spend, currency)}</Td>
                          <Td>{fmtNumber(c.impressions ?? 0)}</Td>
                          <Td>{fmtNumber(c.reach ?? 0)}</Td>
                          <Td>{fmtNumber(c.clicks ?? 0)}</Td>
                          <Td>{c.ctr != null ? `${c.ctr.toFixed(2)}%` : '—'}</Td>
                          <Td>{formatMoney(c.cpm, currency)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div
              style={{
                marginTop: 24,
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                color: 'var(--v-text-muted)',
              }}
            >
              Captured <RelativeTime value={accountRow.captured_at} /> · Account{' '}
              {accountRow.ad_account_name ?? accountRow.ad_account_id}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function Kpi({
  label,
  value,
  kind,
}: {
  label: string;
  value: string;
  kind: 'outline' | 'mint' | 'uv';
}) {
  const isMint = kind === 'mint';
  const isUv = kind === 'uv';
  return (
    <div
      style={{
        padding: 22,
        borderRadius: 18,
        border: '1px solid #ffffff',
        background: isMint
          ? 'linear-gradient(135deg, rgba(60,255,208,0.18) 0%, rgba(19,19,19,0.6) 100%)'
          : isUv
            ? 'linear-gradient(135deg, rgba(82,0,255,0.22) 0%, rgba(19,19,19,0.6) 100%)'
            : '#131313',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--v-text-muted)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--v-display)',
          fontSize: 28,
          color: '#fff',
          letterSpacing: '0.02em',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '10px 14px',
        fontFamily: 'var(--v-mono)',
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--v-text-muted)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '12px 14px', color: 'var(--v-text-muted)' }}>
      {children}
    </td>
  );
}
