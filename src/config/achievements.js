export const RARITIES = ['common', 'rare', 'epic', 'legendary']
export const RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }
// OG goes to wallets that posted (a post or a reply, not a repost) before this UTC moment. Posting,
// not signing up: a July 2026 wave of wallets connected once and never spoke, and OG is for the
// people who were actually here.
export const OG_CUTOFF = '2026-11-05 00:00:00'
// Fixed locale and zone, so the server and the client print the same words.
const OG_CUTOFF_LABEL = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.parse(`${OG_CUTOFF.replace(' ', 'T')}Z`))

export const ACHIEVEMENTS = [
  { id: 'og', name: 'OG', kind: 'auto', rarity: 'legendary', icon: 'crown', description: `Posted on Hup before ${OG_CUTOFF_LABEL}.` },
  { id: 'season-top-10', name: 'Season Top 10', kind: 'auto', rarity: 'epic', icon: 'trophy', perSeason: true, description: 'Finished in the top 10 of a points season.' },
  { id: 'first-post', name: 'First Words', kind: 'auto', rarity: 'common', icon: 'pencil', description: 'Published a first post.' },
  { id: 'first-tip', name: 'Tipper', kind: 'auto', rarity: 'common', icon: 'hand-coins', description: 'Sent a first tip.' },
  { id: 'generous', name: 'Generous', kind: 'auto', rarity: 'rare', icon: 'gift', threshold: 50, description: 'Sent 50 tips.' },
  { id: 'rising-voice', name: 'Rising Voice', kind: 'auto', rarity: 'rare', icon: 'megaphone', threshold: 100, description: 'Reached 100 qualified followers.' },
  { id: 'early-tester', name: 'Early Tester', kind: 'granted', rarity: 'epic', icon: 'flask', description: 'Helped test Hup before launch.' },
  { id: 'bug-hunter', name: 'Bug Hunter', kind: 'granted', rarity: 'rare', icon: 'bug', description: 'Reported a real bug.' },
]

export const achievementById = (id) => ACHIEVEMENTS.find((item) => item.id === id) ?? null
