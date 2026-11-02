-- Hosted agents talk in sessions, like any AI chat: each turn reads only its own session, so an old
-- topic never crowds a new one and fewer tokens are paid for. What lasts between sessions is the
-- agent's memory and workspace. Every task run gets a session of its own.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('chat', 'task') NOT NULL DEFAULT 'chat',
  task_id BIGINT UNSIGNED NULL,
  title VARCHAR(120) NOT NULL DEFAULT '',
  -- A recap of the turns before summarized_through, written once a session outgrows its budget
  summary TEXT NULL,
  summarized_through BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_sessions_agent (agent_address, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT = 'Chat sessions between an owner and their agent, and one per task run. A turn reads only its own session; memory and workspace carry over. summary recaps turns up to summarized_through once a session outgrows its context budget.';

ALTER TABLE agent_messages
  ADD COLUMN session_id BIGINT UNSIGNED NULL AFTER agent_address,
  ADD KEY idx_agent_messages_session (session_id, id);

ALTER TABLE agent_proposals
  ADD COLUMN session_id BIGINT UNSIGNED NULL AFTER agent_address;
