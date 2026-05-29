-- Sec-4: per-workspace origin allow-list for SDK-token postMessage scoping.
--
-- Additive, nullable JSON column. Zero-downtime: existing rows read as NULL,
-- which the application treats as "no origin restriction" (the SDK-supplied
-- ?origin is trusted as-is, preserving current behaviour). Operators opt a
-- workspace into strict origin checking by setting the list via
-- PATCH /admin/workspaces/:slug/allowed-origins.
--
-- MySQL applies DDL with an implicit commit, so a re-run is safe — the column
-- already exists and `migrate deploy` records this migration as applied.

ALTER TABLE `workspaces` ADD COLUMN `allowed_origins` JSON NULL;
