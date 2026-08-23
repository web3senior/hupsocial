-- Persistent negative cache for the media proxies (/api/ipfs/file and friends).
-- Idempotent: safe to re-run.
--
-- Why this table exists
-- ---------------------
-- Unpinned content is ordinary on IPFS: the gateway simply never answers, and the proxy eats
-- its whole 8s timeout before giving up. src/lib/mediaCache.js already remembers that, but it
-- remembers it *in the process* -- which is the right layer for a long-lived server and the
-- wrong one for a serverless function, where every cold instance starts having never heard of
-- any of them. Vercel's CDN doesn't fill the gap either: it caches 200s, not 504s.
--
-- Measured on the NFT Market's Collections ranking (/nfts?view=collections), which paints
-- twelve collection icons: five of them are dead CIDs, each costing 8.5-10s. That is the whole
-- of that page's slowness -- every figure in the table is a single 20ms database read.
--
-- Keyed by the proxy's own cache key (cid + transform params) rather than by cid alone, so a
-- width that fails to encode is not held against a width that doesn't.
--
-- Rows are never deleted inline -- a read ignores anything older than the TTL in
-- src/lib/mediaFailureStore.js, so a CID pinned since is retried on its own. The table is
-- bounded by the number of distinct dead addresses the app has ever been asked for; the
-- housekeeping statement at the bottom is there for when that stops being a small number.

-- ---------------------------------------------------------------------------
-- 1. The table.
--
--    cache_key is capped at 255 so the primary key stays inside InnoDB's index limit at
--    utf8mb4 (255 x 4 = 1020 bytes). The store refuses to record a longer key rather than
--    truncating one -- a truncated key would collide with a different transform of the same
--    CID and blank an image that resolves perfectly well.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `media_failures` (
  `cache_key` varchar(255) NOT NULL COMMENT 'proxy cache key: cid|width|quality|still|format',
  `cid` varchar(255) NOT NULL COMMENT 'content address that could not be resolved, for triage',
  `status` smallint(5) unsigned NOT NULL DEFAULT 504 COMMENT 'status to replay; 504 = gateway never answered',
  `message` varchar(255) DEFAULT NULL COMMENT 'error text to replay',
  `failed_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`cache_key`),
  KEY `idx_media_failures_failed_at` (`failed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- 2. Verify -- should return 0 rows on a fresh install, and the dead CIDs once the app has
--    been asked for a few.
-- ---------------------------------------------------------------------------
-- SELECT cid, status, message, failed_at FROM media_failures ORDER BY failed_at DESC LIMIT 20;

-- ---------------------------------------------------------------------------
-- 3. Housekeeping. Nothing calls this -- expired rows are already ignored on read. Run it by
--    hand if the table ever grows past the point of being free to keep.
-- ---------------------------------------------------------------------------
-- DELETE FROM media_failures WHERE failed_at < NOW() - INTERVAL 7 DAY;
