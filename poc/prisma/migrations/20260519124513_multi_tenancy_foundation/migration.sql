-- Multi-tenancy foundation.
--
-- 1. Create the SaaS surface tables (workspaces, api_keys, workspace_secrets,
--    webhook_endpoints, webhook_deliveries).
-- 2. Backfill existing accounts onto an auto-created "demo" workspace.
-- 3. Promote accounts.workspace_id to NOT NULL and swap the unique key
--    from (platform, canonical_user_id) to (workspace_id, platform,
--    canonical_user_id) so two distinct workspaces can hold the same
--    platform handle independently.
--
-- WorkspaceSecret rows are created at runtime by the workspaces.service
-- bootstrap; we do not seed one here because the ciphertext requires
-- access to LOCAL_AES_KEY and the AesLocalService, neither of which is
-- reachable from a SQL-only migration.

-- ─── New tables ────────────────────────────────────────────────────────────

CREATE TABLE `workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `branding` JSON NULL,
    `plan_tier` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `workspaces_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `workspace_id` VARCHAR(191) NOT NULL,
    `key_prefix` VARCHAR(191) NOT NULL,
    `key_hash` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'read_write',
    `label` VARCHAR(191) NULL,
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    INDEX `api_keys_workspace_id_idx`(`workspace_id`),
    INDEX `api_keys_key_prefix_idx`(`key_prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace_secrets` (
    `id` VARCHAR(191) NOT NULL,
    `workspace_id` VARCHAR(191) NOT NULL,
    `secret_ciphertext` LONGBLOB NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rotated_at` DATETIME(3) NULL,
    UNIQUE INDEX `workspace_secrets_workspace_id_key`(`workspace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_endpoints` (
    `id` VARCHAR(191) NOT NULL,
    `workspace_id` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `events` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `webhook_endpoints_workspace_id_idx`(`workspace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `endpoint_id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `last_response_code` INTEGER NULL,
    `last_error` TEXT NULL,
    `next_retry_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,
    INDEX `webhook_deliveries_endpoint_id_status_idx`(`endpoint_id`, `status`),
    INDEX `webhook_deliveries_status_next_retry_at_idx`(`status`, `next_retry_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Seed the "demo" workspace so existing accounts can be backfilled ─────

INSERT IGNORE INTO `workspaces` (
    `id`,
    `slug`,
    `name`,
    `branding`,
    `plan_tier`,
    `created_at`,
    `updated_at`
) VALUES (
    'wkspc_demo',
    'demo',
    'Demo Workspace',
    NULL,
    'standard',
    NOW(3),
    NOW(3)
);

-- ─── accounts.workspace_id: add nullable, backfill, then promote NOT NULL ─

ALTER TABLE `accounts` ADD COLUMN `workspace_id` VARCHAR(191) NULL;
ALTER TABLE `accounts` ADD COLUMN `end_user_id` VARCHAR(191) NULL;

UPDATE `accounts` SET `workspace_id` = 'wkspc_demo' WHERE `workspace_id` IS NULL;

ALTER TABLE `accounts` MODIFY COLUMN `workspace_id` VARCHAR(191) NOT NULL;

-- ─── Swap unique key + add indexes ────────────────────────────────────────

DROP INDEX `accounts_platform_canonical_user_id_key` ON `accounts`;

CREATE UNIQUE INDEX `accounts_workspace_id_platform_canonical_user_id_key`
    ON `accounts`(`workspace_id`, `platform`, `canonical_user_id`);

CREATE INDEX `accounts_workspace_id_platform_idx`
    ON `accounts`(`workspace_id`, `platform`);

CREATE INDEX `accounts_workspace_id_end_user_id_idx`
    ON `accounts`(`workspace_id`, `end_user_id`);

-- ─── Foreign keys ─────────────────────────────────────────────────────────

ALTER TABLE `accounts`
    ADD CONSTRAINT `accounts_workspace_id_fkey`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `api_keys`
    ADD CONSTRAINT `api_keys_workspace_id_fkey`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_secrets`
    ADD CONSTRAINT `workspace_secrets_workspace_id_fkey`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `webhook_endpoints`
    ADD CONSTRAINT `webhook_endpoints_workspace_id_fkey`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `webhook_deliveries`
    ADD CONSTRAINT `webhook_deliveries_endpoint_id_fkey`
    FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
