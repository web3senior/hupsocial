-- Agents of Universal Profile owners. Such an agent has no wallet or profile of its own: it is an
-- LSP6 controller key on the owner's profile and acts only as that profile (lib/lsp6.js). The key
-- is random and kept in the owner's browser; Hup never sees it.
--
-- agent_address stays the agent's id for good (chats, tasks, credits hang off it). The key itself
-- can be replaced — a new device makes a new one and swaps it in on the profile — so the current
-- key is controller_address, which starts out equal to agent_address.

ALTER TABLE hosted_agents
  ADD COLUMN kind ENUM('wallet', 'controller') NOT NULL DEFAULT 'wallet' AFTER agent_index,
  ADD COLUMN controller_address VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER kind,
  ADD UNIQUE KEY uq_hosted_agents_controller (controller_address);
