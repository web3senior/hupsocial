-- OG used to go to every account created before the cutoff, which included a July 2026 wave of
-- wallets that connected once and never posted. The rule now requires a post or reply before the
-- cutoff (src/lib/achievementRules.js). Run once, after deploying that rule.
--
-- Clears the OG awards the old rule made. The scheduler's next tick re-awards OG to wallets that
-- posted before the cutoff; it is the rule's first run with no holders, so it notifies nobody.
-- Admin-granted OG rows are kept. Featured rows are left alone: a featured OG reads as nothing
-- while unheld and shows again for wallets that earn it back.

DELETE FROM user_achievements WHERE achievement_id = 'og' AND source = 'rule';
