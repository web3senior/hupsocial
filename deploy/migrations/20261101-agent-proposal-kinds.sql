-- Agent drafts can now edit or remove one of the agent's own posts, not only publish a new one.
-- `text` is the new text for a post or an edit and empty for a removal; `original_text` keeps
-- what the post said when the draft was made, so the owner sees both sides before approving.

ALTER TABLE agent_proposals
  ADD COLUMN kind ENUM('post', 'edit', 'delete') NOT NULL DEFAULT 'post' AFTER agent_address,
  ADD COLUMN post_id BIGINT UNSIGNED NULL AFTER kind,
  ADD COLUMN original_text TEXT NULL AFTER text,
  ADD COLUMN allow_comments TINYINT(1) NULL AFTER original_text;
