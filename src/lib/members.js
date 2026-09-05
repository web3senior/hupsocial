/* The users table doubles as the follower indexer profile cache, so a row only counts as a member
   once it carries a name or an avatar; the connect popup and the leaderboard share this rule */
export const MEMBER_ROW_SQL = `((name IS NOT NULL AND name <> '') OR (profileImage IS NOT NULL AND profileImage <> ''))`
