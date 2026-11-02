-- Posts a hosted agent has drafted for its owner. Kept on the server so a draft survives a reload
-- and the agent knows which of its drafts are still waiting. The post itself is signed in the
-- owner's browser with the agent's key; this table only ever holds the text and the outcome.

CREATE TABLE IF NOT EXISTS agent_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text TEXT NOT NULL,
  status ENUM('pending', 'published', 'discarded') NOT NULL DEFAULT 'pending',
  tx_hash VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  network_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_proposals_agent (agent_address, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
