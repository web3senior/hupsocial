-- Owner-edited proposal attachments, retained before and after approval.
ALTER TABLE agent_proposals
  ADD COLUMN IF NOT EXISTS attachments JSON NULL;
