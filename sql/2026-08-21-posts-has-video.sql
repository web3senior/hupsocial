-- Shorts feed support: mark posts that carry at least one video media item.
--
-- Media lives in posts.content as elements[1].data.items[] — a LIKE '%video%' scan would
-- both full-scan the table and match any post whose *text* happens to contain the word.
-- A stored generated column moves the JSON walk to write time and makes the feed indexable,
-- mirroring how nft_listing_id is already derived from the same column.
--
-- JSON_SEARCH with the [*] wildcard is supported on MariaDB 10.2+ (verified on 10.4.32).

ALTER TABLE posts
  ADD COLUMN has_video tinyint(1) unsigned
    GENERATED ALWAYS AS (
      json_valid(`content`)
      AND json_search(`content`, 'one', 'video', NULL, '$.elements[1].data.items[*].type') IS NOT NULL
    ) STORED;

-- Column order matches the existing idx_posts_contract_feed shape so the shorts feed can seek
-- straight to a network's video posts and read them back in id order without a filesort.
ALTER TABLE posts
  ADD KEY idx_posts_has_video (network_id, contract_address, has_video, is_deleted, id);
