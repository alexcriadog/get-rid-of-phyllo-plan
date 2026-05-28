/**
 * Backfills `workspaces.products` for every workspace that still has `null`.
 *
 * Phase C of the per-workspace scope reduction plan: before flipping the
 * column to NOT NULL we have to make sure no row is null. The previous
 * default ("null = no restriction = full catalog") gets baked in
 * explicitly so behaviour doesn't change for workspaces that never had
 * an admin tighten their products.
 *
 * Idempotent — only touches rows where products IS NULL. Log includes
 * the slug, before/after JSON, and a final tally.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/backfill-workspace-products.ts
 *   cd poc && DRY_RUN=1 npx ts-node -r tsconfig-paths/register scripts/backfill-workspace-products.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  PLATFORM_CATALOG,
  PLATFORM_IDS,
} from '../src/modules/accounts/products.catalog';

const prisma = new PrismaClient();

function fullProductsConfig(): Record<string, string[]> {
  return Object.fromEntries(
    PLATFORM_IDS.map((p) => [p, PLATFORM_CATALOG[p].map((def) => def.id)]),
  );
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const config = fullProductsConfig();

  const rows = await prisma.workspace.findMany({
    where: { products: { equals: Prisma.AnyNull } },
    select: { id: true, slug: true, name: true },
  });

  if (rows.length === 0) {
    console.log('[backfill] No workspaces with products=null — nothing to do.');
    return;
  }

  console.log(
    `[backfill] Found ${rows.length} workspace(s) with products=null. Setting each to the full catalog (preserves previous "unrestricted" behaviour).`,
  );

  let updated = 0;
  for (const ws of rows) {
    console.log(
      `[backfill] ${dryRun ? '(dry-run) ' : ''}workspace=${ws.slug} (id=${ws.id}, name=${JSON.stringify(ws.name)}) → ${JSON.stringify(config)}`,
    );
    if (!dryRun) {
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { products: config as Prisma.InputJsonValue },
      });
    }
    updated += 1;
  }

  console.log(
    `[backfill] Done. ${updated} workspace(s) ${dryRun ? 'would be updated (dry-run)' : 'updated'}.`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill] FATAL:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
