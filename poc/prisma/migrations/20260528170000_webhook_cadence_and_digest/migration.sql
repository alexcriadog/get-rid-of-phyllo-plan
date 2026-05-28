-- Phase A of the data-webhooks plan.
--
-- Two additive changes:
--   1. workspaces.webhook_cadence — operator-set per-product delivery
--      cadence ("immediate" | "hourly" | "daily"). NULL → all products
--      default to "immediate".
--   2. pending_webhook_events — digest buffer. The sync worker upserts
--      into it when a sync produces new items AND the workspace's cadence
--      for that product is hourly/daily. The cron in
--      webhooks-digest.service.ts flushes and emits aggregated events.
--
-- Zero-downtime: nullable column + new table. Existing rows / endpoints
-- continue working unchanged (all behave as if cadence='immediate' until
-- the operator configures otherwise from /admin/workspaces/[slug]).

ALTER TABLE `workspaces` ADD COLUMN `webhook_cadence` JSON NULL;

CREATE TABLE `pending_webhook_events` (
  `id` VARCHAR(191) NOT NULL,
  `endpoint_id` VARCHAR(191) NOT NULL,
  `account_id` BIGINT NOT NULL,
  `product` VARCHAR(191) NOT NULL,
  `cadence` VARCHAR(191) NOT NULL,
  `items_added` INTEGER NOT NULL DEFAULT 0,
  `sample_ids` JSON NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `pending_webhook_events_endpoint_id_account_id_product_key`
    (`endpoint_id`, `account_id`, `product`),
  INDEX `pending_webhook_events_cadence_first_seen_at_idx`
    (`cadence`, `first_seen_at`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pending_webhook_events`
  ADD CONSTRAINT `pending_webhook_events_endpoint_id_fkey`
  FOREIGN KEY (`endpoint_id`)
    REFERENCES `webhook_endpoints`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
