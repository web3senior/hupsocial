-- Hosted agents' workspace, in OpenClaw's layout. SOUL.md and MEMORY.md are the agent's persona and
-- memory columns, and TASKS.json is drawn from agent_tasks; every other file lives here. This is
-- the working copy: the owner saves snapshots of the whole workspace onchain through ChainKeep,
-- encrypted with a key from their Key Vault, and a snapshot can restore it.

CREATE TABLE IF NOT EXISTS agent_files (
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- AGENTS.md, USER.md, or skills/<name>/SKILL.md
  path VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_address, path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Snapshots saved onchain. The chain is the record (the vault lists every file the agent's wallet
-- owns); this is a cache of it for a quick history.
CREATE TABLE IF NOT EXISTS agent_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chain_id INT UNSIGNED NOT NULL,
  file_id CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tx_hash VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_snapshots_file (chain_id, file_id),
  KEY idx_agent_snapshots_agent (agent_address, id)
) ENGINE=InnoDB;
