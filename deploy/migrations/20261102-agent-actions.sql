-- Agents draft more than posts: a reply to, like of or tip on any post, and a transfer of coin
-- from their own wallet. Each is still a card the owner approves and signs in their browser.
-- post_id and network_id name the post (or, for a transfer, network_id the network); amount is a
-- decimal of the network's coin and recipient the wallet it goes to (a tip's is the post author).

ALTER TABLE agent_proposals
  MODIFY COLUMN kind ENUM('post', 'edit', 'delete', 'reply', 'like', 'tip', 'transfer') NOT NULL DEFAULT 'post',
  ADD COLUMN amount VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER allow_comments,
  ADD COLUMN recipient VARCHAR(44) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER amount;
