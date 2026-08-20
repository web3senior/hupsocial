-- Community categories: the curated topic list a community files itself under. A creator picks a
-- slug in the create/modify form, it is written into the community's metadata JSON (the CID the
-- creator's own tx commits onchain), and cidex projects it into `communities.category` so the
-- directory's topic filter is an indexed equality.
--
-- The list lives in THIS table on both sides, the way `countries` backs the profile's origin
-- picker: the app's picker offers exactly these rows (GET /api/v1/communities/categories) and
-- cidex validates a metadata slug against the same rows before indexing it, so the picker can
-- never offer a category the indexer then drops. Off-list values index as NULL, which the app
-- renders as "Other" (and the 'other' filter matches NULL too), so a community created under a
-- slug that is later deactivated still lands somewhere.
--
-- Slugs are the stored value and must never be renamed once shipped — a community that filed
-- under `gaming` keeps that string forever. To retire one, flip is_active to 0: existing
-- communities keep the slug (it still renders by label), new ones just can't pick it. Reorder
-- with sort_order; add rows freely — nothing is hard-coded in either codebase.
--
-- Labels are plain words, no emoji: the picker, chips, and pills render the label as-is.
--
-- cidex's own ensureIndexerSchema creates and seeds this table at startup too; it is repeated
-- here for anyone applying the schema by hand. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS `community_categories` (
  `slug` varchar(32) NOT NULL COMMENT 'Stored value; lowercase, never renamed once shipped',
  `label` varchar(64) NOT NULL COMMENT 'What people see',
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '0 = retired: kept for existing communities, not offered to new ones',
  PRIMARY KEY (`slug`),
  KEY `idx_community_categories_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `community_categories` (`slug`, `label`, `sort_order`) VALUES
  ('crypto', 'Crypto & Web3', 10),
  ('tech', 'Technology', 20),
  ('gaming', 'Gaming', 30),
  ('art', 'Art & Design', 40),
  ('music', 'Music', 50),
  ('finance', 'Finance & Trading', 60),
  ('science', 'Science', 70),
  ('sports', 'Sports', 80),
  ('news', 'News & Politics', 90),
  ('lifestyle', 'Lifestyle', 100),
  ('education', 'Education', 110),
  ('business', 'Business', 120),
  ('entertainment', 'Entertainment', 130),
  ('community', 'Local & Community', 140),
  ('other', 'Other', 999);
