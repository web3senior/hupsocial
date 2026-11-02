-- Status moved offchain: one row per wallet, written through a signed message instead of the
-- HupStatus contract. Clearing a status deletes the row. The contracts stay deployed; cidex's
-- indexed `statuses` table is dropped by cidex/scripts/remove-hupstatus-sync.sql.
-- expires_at is unix seconds, NULL for a status that never clears.

CREATE TABLE IF NOT EXISTS user_statuses (
  wallet_address VARCHAR(42) NOT NULL,
  content VARCHAR(160) NOT NULL,
  period_hours SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at BIGINT UNSIGNED NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address),
  KEY idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
