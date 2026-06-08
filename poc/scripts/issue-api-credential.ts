/**
 * Issues a InsightIQ-compatible Basic-auth credential (client_id + client_secret)
 * for a workspace. The secret is shown ONCE.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/issue-the standard API-credential.ts <workspace-slug-or-id> [label]
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const arg = process.argv[2];
  const label = process.argv[3] ?? null;
  if (!arg) {
    console.error('Usage: issue-the standard API-credential.ts <workspace-slug-or-id> [label]');
    process.exit(1);
  }
  const ws =
    (await prisma.workspace.findUnique({ where: { slug: arg } })) ??
    (await prisma.workspace.findUnique({ where: { id: arg } }));
  if (!ws) {
    console.error(`Workspace not found: ${arg}`);
    process.exit(1);
  }
  const clientId = `ciqk_${randomBytes(12).toString('hex')}`;
  const clientSecret = `ciqs_${randomBytes(24).toString('base64url')}`;
  await prisma.apiCredential.create({
    data: {
      workspaceId: ws.id,
      clientId,
      clientSecretHash: createHash('sha256').update(clientSecret, 'utf8').digest('hex'),
      label,
    },
  });
  console.log('InsightIQ-compatible credential issued (store the secret now — shown once):');
  console.log(`  workspace:     ${ws.slug} (${ws.id})`);
  console.log(`  CLIENT_ID:     ${clientId}`);
  console.log(`  CLIENT_SECRET: ${clientSecret}`);
  console.log(`  BASE_URL:      https://<connector-host>`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
