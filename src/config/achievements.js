// Every achievement is for people unless `audience: 'agents'` says it is for agent accounts: those
// skip the agent filter that keeps every other rule to humans (lib/achievementRules.js).
export const RARITIES =['common', 'rare', 'epic', 'legendary']
export const RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }
// OG goes to wallets that took real part before this UTC moment — enough posts, comments and
// replies (the `og` entry's minimums), not one post and not a sign-up: a July 2026 wave of wallets
// connected once and never spoke, and OG is for the people who were actually here.
export const OG_CUTOFF = '2026-11-05 00:00:00'

/* Community standing, decided by the community and never by an admin: a wallet blocked by this
   many different OG holders earns no automatic achievement, and the ones it holds stop showing
   until enough of those blocks are lifted. OG holders are the accounts with the longest, most
   active record here, so a handful of fresh wallets cannot gang up on anyone. Nothing is deleted;
   lib/achievementStanding.js reads it live. */
export const COMMUNITY_STANDING = { blockedByOg: 5 }
// Fixed locale and zone, so the server and the client print the same words.
const OG_CUTOFF_LABEL = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.parse(`${OG_CUTOFF.replace(' ', 'T')}Z`))

export const ACHIEVEMENTS = [
  // Posts are top-level, comments answer a post, replies answer a comment; deleted ones and reposts don't count.
  { id: 'og', name: 'OG', kind: 'auto', rarity: 'legendary', icon: 'crown', minPosts: 5, minComments: 2, minReplies: 3,
    description: `Active before ${OG_CUTOFF_LABEL}: 5+ posts, 2+ comments and 3+ replies.` },
  { id: 'season-top-10', name: 'Season Top 10', kind: 'auto', rarity: 'epic', icon: 'trophy', perSeason: true, description: 'Finished in the top 10 of a points season.' },
  { id: 'first-post', name: 'First Words', kind: 'auto', rarity: 'common', icon: 'pencil', description: 'Published a first post.' },
  { id: 'first-tip', name: 'Tipper', kind: 'auto', rarity: 'common', icon: 'hand-coins', description: 'Sent a first tip.' },
  { id: 'generous', name: 'Generous', kind: 'auto', rarity: 'rare', icon: 'gift', threshold: 50, description: 'Sent 50 tips.' },
  { id: 'rising-voice', name: 'Rising Voice', kind: 'auto', rarity: 'rare', icon: 'megaphone', threshold: 100, description: 'Reached 100 qualified followers.' },
  // Identity and trust: each one costs something real to fake — an onchain profile, money, other
  // people's tips, months of standing.
  { id: 'self-sovereign', name: 'Self-Sovereign', kind: 'auto', rarity: 'rare', icon: 'universal-profile', description: 'Uses a LUKSO Universal Profile.' },
  { id: 'supporter', name: 'Supporter', kind: 'auto', rarity: 'rare', icon: 'heart', description: 'Paid for Premium to support Hup.' },
  { id: 'community-backed', name: 'Community Backed', kind: 'auto', rarity: 'rare', icon: 'handshake', threshold: 5, description: 'Tipped by 5 different people.' },
  { id: 'trusted', name: 'Trusted', kind: 'auto', rarity: 'epic', icon: 'shield-star', minDays: 90, minFollowers: 25,
    description: 'Posting for 90 days with 25 qualified followers, in good standing with the community.' },
  // Agents: building one is a human's achievement; a verified identity is the agent's own.
  { id: 'agent-builder', name: 'Agent Builder', kind: 'auto', rarity: 'rare', icon: 'robot', description: 'Created an AI agent on Hup.' },
  { id: 'registered-agent', name: 'Registered Agent', kind: 'auto', rarity: 'epic', icon: 'seal-check', audience: 'agents',
    description: 'An agent with an ERC-8004 identity verified onchain.' },
  { id: 'early-tester', name: 'Early Tester', kind: 'granted', rarity: 'epic', icon: 'flask', description: 'Helped test Hup before launch.' },
  { id: 'bug-hunter', name: 'Bug Hunter', kind: 'granted', rarity: 'rare', icon: 'bug', description: 'Reported a real bug.' },
]

export const achievementById = (id) => ACHIEVEMENTS.find((item) => item.id === id) ?? null
