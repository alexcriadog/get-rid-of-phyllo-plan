-- Phase C of the per-workspace scope reduction plan: make
-- `workspaces.products` NOT NULL. Self-contained — the UPDATE backfills
-- every still-null row with the full PLATFORM_CATALOG (preserving the
-- previous "unrestricted = full scopes" behaviour) before the ALTER tightens
-- the constraint.
--
-- MySQL applies DDL with implicit commit per statement, so if the ALTER
-- fails for any reason the UPDATE is already durable and re-running the
-- migration is safe (the UPDATE becomes a no-op on second run).
--
-- The JSON literal mirrors PRODUCTS_BY_PLATFORM in
-- poc/src/modules/accounts/products.catalog.ts. If you add a new product
-- to the catalog later, existing workspaces aren't auto-updated — that's
-- intentional, an admin must opt them in via /admin/workspaces/:slug/products.

UPDATE `workspaces`
SET `products` = '{"facebook":["identity","audience","engagement_new","stories","mentions","comments","ratings","ads"],"instagram":["identity","audience","engagement_new","stories"],"tiktok":["identity","audience","engagement_new","comments"],"threads":["identity","audience","engagement_new","comments","mentions"],"youtube":["identity","audience","engagement_new","engagement_deep","comments","ads"],"twitch":["identity","engagement_new"]}'
WHERE `products` IS NULL;

ALTER TABLE `workspaces` MODIFY `products` JSON NOT NULL;
