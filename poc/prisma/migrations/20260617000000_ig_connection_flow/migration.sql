-- Add the connection-flow discriminator so the SAME canonical Instagram
-- identity can coexist as two accounts (Instagram Login vs Facebook Login)
-- instead of the second connect overwriting the first.
ALTER TABLE `accounts`
  ADD COLUMN `connection_flow` VARCHAR(191) NOT NULL DEFAULT 'default';

-- Backfill existing Instagram rows from their stored oauth_flow metadata.
-- IG-direct rows carry metadata.oauth_flow='ig_direct'; every other Instagram
-- row was connected via Facebook Login.
UPDATE `accounts`
  SET `connection_flow` = 'ig_direct'
  WHERE `platform` = 'instagram'
    AND JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.oauth_flow')) = 'ig_direct';

UPDATE `accounts`
  SET `connection_flow` = 'fb_login'
  WHERE `platform` = 'instagram'
    AND `connection_flow` = 'default';

-- Swap the uniqueness key to include the connection flow.
DROP INDEX `accounts_workspace_id_platform_canonical_user_id_key` ON `accounts`;

CREATE UNIQUE INDEX `accounts_ws_platform_canonical_flow_key`
  ON `accounts`(`workspace_id`, `platform`, `canonical_user_id`, `connection_flow`);
