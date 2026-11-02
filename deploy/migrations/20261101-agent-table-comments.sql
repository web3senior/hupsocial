-- Table comments for hosted agents, so each table explains itself in any database tool.
-- Run after the other 20261101-agent-* migrations.

ALTER TABLE hosted_agents COMMENT = 'Hosted AI agents. One row per agent: owner, index n (its key is hup:agent:<n>:v2, derived in the owner''s browser from their wallet signature and Key Vault passphrase, never stored), name, persona (SOUL.md), memory (MEMORY.md), model, robot look, pause switch and model credits (AIML units, 2,000,000 per USD).';

ALTER TABLE agent_messages COMMENT = 'Messages between an owner and their agent, each in a session (agent_sessions). A turn reads only its own session, within a size budget; older turns are recapped into the session summary. Each task run is a session of its own.';

ALTER TABLE agent_proposals COMMENT = 'Drafts an agent made for its owner to approve: a new post, or an edit or removal of one of its own posts. Kept so a draft survives a reload and the agent knows what is still waiting; status records the owner''s choice and tx_hash the published transaction. Nothing here is ever published by the server.';

ALTER TABLE agent_topups COMMENT = 'Credit top-ups: LYX the agent''s own wallet sent to the billing address on LUKSO, checked onchain and credited at the USD price of the moment. The transaction hash is the key, so one transfer can never be credited twice.';

ALTER TABLE agent_usage COMMENT = 'What each chat turn or task run cost, in AIML credits exactly as AIML reported it, charged to the agent''s balance in hosted_agents.credits.';

ALTER TABLE agent_tasks COMMENT = 'Standing instructions an owner gives an agent, run on demand or hourly/daily by the cron tick (POST /api/v1/agents/tasks/due). running_since is a claim so two triggers never run one task at once. Results land in agent_messages; anything acting on Hup arrives as a draft in agent_proposals.';

ALTER TABLE agent_files COMMENT = 'The agent workspace working copy, in OpenClaw''s layout: AGENTS.md, USER.md and skills/<name>/SKILL.md. SOUL.md and MEMORY.md live in hosted_agents and TASKS.json is drawn from agent_tasks. Never holds credentials. Snapshots of the whole workspace are saved onchain, encrypted, through ChainKeep.';

ALTER TABLE agent_snapshots COMMENT = 'A cache of the agent''s onchain workspace snapshots: ChainKeep file IDs on LUKSO (vault 0x5B65a030fea21E89eabE06816bF9503406C666EB), each owned by the agent''s own wallet. The chain is the record: vault.filesOf(agent) lists them all, so this table can be rebuilt from it.';
