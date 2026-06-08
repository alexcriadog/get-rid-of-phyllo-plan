/**
 * Registers a Phyllo-format outbound webhook endpoint for a workspace
 * (PLAN-phyllo-schema-alignment.md, Phase 3/4 cutover). The consumer keeps
 * its existing receiver URL; we deliver Phyllo-compatible thin events to it
 * signed with the `Webhook-Signatures` header.
 *
 * Subscribes to every Phyllo event by default.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/register-phyllo-endpoint.ts <workspace-slug-or-id> <https-url>
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ALL_PHYLLO_EVENTS } from '../src/modules/outbound-webhooks/phyllo-webhook-events';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const arg = process.argv[2];
  const url = process.argv[3];
  if (!arg || !url) {
    console.error('Usage: register-phyllo-endpoint.ts <workspace-slug-or-id> <https-url>');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(url)) {
    console.error('URL must start with http(s)://');
    process.exit(1);
  }
  const ws =
    (await prisma.workspace.findUnique({ where: { slug: arg } })) ??
    (await prisma.workspace.findUnique({ where: { id: arg } }));
  if (!ws) { console.error(`Workspace not found: ${arg}`); process.exit(1); }

  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const ep = await prisma.webhookEndpoint.create({
    data: {
      workspaceId: ws.id,
      url,
      secret,
      events: ALL_PHYLLO_EVENTS as unknown as object,
      format: 'phyllo',
      description: 'Phyllo-compatible thin webhooks',
    },
  });
  console.log('Phyllo-format webhook endpoint registered:');
  console.log(`  workspace: ${ws.slug} (${ws.id})`);
  console.log(`  endpoint:  ${ep.id}`);
  console.log(`  url:       ${url}`);
  console.log(`  events:    ${ALL_PHYLLO_EVENTS.join(', ')}`);
  console.log(`  SECRET:    ${secret}   (verify Webhook-Signatures = HMAC-SHA256(secret, rawBody))`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
