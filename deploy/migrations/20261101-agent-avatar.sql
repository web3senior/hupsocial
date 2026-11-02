-- The robot look an owner picked for their agent (lib/botAvatar.js traits, as JSON). NULL means
-- the look the agent's address picks on its own.

ALTER TABLE hosted_agents
  ADD COLUMN avatar VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER model;
