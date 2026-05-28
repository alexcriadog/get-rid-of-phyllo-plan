-- Phase D of the webhooks plan: capture the response of the last delivery
-- attempt so admins can debug why a client endpoint rejected a webhook.
--
-- All three columns are nullable + additive — existing rows stay valid;
-- the worker (outbound-webhooks.service.ts handleDelivery) populates them
-- going forward.

ALTER TABLE `webhook_deliveries`
  ADD COLUMN `response_body` TEXT NULL,
  ADD COLUMN `response_headers` JSON NULL,
  ADD COLUMN `duration_ms` INT NULL;
