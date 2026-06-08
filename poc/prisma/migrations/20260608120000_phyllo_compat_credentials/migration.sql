-- Basic-auth credentials for the Phyllo-compatible read API
-- (PLAN-phyllo-schema-alignment.md, Phase 2).
CREATE TABLE `phyllo_compat_credentials` (
  `id` VARCHAR(191) NOT NULL,
  `workspace_id` VARCHAR(191) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `client_secret_hash` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NULL,
  `last_used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `phyllo_compat_credentials_client_id_key`(`client_id`),
  INDEX `phyllo_compat_credentials_workspace_id_idx`(`workspace_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `phyllo_compat_credentials`
  ADD CONSTRAINT `phyllo_compat_credentials_workspace_id_fkey`
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
