-- Profile origin: the one place on Hup where a wallet says where it is from — a real country, or
-- an onchain one.
--
-- Deliberately country-level and nothing finer. A post is permanent (content on IPFS, the CID
-- onchain), so anything more precise would be an unretractable disclosure welded to a
-- pseudonymous identity forever. A country is coarse enough that publishing it stays a choice
-- rather than a leak, which is why this lives on the profile — settable, changeable, erasable —
-- and never on a post.
--
-- App-owned, like `birthday` and the `badge_*` pointers beside it: a Universal Profile describes
-- a person, not their Hup preferences, so this is read from our own users row even when the
-- profile itself renders from a UP.
--
-- ONE COLUMN, TWO VOCABULARIES, told apart by shape alone:
--
--   'NG'     two uppercase letters — ISO 3166-1 alpha-2, validated against `countries`
--   'lukso'  a lowercase slug      — an onchain origin from config/originOptions.js
--
-- ISO alpha-2 is *always* exactly two uppercase letters, so the two spaces cannot collide and no
-- prefix is needed to separate them. The code is stored rather than `countries.id` because an
-- auto-increment id only means something inside one copy of this database, while the code is the
-- stable public identity (the same reason the badge pointer stores a deployment triplet instead
-- of a local row id). It also renders its own flag: offset each letter into the regional-indicator
-- block and the emoji falls out, so there are no flag assets to ship.
--
-- `countries` is the single source of truth for the real half, on both sides. The picker offers
-- exactly the rows in that table and the setter validates against the same rows, so the picker
-- can never offer a country the save then rejects. The onchain half works the same way against
-- its slug list, whose slugs must never be renamed once shipped — a wallet that filed under
-- `lukso` keeps that string forever.
--
-- The profile read needed NO query change: it already does `SELECT u.*`, which picks this column
-- up the moment it exists, and a database that predates this migration simply reports no origin
-- instead of failing. Adding an explicit column or a join to that query is exactly what blanked
-- every avatar in the app when the badge columns went in — not repeating it. A country's display
-- name is fetched by its own small guarded lookup for the same reason.
--
-- NULL means "not disclosed", which is every wallet until it opts in. There is no backfill and
-- there must never be one: an origin nobody chose to publish is not ours to publish.
--
-- Idempotent: every statement is guarded, safe to re-run.

-- 1. The chosen origin.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS `origin_code` varchar(24) DEFAULT NULL COMMENT 'ISO 3166-1 alpha-2 (uppercase) or an onchain origin slug (lowercase); NULL = not disclosed' AFTER `birthday`;

-- 2. Every profile save validates a submitted country against `countries`, and every profile that
--    shows one resolves its name there. `iso_code` carried no key of its own, so both of those
--    were full scans of the table.
ALTER TABLE countries
  ADD UNIQUE KEY IF NOT EXISTS `idx_countries_iso_code` (`iso_code`);

-- 3. "Who else is here from X" — the reason to store this as a column rather than let people
--    write it into their bio, and what a regional cut of the leaderboard would read.
ALTER TABLE users
  ADD KEY IF NOT EXISTS `idx_users_origin_code` (`origin_code`);
