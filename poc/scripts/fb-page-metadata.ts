/**
 * One-shot: dump full /{page_id}?metadata=1 to see every field/edge Meta
 * exposes on the Page object. Useful to spot any audience-shaped field we
 * might have missed (audience_distribution, fan_country_distribution, etc.).
 *
 * Run from poc/:
 *   npx ts-node -r tsconfig-paths/register scripts/fb-page-metadata.ts <account_id>
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const GRAPH = 'https://graph.facebook.com/v22.0';

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function decrypt(buf: Buffer): string {
  const key = Buffer.from(process.env.LOCAL_AES_KEY!, 'hex');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  try {
    const a = await prisma.account.findUnique({ where: { id: BigInt(process.argv[2] ?? '0') }, include: { tokens: true } });
    if (!a) { console.error('account not found'); return; }
    const token = decrypt(Buffer.from(a.tokens[0].accessTokenCiphertext));
    const r = await axios.get(`${GRAPH}/${a.canonicalUserId}`, {
      params: { metadata: '1', access_token: token },
      validateStatus: () => true,
    });
    if (r.status !== 200) { console.error('status', r.status, r.data); return; }
    const meta = r.data?.metadata ?? {};
    const fields = (meta.fields ?? []) as Array<{ name: string; description: string; type: string }>;
    const conns = meta.connections ?? {};
    console.log(`-- ${fields.length} fields on Page object --`);
    for (const f of fields) {
      const audienceShaped = /audience|fan|follower|demographic|country|gender|age|city|locale/i.test(f.name + ' ' + (f.description || ''));
      if (audienceShaped) console.log(`  *  ${f.name}  (${f.type})  ${f.description?.slice(0, 80) ?? ''}`);
    }
    console.log(`-- connections (edges) --`);
    for (const [name, url] of Object.entries(conns)) {
      const audienceShaped = /audience|fan|follower|demographic|reach|insight/i.test(name);
      if (audienceShaped) console.log(`  *  ${name}  ${url}`);
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e); process.exit(1); });
