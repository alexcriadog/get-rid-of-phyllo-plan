-- Partition accounts by end user: add `end_user_id` to the uniqueness key so the
-- SAME real platform account connected by two different end users (tenants/orgs)
-- gets its OWN row — independent token, sync, and apiAccountId — instead of the
-- second connect overwriting the first's `end_user_id` (last-write-wins).
--
-- Prefix lengths keep this 5-column index within MySQL's 3072-byte InnoDB key
-- limit (5 x VARCHAR(191) x 4 bytes would exceed it); the prefixes far exceed
-- real value lengths (canonical ids and `${orgId}_${platformId}` end users are
-- short), so uniqueness stays exact in practice.
--
-- Safe on live data: existing rows are already distinct on the first four
-- columns, so adding `end_user_id` to the key can never violate uniqueness.

DROP INDEX `accounts_ws_platform_canonical_flow_key` ON `accounts`;

CREATE UNIQUE INDEX `accounts_ws_platform_canonical_flow_euid_key`
  ON `accounts`(
    `workspace_id`(64),
    `platform`(32),
    `canonical_user_id`(128),
    `connection_flow`(32),
    `end_user_id`(128)
  );
