-- Phase C: workspace.products → NOT NULL.
--
-- Run AFTER scripts/backfill-workspace-products.ts has converted every
-- null row to the full catalog. The ALTER below will fail if any row is
-- still null, so the script + this DDL must be sequenced:
--
--   1. npx ts-node -r tsconfig-paths/register scripts/backfill-workspace-products.ts
--   2. mysql -h <host> -u <user> -p <db> < scripts/sql/workspace-products-not-null.sql
--   3. cd poc && npx prisma migrate dev --create-only --name workspace_products_required
--      → prisma will detect the live DB has the column NOT NULL and generate
--      → an empty migration; commit it. Then flip schema.prisma:
--         products  Json?    →    products  Json
--      → and re-run prisma migrate dev (it'll be a no-op SQL-wise; the diff
--      → only affects the generated client types).
--   4. Drop the `config === null` fallback in:
--      - poc/src/modules/sdk-tokens/sdk-tokens.service.ts (G1 gate)
--      - connect-tool/lib/workspace-config.ts (helpers)
--      - connect-tool/app/api/oauth/[...slug]/route.ts (computeOAuthScopes
--        will no longer need the null branch)

-- Sanity: should print 0 before running the ALTER.
SELECT COUNT(*) AS still_null FROM workspaces WHERE products IS NULL;

ALTER TABLE workspaces MODIFY products JSON NOT NULL;
