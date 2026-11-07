-- Verified email logins count before an embedded wallet is created.
-- Existing email accounts were created only after successful verification.
-- Seed the existing authenticated email population at today's baseline in UTC.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS joined_at DATETIME NULL DEFAULT NULL
    COMMENT 'First verified Hup email login observed in UTC';

UPDATE email_accounts
SET joined_at = UTC_TIMESTAMP()
WHERE joined_at IS NULL AND last_login_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_accounts_joined_at ON email_accounts (joined_at);
