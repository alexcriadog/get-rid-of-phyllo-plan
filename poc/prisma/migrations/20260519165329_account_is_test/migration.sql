-- Sandbox flag for accounts seeded via cmlk_test_* SDK tokens.
-- Idempotent default = false, no backfill needed.

ALTER TABLE `accounts` ADD COLUMN `is_test` BOOLEAN NOT NULL DEFAULT false;
