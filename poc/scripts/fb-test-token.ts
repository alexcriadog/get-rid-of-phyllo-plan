/**
 * Probe FB Page demographic metrics with an arbitrary access token (User
 * or Page) passed as argv. Useful to A/B-test whether the demographics
 * unlock with a different token type / scope set without touching the DB.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/fb-test-token.ts <token> <page_id>
 */
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v22.0';

async function go(label: string, url: string, params: Record<string, string>, raw = false): Promise<void> {
  const r = await axios.get(url, { params, validateStatus: () => true, timeout: 15_000 });
  if (r.status >= 200 && r.status < 300) {
    if (raw) {
      console.log(`OK  ${label}\n${JSON.stringify(r.data, null, 2).slice(0, 1500)}\n`);
      return;
    }
    const data = r.data?.data ?? r.data;
    let preview: string;
    if (Array.isArray(data)) {
      preview = data.map((d: { name?: string; values?: Array<{ value: unknown }> }) => {
        const last = d.values?.[d.values.length - 1]?.value;
        const v = typeof last === 'object' ? JSON.stringify(last).slice(0, 240) : String(last);
        return `${d.name}=${v}`;
      }).join(' | ');
    } else preview = JSON.stringify(data).slice(0, 320);
    console.log(`OK  ${label}\n    ${preview}\n`);
  } else {
    const e = r.data?.error;
    console.log(`ERR ${label}: ${e?.code ? '#' + e.code : ''} ${e?.message ?? JSON.stringify(r.data).slice(0, 240)}\n`);
  }
}

async function main(): Promise<void> {
  const token = process.argv[2];
  const pageId = process.argv[3];
  if (!token || !pageId) {
    console.error('Usage: ts-node scripts/fb-test-token.ts <token> <page_id>');
    process.exit(1);
  }

  console.log('=== Token introspection ===');
  await go('/me', `${GRAPH}/me`, { access_token: token });
  await go('/me/permissions (granted scopes)', `${GRAPH}/me/permissions`, { access_token: token }, true);
  await go('/me/accounts (User token only)', `${GRAPH}/me/accounts`, { fields: 'name,id,tasks', access_token: token }, true);
  await go('/me/businesses (needs business_management)', `${GRAPH}/me/businesses`, { fields: 'id,name', access_token: token }, true);
  await go('/me/adaccounts (needs ads_read)', `${GRAPH}/me/adaccounts`, { fields: 'name,id', access_token: token });

  console.log('=== Demographic Page Insights ===');
  for (const m of ['page_fans_country', 'page_fans_gender_age', 'page_fans_city', 'page_fans_locale']) {
    await go(`${m}/lifetime`, `${GRAPH}/${pageId}/insights`, { metric: m, period: 'lifetime', access_token: token });
  }
  for (const m of ['page_followers_country', 'page_followers_gender_age', 'page_followers_city']) {
    await go(`${m}/lifetime`, `${GRAPH}/${pageId}/insights`, { metric: m, period: 'lifetime', access_token: token });
  }

  console.log('=== Sanity check (should always work) ===');
  await go('page_follows/day', `${GRAPH}/${pageId}/insights`, {
    metric: 'page_follows', period: 'day',
    since: String(Math.floor(Date.now() / 1000) - 7 * 86_400),
    until: String(Math.floor(Date.now() / 1000)),
    access_token: token,
  });

  console.log('=== Marketing API via business_management ===');
  // Discover the user's businesses, then their owned/client ad accounts.
  const businessRes = await axios.get(`${GRAPH}/me/businesses`, {
    params: { fields: 'id,name', access_token: token },
    validateStatus: () => true,
  });
  const businesses = (businessRes.data?.data ?? []) as Array<{ id: string; name: string }>;
  for (const b of businesses) {
    console.log(`-- business ${b.id} (${b.name}) --`);
    await go(`/${b.id}/owned_ad_accounts`, `${GRAPH}/${b.id}/owned_ad_accounts`, { fields: 'id,account_id,name,account_status', access_token: token }, true);
    await go(`/${b.id}/client_ad_accounts`, `${GRAPH}/${b.id}/client_ad_accounts`, { fields: 'id,account_id,name,account_status', access_token: token }, true);
    await go(`/${b.id}/owned_pages`, `${GRAPH}/${b.id}/owned_pages`, { fields: 'id,name', access_token: token }, true);
  }

  // Direct Marketing-API-style probe — requires we know an act_id, but try
  // our best with what /me/businesses gave us.
  console.log('=== Marketing API style insights (if any ad account found) ===');
  for (const b of businesses) {
    const adRes = await axios.get(`${GRAPH}/${b.id}/owned_ad_accounts`, {
      params: { fields: 'id,account_id,name', access_token: token },
      validateStatus: () => true,
    });
    const accounts = (adRes.data?.data ?? []) as Array<{ id: string; account_id: string; name: string }>;
    for (const acc of accounts) {
      console.log(`-- ad account ${acc.id} (${acc.name}) --`);
      await go(
        `act insights breakdowns=country last_30d`,
        `${GRAPH}/${acc.id}/insights`,
        { fields: 'reach,impressions', breakdowns: 'country', date_preset: 'last_30d', access_token: token },
        true,
      );
    }
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
