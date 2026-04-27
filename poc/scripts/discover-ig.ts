/**
 * Discovers Instagram Business account IDs from a Meta access token.
 *
 * Usage:
 *   IG_TOKEN="<your_token>" npx ts-node scripts/discover-ig.ts
 *
 * Or via npm script:
 *   IG_TOKEN="<your_token>" npm run discover:ig
 *
 * Prints the exact env vars you need to seed an account.
 */
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v22.0';

async function main(): Promise<void> {
  const token = process.env.IG_TOKEN ?? process.env.SEED_IG_TOKEN;
  if (!token) {
    console.error('Missing IG_TOKEN env var.');
    console.error('Usage: IG_TOKEN="<your_token>" npm run discover:ig');
    process.exit(1);
  }

  console.log('Fetching Pages + linked IG Business accounts from Meta…\n');

  // 1. List Pages this token can access
  const pages = await axios.get(`${GRAPH}/me/accounts`, {
    params: {
      fields: 'id,name,access_token,instagram_business_account{id,username,name}',
      access_token: token,
    },
  });

  const data: Array<{
    id: string;
    name: string;
    access_token?: string;
    instagram_business_account?: { id: string; username: string; name?: string };
  }> = pages.data?.data ?? [];

  if (data.length === 0) {
    // Maybe it's a Page token directly — try /me
    console.log('No Pages returned via /me/accounts. Trying /me (token may be a Page token)…\n');
    const me = await axios.get(`${GRAPH}/me`, {
      params: {
        fields: 'id,name,instagram_business_account{id,username,name}',
        access_token: token,
      },
    });
    if (me.data?.instagram_business_account) {
      printBlock(me.data.id, me.data.name, me.data.instagram_business_account);
      return;
    }
    console.error('No Pages + no IG Business linked. Verify:');
    console.error('  • Token has scopes: pages_show_list + instagram_basic + business_management');
    console.error('  • Your IG account is Business/Creator and linked to a FB Page');
    process.exit(1);
  }

  const withIg = data.filter((p) => p.instagram_business_account);

  if (withIg.length === 0) {
    console.error('Pages found, but none have a linked IG Business account:');
    for (const p of data) {
      console.error(`  - "${p.name}" (page_id=${p.id}) — no IG Business linked`);
    }
    console.error('\nFix: open Instagram → Settings → Account → Linked Accounts → Facebook.');
    process.exit(1);
  }

  console.log(`Found ${withIg.length} Page(s) with linked IG Business account:\n`);
  for (const p of withIg) {
    printBlock(p.id, p.name, p.instagram_business_account!);
  }

  if (withIg.length === 1) {
    const p = withIg[0];
    console.log('---\nReady-to-run seed command (copy-paste this):\n');
    console.log(
      `SEED_IG_TOKEN="<paste your token here>" \\\n` +
        `SEED_IG_BUSINESS_ID="${p.instagram_business_account!.id}" \\\n` +
        `SEED_IG_HANDLE="@${p.instagram_business_account!.username}" \\\n` +
        `SEED_IG_PAGE_ID="${p.id}" \\\n` +
        `npm run seed\n`,
    );
  } else {
    console.log(
      '---\nMultiple accounts. Pick one and build the seed command with its values.',
    );
  }
}

function printBlock(
  pageId: string,
  pageName: string,
  ig: { id: string; username: string; name?: string },
): void {
  console.log(`Facebook Page: "${pageName}"`);
  console.log(`   SEED_IG_PAGE_ID="${pageId}"`);
  console.log(`Instagram Business: "${ig.name ?? ig.username}" (@${ig.username})`);
  console.log(`   SEED_IG_BUSINESS_ID="${ig.id}"`);
  console.log(`   SEED_IG_HANDLE="@${ig.username}"`);
  console.log('');
}

main().catch((err) => {
  if (axios.isAxiosError(err) && err.response) {
    console.error(`Graph API error (HTTP ${err.response.status}):`);
    console.error(JSON.stringify(err.response.data, null, 2));
  } else {
    console.error('Unexpected error:', err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
