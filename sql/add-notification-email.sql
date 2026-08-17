-- Notification email + recovery hardening — canonical schema, 2026-08-17.
-- Run once per database, after add-email-login.sql.

-- Verified notification email lives on the users row (the long-orphaned `email`
-- column becomes real storage). email_verified_at is the send gate: the cron
-- sweeper never mails an address that has not proven ownership via OTP.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_notifications TINYINT(1) NOT NULL DEFAULT 1;

-- Email delivery state, mirroring the push_status pattern. DEFAULT 'pending' on
-- purpose: cidex keeps inserting notification rows exactly as today, and the
-- sweeper decides eligibility afterwards.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_status ENUM ('pending', 'sent', 'skipped') NOT NULL DEFAULT 'pending',
  ADD INDEX IF NOT EXISTS idx_email_status (email_status);

-- History predating the feature must never be mass-mailed on the first sweep.
UPDATE notifications SET email_status = 'skipped' WHERE email_status = 'pending';

-- One OTP per (email, purpose) instead of per email: a login code and a
-- notification-verify code for the same address must not overwrite each other.
ALTER TABLE email_otps
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'login';
ALTER TABLE email_otps
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (email, purpose);
