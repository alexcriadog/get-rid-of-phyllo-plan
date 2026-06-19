-- Append-only history of every OAuth token sealed for an account (on connect
-- and on each refresh). Deliberately has NO foreign key to `accounts`, so it
-- SURVIVES account deletion/overwrite — it is the break-glass recovery store.
-- Tokens stay encrypted (same AES-256-GCM bytes as `oauth_tokens`); `key_version`
-- records which active key sealed each row so a retiring key can be re-sealed
-- before it is dropped from the keyring.
CREATE TABLE `oauth_token_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT NOT NULL,
    `canonical_user_id` VARCHAR(191) NULL,
    `platform` VARCHAR(191) NULL,
    `connection_flow` VARCHAR(191) NULL,
    `access_token_ciphertext` LONGBLOB NOT NULL,
    `user_access_token_ciphertext` LONGBLOB NULL,
    `refresh_token_ciphertext` LONGBLOB NULL,
    `scopes` JSON NULL,
    `expires_at` DATETIME(3) NULL,
    `key_version` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oauth_token_history_canonical_idx`(`canonical_user_id`, `platform`, `connection_flow`, `captured_at`),
    INDEX `oauth_token_history_account_idx`(`account_id`, `captured_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
