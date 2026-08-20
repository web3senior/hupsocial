-- Community badge pointers on `users` — the columns lib/badge.js joins against.
--
-- These were added to the development database by hand when the badge feature was written and
-- never captured as a migration, so deploying that feature pointed every profile read at columns
-- production did not have: the join failed with error 1054, the profile route's Promise.all
-- rejected, and /api/v1/users/profile/<address> returned 500 for every wallet — which blanked
-- every avatar in the app at once. Run this against any database that predates the feature.
--
-- The row stores a POINTER only (which community this wallet chose to wear). Membership itself is
-- never trusted from here: every read re-joins community_members to confirm the wallet still
-- belongs and is not banned. See lib/badge.js for why the tag is resolved rather than stored.
--
-- Re-running is safe to attempt: on a database that already has the columns MySQL/MariaDB refuses
-- with 1060 (duplicate column) and changes nothing.

ALTER TABLE `users`
  ADD COLUMN `badge_network_id` int(11) DEFAULT NULL
    COMMENT 'Chain of the community whose tag this wallet wears',
  ADD COLUMN `badge_contract_address` char(42) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL
    COMMENT 'HupCommunity deployment the badge community lives on',
  ADD COLUMN `badge_community_id` bigint(20) unsigned DEFAULT NULL
    COMMENT 'Community id within that deployment';
