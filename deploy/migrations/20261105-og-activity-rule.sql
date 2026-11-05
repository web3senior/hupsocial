-- OG now needs real part taken before the cutoff — 5+ posts, 2+ comments and 3+ replies — instead
-- of a single post (src/config/achievements.js, src/lib/achievementRules.js). Run once, after
-- deploying that rule; it supersedes 20261105-og-requires-a-post.sql, which can be skipped.
--
-- Clears the OG awards earlier rules made. The scheduler's next tick re-awards OG under the new
-- rule; with no holders left it is a first run, so it notifies nobody. Admin-granted OG rows are
-- kept. Featured rows are left alone: a featured OG reads as nothing while unheld and shows again
-- for wallets that earn it back.
--
-- OG holders are also who decides community standing (blocked by 5+ of them), so the set of
-- people with that say shrinks to the new holders the moment this runs.

DELETE FROM user_achievements WHERE achievement_id = 'og' AND source = 'rule';
