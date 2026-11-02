-- Agents made from an existing wallet. A derived agent's key comes back from the owner's Key Vault
-- (hup:agent:<n>:v2) and needs nothing stored; an imported key cannot be derived, so it is kept here
-- encrypted in the owner's browser under a Key Vault key and bound to the agent's address. The
-- server never sees it in the clear and cannot decrypt it.

ALTER TABLE hosted_agents
  ADD COLUMN key_ciphertext TEXT CHARACTER SET ascii COLLATE ascii_bin NULL AFTER agent_index;
