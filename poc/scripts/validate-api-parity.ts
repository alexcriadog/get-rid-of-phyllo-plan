/**
 * Golden-diff our InsightIQ-compatible API against LIVE InsightIQ for the same
 * creator (PLAN-canonical-data-api.md, Phase 4). For each resource it
 * asserts our response carries EVERY key InsightIQ returns (additive keys are
 * fine; missing ones are reported).
 *
 * Env:
 *   VENDOR_BASE        e.g. https://api.staging.insightiq.ai
 *   VENDOR_CLIENT_ID / VENDOR_CLIENT_SECRET
 *   VENDOR_ACCOUNT_ID  account id on InsightIQ's side
 *   OURS_BASE          e.g. http://localhost:3000   (mounts /v1/*)
 *   OURS_CLIENT_ID / OURS_CLIENT_SECRET
 *   OURS_ACCOUNT_ID    the SAME creator's account id on our side
 *
 * Usage:
 *   cd poc && npx ts-node scripts/validate-api-parity.ts
 */
type Json = Record<string, unknown>;

function basic(id: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function get(base: string, path: string, auth: string): Promise<Json> {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as Json;
}

function keyType(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Report keys present in `expected` (InsightIQ) but missing in `actual` (ours).
function missing(expected: unknown, actual: unknown, path = ''): string[] {
  const out: string[] = [];
  if (keyType(expected) === 'object') {
    if (keyType(actual) !== 'object') { out.push(`${path || '<root>'}: not an object on our side`); return out; }
    const eo = expected as Json, ao = actual as Json;
    for (const k of Object.keys(eo)) {
      if (!(k in ao)) { out.push(`${path}${k}`); continue; }
      out.push(...missing(eo[k], ao[k], `${path}${k}.`));
    }
  } else if (keyType(expected) === 'array') {
    const ea = expected as unknown[], aa = (actual as unknown[]) ?? [];
    if (ea.length && keyType(ea[0]) === 'object' && aa.length) out.push(...missing(ea[0], aa[0], `${path}[].`));
  }
  return out;
}

function first(env: Json): Json {
  const data = env.data;
  return Array.isArray(data) && data.length > 0 ? (data[0] as Json) : (env as Json);
}

async function main(): Promise<void> {
  const P = process.env;
  const need = ['VENDOR_BASE', 'VENDOR_CLIENT_ID', 'VENDOR_CLIENT_SECRET', 'VENDOR_ACCOUNT_ID', 'OURS_BASE', 'OURS_CLIENT_ID', 'OURS_CLIENT_SECRET', 'OURS_ACCOUNT_ID'];
  const miss = need.filter((k) => !P[k]);
  if (miss.length) { console.error('Missing env:', miss.join(', ')); process.exit(1); }

  const pAuth = basic(P.VENDOR_CLIENT_ID!, P.VENDOR_CLIENT_SECRET!);
  const oAuth = basic(P.OURS_CLIENT_ID!, P.OURS_CLIENT_SECRET!);
  const pAcc = P.VENDOR_ACCOUNT_ID!, oAcc = P.OURS_ACCOUNT_ID!;

  const checks: Array<{ name: string; pPath: string; oPath: string }> = [
    { name: 'profile', pPath: `/v1/profiles?account_id=${pAcc}`, oPath: `/v1/profiles?account_id=${oAcc}` },
    { name: 'content', pPath: `/v1/social/contents?account_id=${pAcc}&limit=1`, oPath: `/v1/social/contents?account_id=${oAcc}&limit=1` },
    { name: 'audience', pPath: `/v1/audience?account_id=${pAcc}`, oPath: `/v1/audience?account_id=${oAcc}` },
  ];

  let failed = 0;
  for (const c of checks) {
    try {
      const [pj, oj] = await Promise.all([
        get(P.VENDOR_BASE!, c.pPath, pAuth),
        get(P.OURS_BASE!, c.oPath, oAuth),
      ]);
      const m = missing(c.name === 'audience' ? pj : first(pj), c.name === 'audience' ? oj : first(oj));
      if (m.length === 0) {
        console.log(`✓ ${c.name}: parity OK (every InsightIQ key present)`);
      } else {
        failed++;
        console.log(`✗ ${c.name}: ${m.length} missing key(s):`);
        for (const k of m) console.log(`    - ${k}`);
      }
    } catch (err) {
      failed++;
      console.log(`✗ ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(failed === 0 ? '\nPARITY PASS' : `\nPARITY FAIL (${failed} resource(s))`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
