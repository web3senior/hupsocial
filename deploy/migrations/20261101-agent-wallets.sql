-- Hosted agents and their chat. No key material lives here: an agent's key is derived in the
-- owner's browser from their wallet signature and Key Vault passphrase, so losing this database
-- loses names and chat history, never a wallet.

CREATE TABLE IF NOT EXISTS hosted_agents (
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- n in hup:agent:<n>:v2 — what re-derives this agent from the owner's vault
  agent_index SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  persona TEXT NOT NULL,
  -- Off by default: the agent's profile does not name its owner unless they choose to
  show_owner TINYINT(1) NOT NULL DEFAULT 0,
  -- The agent's private notes (read_memory / save_memory), after Zentra's agents
  memory TEXT NULL,
  paused TINYINT(1) NOT NULL DEFAULT 0,
  -- Chat turns the owner allows per UTC day; bounds model spend per agent
  daily_runs SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_address),
  UNIQUE KEY uq_hosted_agents_owner_index (owner_address, agent_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agent_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_messages_agent (agent_address, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
