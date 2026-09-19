/**
 * @file config/interestOptions.js
 * @description What a profile says it is into — a fixed catalogue, unlike the free-form `tags`
 * beside it, because every interest is drawn as a card with its own icon and colours and neither
 * can be invented from an arbitrary string.
 *
 * Slugs are the stored value and must never be renamed once shipped — a wallet that filed under
 * `nfts` keeps that string forever. An unknown slug is dropped on read rather than rendered, so
 * a profile saved by a later build still survives a rollback.
 *
 * Dependency-free on purpose, exactly like config/originOptions.js: the API route validates
 * writes against this list while the picker renders from it, and neither should pull in the
 * other's world. The icons live in components/ui/InterestIcon.jsx instead of here so that this
 * file stays importable on the server and the icon set still tree-shakes.
 *
 * Every `to` stop clears 4.5:1 against white, because the label sits at that end of the gradient.
 */

/** Gradient stops, light to deep, shared by interests that sit near each other. */
const PALETTE = {
  sky: ['#56ccf2', '#1565c0'],
  azure: ['#4facfe', '#0b63ce'],
  ocean: ['#7dd3fc', '#0369a1'],
  indigo: ['#8ab4f8', '#283593'],
  violet: ['#b39ddb', '#5e35b1'],
  grape: ['#e1a4ff', '#7b1fa2'],
  plum: ['#f7a8c4', '#9d174d'],
  rose: ['#f093fb', '#c2185b'],
  coral: ['#ff8a80', '#c62828'],
  sunset: ['#ffb36b', '#c2410c'],
  amber: ['#ffd280', '#b25a00'],
  lime: ['#9ae66e', '#2e7d32'],
  forest: ['#86efac', '#166534'],
  mint: ['#43e97b', '#0c7a52'],
  teal: ['#64e9e0', '#00695c'],
  slate: ['#b0bec5', '#37474f'],
}

// Sixteen palettes over thirty interests, spread so that no palette carries more than two — six
// cards drawn from the same well read as a colour scheme rather than as six different things.
export const INTEREST_OPTIONS = [
  { slug: 'art', label: 'Art', gradient: PALETTE.rose },
  { slug: 'music', label: 'Music', gradient: PALETTE.plum },
  { slug: 'photography', label: 'Photography', gradient: PALETTE.indigo },
  { slug: 'film', label: 'Film', gradient: PALETTE.slate },
  { slug: 'design', label: 'Design', gradient: PALETTE.violet },
  { slug: 'writing', label: 'Writing', gradient: PALETTE.amber },
  { slug: 'gaming', label: 'Gaming', gradient: PALETTE.grape },
  { slug: 'sports', label: 'Sports', gradient: PALETTE.lime },
  { slug: 'fitness', label: 'Fitness', gradient: PALETTE.coral },
  { slug: 'food', label: 'Food', gradient: PALETTE.sunset },
  { slug: 'travel', label: 'Travel', gradient: PALETTE.azure },
  { slug: 'nature', label: 'Nature', gradient: PALETTE.lime },
  { slug: 'pets', label: 'Pets', gradient: PALETTE.coral },
  { slug: 'science', label: 'Science', gradient: PALETTE.teal },
  { slug: 'physics', label: 'Physics', gradient: PALETTE.rose },
  { slug: 'maths', label: 'Maths', gradient: PALETTE.mint },
  { slug: 'space', label: 'Space', gradient: PALETTE.ocean },
  { slug: 'ai', label: 'AI', gradient: PALETTE.ocean },
  { slug: 'code', label: 'Code', gradient: PALETTE.sky },
  { slug: 'defi', label: 'DeFi', gradient: PALETTE.mint },
  { slug: 'trading', label: 'Trading', gradient: PALETTE.amber },
  { slug: 'nfts', label: 'NFTs', gradient: PALETTE.grape },
  { slug: 'dao', label: 'DAOs', gradient: PALETTE.teal },
  { slug: 'memes', label: 'Memes', gradient: PALETTE.sunset },
  { slug: 'books', label: 'Books', gradient: PALETTE.azure },
  { slug: 'podcasts', label: 'Podcasts', gradient: PALETTE.plum },
  { slug: 'fashion', label: 'Fashion', gradient: PALETTE.violet },
  { slug: 'health', label: 'Health', gradient: PALETTE.forest },
  { slug: 'news', label: 'News', gradient: PALETTE.indigo },
  { slug: 'learning', label: 'Learning', gradient: PALETTE.sky },
]

/** As many as fit a profile without the row turning into a second bio. */
export const MAX_INTERESTS = 6

const BY_SLUG = new Map(INTEREST_OPTIONS.map((option) => [option.slug, option]))

/**
 * One catalogue entry, or undefined for a slug this build does not know.
 * @param {string} slug
 * @returns {{slug: string, label: string, gradient: [string, string]}|undefined}
 */
export const findInterestOption = (slug) => BY_SLUG.get(String(slug ?? '').trim().toLowerCase())

/**
 * The stored form of whatever arrived: an array, or the JSON string a row holds. Unknown slugs
 * and duplicates are dropped and the rest is capped, so neither a hand-written API call nor a
 * row written by a later build can put anything unrenderable on a profile.
 * @param {string[]|string|null|undefined} raw
 * @returns {string[]}
 */
export function normalizeInterests(raw) {
  let list = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []

  const seen = []
  for (const entry of list) {
    const option = findInterestOption(entry)
    if (option && !seen.includes(option.slug)) seen.push(option.slug)
    if (seen.length === MAX_INTERESTS) break
  }
  return seen
}

/** The catalogue entries for a stored list, in the order they were saved. */
export const resolveInterests = (raw) => normalizeInterests(raw).map((slug) => BY_SLUG.get(slug))
