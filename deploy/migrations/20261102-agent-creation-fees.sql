-- Creating an agent beyond an owner's first costs a fee (AGENT_CREATION_FEE_USD in
-- config/agentModels.js), paid in any Hup network's own coin from the owner's wallet or Universal
-- Profile to the billing address. Each payment is checked onchain and stored with the agent it paid
-- for; the hash and network are the key, so one payment can never create two agents.
-- Top-ups already record their network in agent_topups.network_id, so they need no change here.

CREATE TABLE IF NOT EXISTS agent_creation_fees (
  tx_hash VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  network_id INT UNSIGNED NOT NULL,
  owner_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_wei DECIMAL(65, 0) NOT NULL,
  usd_price DECIMAL(24, 10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tx_hash, network_id),
  KEY idx_agent_creation_fees_owner (owner_address, created_at)
) ENGINE=InnoDB
  COMMENT = 'Creation fees for hosted agents: one row per payment, bound to the agent it created. An owner''s first agent is free and has no row.';
