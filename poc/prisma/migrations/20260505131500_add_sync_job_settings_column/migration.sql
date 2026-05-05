-- AlterTable: add settings JSON column to sync_jobs
ALTER TABLE `sync_jobs` ADD COLUMN `settings` JSON NULL;
