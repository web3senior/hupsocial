-- Public Safe vault discovery records; custody stays onchain.
CREATE TABLE IF NOT EXISTS personal_vaults (
    chain_id BIGINT UNSIGNED NOT NULL,
    address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    safe_version VARCHAR(16) NOT NULL,
    approval_threshold SMALLINT UNSIGNED NOT NULL,
    signer_count SMALLINT UNSIGNED NOT NULL,
    verified_block BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, address)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS personal_vault_signers (
    chain_id BIGINT UNSIGNED NOT NULL,
    vault_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    signer_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (chain_id, vault_address, signer_address),
    KEY idx_personal_vault_signer (signer_address, chain_id, vault_address)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
