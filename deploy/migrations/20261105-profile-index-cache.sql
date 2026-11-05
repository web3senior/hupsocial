-- The profile read serves the `users` row first and asks the LUKSO indexer only when the row has
-- never recorded what the indexer said about the wallet. These two columns are that record.
--
--   is_universal_profile   NULL = the indexer has never been asked about this wallet
--                          0    = it was asked and had no named profile for it
--                          1    = it has one; name, description, profileImage, profileHeader,
--                                 tags and links on the row are the copy of it
--   profile_indexed_stamp  the indexer's `lastMetadataUpdate` as of that copy — what the profile
--                          editor copies into `profile_sync_stamp` on a Hup-first edit, and what
--                          that stamp is compared against to tell whether Hup's row is ahead
--
-- The copy is refreshed behind the response once it is old enough (10 minutes for a Universal
-- Profile, an hour for a wallet the indexer had nothing for), and a row whose sync stamp still
-- equals the indexer's keeps its own values through that refresh.
--
-- Without these columns the read still works; it just asks the indexer on every request, as it
-- did before them. The two prerequisites below are the earlier profile migrations, restated so
-- this file can be applied on its own; they are no-ops where those already ran.
--
-- Idempotent: safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS `profile_sync_stamp` varchar(64) DEFAULT NULL
    COMMENT 'Indexer lastMetadataUpdate as of the last Hup edit; set = Hup row is ahead of chain'
    AFTER `lastUpdate`;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS `profileHeader` text DEFAULT NULL
    AFTER `profileImage`;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS `is_universal_profile` tinyint(1) DEFAULT NULL
    COMMENT 'NULL never asked the LUKSO indexer; 0 it had no profile; 1 the row copies one'
    AFTER `profile_sync_stamp`,
  ADD COLUMN IF NOT EXISTS `profile_indexed_stamp` varchar(64) DEFAULT NULL
    COMMENT 'Indexer lastMetadataUpdate as of the copy on this row'
    AFTER `is_universal_profile`;

-- No backfill: every existing row starts as "never asked", and is settled by its first read.
