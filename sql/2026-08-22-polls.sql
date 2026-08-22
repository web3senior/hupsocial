-- Hup Polls -- schema for the onchain poll feature (HupPolls.sol).
-- Idempotent: safe to re-run.
--
-- Shape mirrors the Predict tables, which is the closest analogue already in production:
-- one row per onchain object (polls), one row per interaction (poll_votes), and the
-- display copy (question, option labels) denormalised out of the IPFS metadata JSON by
-- cidex so the API never has to touch a gateway to render a card.
--
-- Two things differ from markets on purpose:
--   * `tallies` is authoritative here, not derived. VoteCast carries the running counts and
--     a ballot is final onchain, so the counter only ever moves up -- a replayed log can be
--     ignored instead of recomputed.
--   * poll_votes carries a (network_id, poll_id, voter) unique key. The contract already
--     enforces one ballot per address; mirroring it in the schema is what makes a rescan
--     idempotent even if the same vote arrives under a different log position.
--
-- Syntax note: CREATE TABLE IF NOT EXISTS is portable; the INSERT ... SELECT guards at the
-- bottom are MariaDB/MySQL 8 compatible.

-- ---------------------------------------------------------------------------
-- 1. Polls -- one row per PollCreated, kept current by PollClosedEarly /
--    PollMetadataUpdated / PollHiddenSet / VoteCast.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `polls` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `network_id` int(10) unsigned NOT NULL,
  `poll_id` bigint(20) unsigned NOT NULL,
  `creator` varchar(42) NOT NULL,
  `option_count` tinyint(3) unsigned NOT NULL,
  `opens_at` bigint(20) unsigned NOT NULL DEFAULT 0,
  `closes_at` bigint(20) unsigned NOT NULL,
  -- Set only when the creator ends voting early; 0 while the poll runs its full window.
  `closed_at` bigint(20) unsigned NOT NULL DEFAULT 0,
  `hidden` tinyint(1) NOT NULL DEFAULT 0,
  `total_votes` int(10) unsigned NOT NULL DEFAULT 0,
  -- JSON array of per-option counts, positionally aligned with option_labels.
  `tallies` longtext DEFAULT NULL,
  `metadata_cid` varchar(255) NOT NULL,
  `question` text DEFAULT NULL,
  -- JSON array of { label, emoji } read out of the metadata document.
  `option_labels` longtext DEFAULT NULL,
  `metadata_fetched` tinyint(1) NOT NULL DEFAULT 0,
  `tx_hash` varchar(66) NOT NULL,
  `log_index` int(10) unsigned NOT NULL,
  `block_number` bigint(20) unsigned NOT NULL,
  `opened_at` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_poll` (`network_id`, `poll_id`),
  -- The directory's default sort: open polls on a network, soonest to close first.
  KEY `idx_feed` (`network_id`, `hidden`, `closes_at`),
  KEY `idx_creator` (`network_id`, `creator`),
  -- "Most voted" across every network, for the trending rail.
  KEY `idx_votes` (`hidden`, `total_votes`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- 2. Ballots -- one row per VoteCast. Drives "you voted for X" and the voter list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `poll_votes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `network_id` int(10) unsigned NOT NULL,
  `poll_id` bigint(20) unsigned NOT NULL,
  `voter` varchar(42) NOT NULL,
  `option_index` tinyint(3) unsigned NOT NULL,
  `tx_hash` varchar(66) NOT NULL,
  `log_index` int(10) unsigned NOT NULL,
  `block_number` bigint(20) unsigned NOT NULL,
  `voted_at` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_poll_log` (`network_id`, `tx_hash`, `log_index`),
  -- One ballot per address per poll, the same rule the contract enforces.
  UNIQUE KEY `uniq_poll_voter` (`network_id`, `poll_id`, `voter`),
  KEY `idx_poll` (`network_id`, `poll_id`, `option_index`),
  KEY `idx_voter` (`network_id`, `voter`, `block_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- 3. Register the deployment with cidex.
--
--    The runner keys off contracts.name = 'HupPolls', so the name is not free text.
--
--    Base Sepolia (84532) is the first and so far only chain carrying HupPolls, deployed
--    2026-08-22. Copy this block per chain as further deployments land.
--
--    Per the standing rule for this repo, indexing lives in cidex -- the app only ever
--    reads these tables.
-- ---------------------------------------------------------------------------
SET @network_id = 84532;
SET @address = '0xf3F8f5D39e63a3D2A2b988771240c17A32e559B0';
SET @deployed_block = 45828645;

INSERT INTO contracts (network_id, name, address, is_active)
SELECT @network_id, 'HupPolls', @address, 1
 WHERE NOT EXISTS (
       SELECT 1 FROM contracts WHERE network_id = @network_id AND address = @address
 );

INSERT INTO indexer_state (contract_id, deployed_block, last_indexed_block)
SELECT c.id, @deployed_block, @deployed_block
  FROM contracts c
 WHERE c.network_id = @network_id AND c.address = @address
   AND NOT EXISTS (SELECT 1 FROM indexer_state s WHERE s.contract_id = c.id);
