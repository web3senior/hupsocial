-- First connection observed by Hup, independent of indexer profile creation.
-- UTC DATETIME matches the leaderboard UTC rolling-window boundary.
-- created_at and last_seen_at are also written by profile indexers, so they cannot
-- establish when a wallet first connected to Hup. Existing wallets are backfilled
-- from their first action on Hup by scripts/backfill-member-joins.mjs; run it once
-- after this migration. Both all-time and recent member counts read joined_at.
-- Apply before deployment to enable tracking immediately. Safe to re-run (MariaDB).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS joined_at DATETIME NULL DEFAULT NULL
    COMMENT 'First Hup wallet connection observed in UTC';

CREATE INDEX IF NOT EXISTS idx_users_joined_at ON users (joined_at);
