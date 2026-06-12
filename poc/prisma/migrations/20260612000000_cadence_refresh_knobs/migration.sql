-- Operator-tunable refresh knobs for the engagement-refresh feature.
--
-- Additive, nullable INTEGER columns on `cadences`, keyed per
-- (platform, product). Zero-downtime: existing rows read as NULL, which the
-- application treats as "no per-(platform,product) override -> fall back to
-- env/built-in defaults". Operators dial these in from the admin UI.
--
-- MySQL applies DDL with an implicit commit, so a re-run is safe — the
-- columns already exist and `migrate deploy` records this migration as applied.

-- AlterTable
ALTER TABLE `cadences` ADD COLUMN `refresh_interval_seconds` INTEGER NULL,
    ADD COLUMN `refresh_window_days` INTEGER NULL;
