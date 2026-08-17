-- Email login (embedded wallet) — canonical schema, 2026-08-17.
-- Applied to the local XAMPP `hup` database; keep this file as the source of
-- truth for production, alongside the other canonical add-*.sql files.

-- One row per email identity. wallet_address is set once, when the client
-- generates the embedded wallet, and is treated as immutable afterwards —
-- the keystore route refuses to bind a different address to an account that
-- already has one (a swapped address would orphan the user's funds).
CREATE TABLE IF NOT EXISTS email_accounts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(42) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email),
  KEY idx_wallet_address (wallet_address)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- One active OTP per email (same upsert pattern as `nonces`). Only a peppered
-- SHA-256 of the code is stored; the plaintext code exists in the outgoing
-- email and nowhere else.
CREATE TABLE IF NOT EXISTS email_otps (
  email VARCHAR(255) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Split-key custody. server_share is one XOR half of the private key,
-- AES-256-GCM-encrypted at rest under KEYSTORE_MASTER_KEY (env) — the DB
-- alone can never reconstruct a key. backup_blob is the full private key
-- encrypted CLIENT-SIDE with a scrypt-stretched recovery password; the
-- server only ever stores it opaque.
CREATE TABLE IF NOT EXISTS email_keystore (
  account_id INT UNSIGNED NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  server_share TEXT NOT NULL,
  backup_blob TEXT NOT NULL,
  kdf_params VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  CONSTRAINT fk_email_keystore_account FOREIGN KEY (account_id) REFERENCES email_accounts (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
