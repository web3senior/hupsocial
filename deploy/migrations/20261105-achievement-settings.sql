-- Admin overrides for the code-defined achievement catalog. Awards remain permanent.
CREATE TABLE IF NOT EXISTS achievement_settings (
  achievement_id VARCHAR(48) NOT NULL,
  settings JSON NOT NULL,
  updated_by VARCHAR(42) NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (achievement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
