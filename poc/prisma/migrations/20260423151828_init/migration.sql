-- CreateTable
CREATE TABLE `accounts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `platform` VARCHAR(191) NOT NULL,
    `canonical_user_id` VARCHAR(191) NOT NULL,
    `handle` VARCHAR(191) NULL,
    `display_name` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
    `sync_tier` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `owning_organization_id` VARCHAR(191) NOT NULL DEFAULT 'demo',
    `connected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `disconnected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_platform_canonical_user_id_key`(`platform`, `canonical_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT NOT NULL,
    `access_token_ciphertext` LONGBLOB NOT NULL,
    `scopes` JSON NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `last_refreshed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_tokens_account_id_key`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT NOT NULL,
    `product` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'idle',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `next_run_at` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `last_attempt_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `failure_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sync_jobs_status_next_run_at_idx`(`status`, `next_run_at`),
    UNIQUE INDEX `sync_jobs_account_id_product_key`(`account_id`, `product`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cadences` (
    `platform` VARCHAR(191) NOT NULL,
    `product` VARCHAR(191) NOT NULL,
    `default_interval_seconds` INTEGER NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`platform`, `product`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_cadences` (
    `account_id` BIGINT NOT NULL,
    `product` VARCHAR(191) NOT NULL,
    `override_interval_seconds` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,

    PRIMARY KEY (`account_id`, `product`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inbound_webhook_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `platform` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signature_valid` BOOLEAN NOT NULL,
    `account_resolved` BOOLEAN NOT NULL DEFAULT false,
    `payload_snippet` TEXT NULL,
    `processed` BOOLEAN NOT NULL DEFAULT false,

    INDEX `inbound_webhook_log_received_at_idx`(`received_at`),
    UNIQUE INDEX `inbound_webhook_log_platform_event_id_key`(`platform`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_call_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `platform` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `status_code` INTEGER NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `rate_bucket_key` VARCHAR(191) NULL,
    `tokens_before` INTEGER NULL,
    `tokens_after` INTEGER NULL,
    `usage_header` JSON NULL,
    `account_id` BIGINT NULL,
    `called_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_call_log_called_at_idx`(`called_at`),
    INDEX `api_call_log_platform_called_at_idx`(`platform`, `called_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `oauth_tokens` ADD CONSTRAINT `oauth_tokens_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_cadences` ADD CONSTRAINT `account_cadences_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
