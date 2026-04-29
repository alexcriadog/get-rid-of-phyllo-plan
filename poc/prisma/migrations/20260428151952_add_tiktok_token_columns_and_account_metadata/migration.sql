-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `metadata` JSON NULL;

-- AlterTable
ALTER TABLE `oauth_tokens` ADD COLUMN `refresh_token_ciphertext` LONGBLOB NULL;
