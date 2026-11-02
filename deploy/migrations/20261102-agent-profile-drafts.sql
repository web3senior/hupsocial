-- Agents can draft a change to their own Hup profile name and bio (the hup_update_profile tool,
-- shaped like Hup MCP's). text holds the change and original_text the profile before it, both as
-- JSON { name?, description? }; approving signs the profile save in the owner's browser.
-- Run after 20261102-agent-actions.sql.

ALTER TABLE agent_proposals
  MODIFY COLUMN kind ENUM('post', 'edit', 'delete', 'reply', 'like', 'tip', 'transfer', 'profile') NOT NULL DEFAULT 'post';
