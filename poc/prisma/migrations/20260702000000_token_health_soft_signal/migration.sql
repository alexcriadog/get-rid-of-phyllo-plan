-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `reauth_recommended_at` DATETIME(3) NULL,
    ADD COLUMN `data_access_expires_at` DATETIME(3) NULL,
    ADD COLUMN `last_probed_at` DATETIME(3) NULL;
