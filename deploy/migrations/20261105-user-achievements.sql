-- Permanent wallet achievements. The catalog lives in src/config/achievements.js.
-- Rules only insert facts; only rows granted by an admin may be revoked.
CREATE TABLE IF NOT EXISTS user_achievements (
  wallet_address VARCHAR(42) NOT NULL,
  achievement_id VARCHAR(48) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT '',
  source ENUM('rule','admin') NOT NULL,
  granted_by VARCHAR(42) NULL,
  note VARCHAR(255) NULL,
  awarded_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address, achievement_id, scope),
  KEY idx_achievement (achievement_id, scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- The achievement displayed beside a wallet's name. Deleting clears the feature.
CREATE TABLE IF NOT EXISTS user_featured_achievement (
  wallet_address VARCHAR(42) NOT NULL,
  achievement_id VARCHAR(48) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT '',
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
