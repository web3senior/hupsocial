-- Hup Polls 1.1 -- voter requirements (HupPolls.sol, PollRequirementsSet).
-- Idempotent: safe to re-run.
--
-- Adds the four columns a gated poll needs. All four stay NULL/0 for an ungated poll, which
-- is still the overwhelming majority, so nothing about existing rows changes.
--
-- Requirements are serialized whole rather than normalized into a child table: the contract
-- caps a list at three entries, it is always read with its poll, and the one event that can
-- change it replaces it wholesale.
--
-- Syntax note: ADD COLUMN IF NOT EXISTS is MariaDB-only. On MySQL 8 drop the IF NOT EXISTS
-- and ignore duplicate-column errors when re-running.

-- ---------------------------------------------------------------------------
-- 1. Requirement columns.
-- ---------------------------------------------------------------------------
ALTER TABLE `polls`
  -- JSON array of { rType, asset, minBalance }; NULL or [] means anyone with a wallet.
  ADD COLUMN IF NOT EXISTS `requirements` longtext DEFAULT NULL AFTER `option_labels`,
  -- 0 = AllOf, 1 = AnyOf. Mirrors the contract's RequirementMode enum.
  ADD COLUMN IF NOT EXISTS `requirement_mode` tinyint(3) unsigned NOT NULL DEFAULT 0 AFTER `requirements`,
  -- Merkle root over the allowlisted voters; NULL when the poll has no allowlist.
  ADD COLUMN IF NOT EXISTS `allowlist_root` varchar(66) DEFAULT NULL AFTER `requirement_mode`,
  -- The address set behind that root, denormalized out of the poll's metadata JSON so a voter
  -- can build a proof from the API rather than an IPFS gateway. Public either way -- the root
  -- is onchain. Capped at 5000 addresses by the indexer.
  ADD COLUMN IF NOT EXISTS `allowlist` longtext DEFAULT NULL AFTER `allowlist_root`,
  -- JSON array of human-readable condition strings, aligned by index with `requirements`, from
  -- the poll's metadata JSON. Display only: it is the one place a token's symbol and decimals
  -- are known without a chain read, since the onchain requirement carries raw units. The
  -- contract, never this, decides who may vote.
  ADD COLUMN IF NOT EXISTS `requirement_labels` longtext DEFAULT NULL AFTER `allowlist`;

-- ---------------------------------------------------------------------------
-- 2. Retire the 1.0.0 deployment and register 1.1.0.
--
--    HupPolls has no proxy, so requirements meant a redeploy. The 1.0.0 contract on Base
--    Sepolia (0xf3F8f5D39e63a3D2A2b988771240c17A32e559B0, block 45828645) has neither
--    requirements nor the new `vote` signature -- its selector changed when the Merkle proof
--    parameter was added -- so pointing the app at it would encode calls it does not have.
--    Deactivate rather than delete: its two test polls stay readable, and the rows keep the
--    audit trail of what was indexed from where.
--
--    Fill in ADDRESS and DEPLOY_BLOCK, then run. The runner keys off contracts.name =
--    'HupPolls', so the name is not free text.
-- ---------------------------------------------------------------------------
-- UPDATE contracts SET is_active = 0
--  WHERE name = 'HupPolls' AND address = '0xf3F8f5D39e63a3D2A2b988771240c17A32e559B0';
--
-- SET @network_id = 84532;
-- SET @address = '0xADDRESS';
-- SET @deployed_block = DEPLOY_BLOCK;
--
-- INSERT INTO contracts (network_id, name, address, is_active)
-- SELECT @network_id, 'HupPolls', @address, 1
--  WHERE NOT EXISTS (
--        SELECT 1 FROM contracts WHERE network_id = @network_id AND address = @address
--  );
--
-- INSERT INTO indexer_state (contract_id, deployed_block, last_indexed_block)
-- SELECT c.id, @deployed_block, @deployed_block
--   FROM contracts c
--  WHERE c.network_id = @network_id AND c.address = @address
--    AND NOT EXISTS (SELECT 1 FROM indexer_state s WHERE s.contract_id = c.id);
