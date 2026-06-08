-- Phyllo-compatible webhook format flag (PLAN-phyllo-schema-alignment.md, Phase 3).
ALTER TABLE `webhook_endpoints`
  ADD COLUMN `format` VARCHAR(191) NOT NULL DEFAULT 'camaleonic';
