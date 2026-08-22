-- Schema the /nfts Collections ranking needs, for a database that predates it.
-- Idempotent: safe to re-run.
--
-- Why only this table: every other table the ranking touches is already proven live in
-- production by an endpoint that works today --
--   nft_listings (+ the `backed` column)  -> /api/v1/nfts/collections
--   nft_trades                            -> /api/v1/nfts/collections/{net}/{addr}/stats
--   nft_offers                            -> /api/v1/nfts/collections/{net}/{addr}/offers
--   nft_metadata_cache                    -> .../traits and .../rarity
--   store_tokens                          -> the floor symbols on /api/v1/nfts/collections
-- nft_collection_cache is the one table in the ranking query that no working endpoint
-- reads, which is why that route is the only one returning 500.
--
-- Window functions are also proven live (collections/route.js uses ROW_NUMBER() OVER and
-- answers 200), so the CTEs in the ranking query are supported too -- both landed in the
-- same server release (MariaDB 10.2 / MySQL 8.0). No version work is needed.
--
-- Syntax note: ALTER ... IF NOT EXISTS is MariaDB-only. On MySQL 8 drop the IF NOT EXISTS
-- and ignore duplicate-column errors when re-running.

-- ---------------------------------------------------------------------------
-- 0. Diagnostic -- run this FIRST. Every row should report present = 1.
-- ---------------------------------------------------------------------------
-- SELECT 'nft_collection_cache' AS object,
--        COUNT(*) AS present
--   FROM information_schema.tables
--  WHERE table_schema = DATABASE() AND table_name = 'nft_collection_cache'
-- UNION ALL
-- SELECT CONCAT('nft_collection_cache.', column_name), COUNT(*)
--   FROM information_schema.columns
--  WHERE table_schema = DATABASE() AND table_name = 'nft_collection_cache'
--    AND column_name IN ('name', 'icon_uri', 'total_supply')
--  GROUP BY column_name;

-- ---------------------------------------------------------------------------
-- 1. Collection-level display cache: name, icon, banner, supply.
--
--    cidex does NOT write this table -- the app fills it read-through the first time a
--    collection renders (src/lib/collectionMetadataCache.js), because the data comes from
--    eth_call reads rather than logs. So it starts empty and populates itself; the ranking
--    LEFT JOINs it and shows a bare address until a row lands.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `nft_collection_cache` (
  `network_id` int(10) unsigned NOT NULL,
  `collection` varchar(42) NOT NULL COMMENT 'lowercased contract address',
  `is_lsp8` tinyint(1) NOT NULL DEFAULT 0,
  `name` varchar(255) DEFAULT NULL,
  `symbol` varchar(64) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `banner_uri` text DEFAULT NULL COMMENT 'storage URI of the wide cover image; inline data: URIs are refused',
  `icon_uri` text DEFAULT NULL COMMENT 'storage URI of the square icon; inline data: URIs are refused',
  `creators` text DEFAULT NULL COMMENT 'JSON array of lowercased LSP4Creators[] addresses',
  `links` text DEFAULT NULL COMMENT 'JSON array of {title, url} from LSP4Metadata links',
  `total_supply` varchar(78) DEFAULT NULL COMMENT 'uint256 as decimal string',
  `source` varchar(16) DEFAULT NULL COMMENT 'lsp4 = offchain document resolved; contract = onchain reads only',
  `fetched_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`network_id`, `collection`),
  KEY `idx_nft_collection_fetched_at` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 1b. For a database that has an older, narrower version of the table.
ALTER TABLE `nft_collection_cache`
  ADD COLUMN IF NOT EXISTS `icon_uri` TEXT DEFAULT NULL COMMENT 'storage URI of the square icon' AFTER `banner_uri`,
  ADD COLUMN IF NOT EXISTS `total_supply` VARCHAR(78) DEFAULT NULL COMMENT 'uint256 as decimal string' AFTER `links`;

-- ---------------------------------------------------------------------------
-- 2. Aggregate keys. The ranking groups every listing, trade and offer by
--    (network_id, collection) before it can sort -- a full scan of each table without
--    these. Cheap now, load-bearing once the market has volume.
-- ---------------------------------------------------------------------------
ALTER TABLE `nft_listings`
  ADD KEY IF NOT EXISTS `idx_collection_rank` (`network_id`, `collection`, `status`, `backed`);

ALTER TABLE `nft_trades`
  ADD KEY IF NOT EXISTS `idx_collection_rank` (`network_id`, `collection`, `sold_at`);

ALTER TABLE `nft_offers`
  ADD KEY IF NOT EXISTS `idx_collection_rank` (`network_id`, `collection`, `status`, `expires_at`);

-- ---------------------------------------------------------------------------
-- 3. Verify: this is the ranking route's own shape, minus the aggregates. It should
--    return rows, not an error.
-- ---------------------------------------------------------------------------
-- SELECT l.network_id, l.collection, cc.name, cc.total_supply, COUNT(*) AS active
--   FROM nft_listings l
--   LEFT JOIN nft_collection_cache cc
--          ON cc.network_id = l.network_id AND cc.collection = l.collection
--  WHERE l.status = 1 AND l.backed = 1
--  GROUP BY l.network_id, l.collection
--  LIMIT 5;
