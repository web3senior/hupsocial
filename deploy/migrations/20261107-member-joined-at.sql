-- First connection observed by Hup, independent of indexer profile creation.
-- UTC DATETIME matches the leaderboard UTC rolling-window boundary.
-- No backfill: created_at and last_seen_at are also written by profile indexers,
-- and cannot establish when a wallet first connected to Hup. Existing wallets
-- without a reliable join record receive their first observed connection date.
-- Both all-time and recent member counts require a recorded Hup connection.
-- Apply before deployment to enable tracking immediately. Safe to re-run (MariaDB).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS joined_at DATETIME NULL DEFAULT NULL
    COMMENT 'First Hup wallet connection observed in UTC';

CREATE INDEX IF NOT EXISTS idx_users_joined_at ON users (joined_at);
