/**
 * @file config/decorations.js
 * @description The avatar decoration catalog. Pure data, shared by the API (what may be equipped)
 * and the client (what to draw — components/decorations maps each id to its SVG).
 *
 * A wallet wears at most one decoration per slot, and the slots stack: `back` is drawn behind the
 * picture, the rest over it in the order listed here.
 */

export const DECORATION_SLOTS = ['back', 'ring', 'effect', 'crown']

export const SLOT_LABELS = {
  back: 'Wings',
  ring: 'Ring',
  effect: 'Effect',
  crown: 'Crown',
}

/* Feed avatars top out at 48px, so a decoration that starts here is never drawn in a feed — only
   on profile surfaces: the profile header and the hover card. For the loud pieces, which would
   pull the eye off the posts themselves. */
export const PROFILE_ONLY_SIZE = 64

/* `minSize` is the smallest laid-out avatar, in px, the decoration is drawn at. Below it the layer
   is dropped rather than shrunk: wings spread past a byline's name, and a 2px halo is noise.
   `priceUsd` makes it a purchase (lib/decorationShop.js), charged in the network's coin at the
   price of the moment; without one it is free for anyone to wear. */
export const DECORATIONS = [
  { id: 'fluffy-kitten', slot: 'effect', name: 'Fluffy Kitten', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'nine-tailed-fox', slot: 'effect', name: 'Nine-Tailed Fox', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'neon-ring', slot: 'ring', name: 'Neon ring', minSize: 24 },
  { id: 'lightning', slot: 'effect', name: 'Lightning', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'soft-fire', slot: 'effect', name: 'Soft fire', minSize: 32, priceUsd: 2 },
  { id: 'rain', slot: 'effect', name: 'Rain', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'clouds', slot: 'effect', name: 'Clouds', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'snow', slot: 'effect', name: 'Snow', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'starlight', slot: 'effect', name: 'Starlight', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'bubbles', slot: 'effect', name: 'Bubbles', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'hearts', slot: 'effect', name: 'Hearts', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'halloween', slot: 'effect', name: 'Halloween', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'galaxy', slot: 'effect', name: 'Galaxy', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'sun', slot: 'effect', name: 'Sun', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'coffee', slot: 'effect', name: 'Coffee', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'sea', slot: 'effect', name: 'Sea', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'devil', slot: 'effect', name: 'Devil', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'snake', slot: 'effect', name: 'Snake', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'ghost', slot: 'effect', name: 'Ghost', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'solar-system', slot: 'effect', name: 'Solar System', minSize: PROFILE_ONLY_SIZE, priceUsd: 3 },
  { id: 'butterflies', slot: 'back', name: 'Butterflies', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'sakura', slot: 'effect', name: 'Sakura', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'aurora', slot: 'effect', name: 'Aurora', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'music', slot: 'effect', name: 'Music', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'cat', slot: 'effect', name: 'Cat', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'cyber', slot: 'effect', name: 'Cyber', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'jellyfish', slot: 'effect', name: 'Jellyfish', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'dragon', slot: 'effect', name: 'Dragon', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
  { id: 'golden-dragon', slot: 'effect', name: 'Golden Dragon', minSize: PROFILE_ONLY_SIZE, priceUsd: 3 },
  { id: 'top-hat', slot: 'crown', name: 'Top Hat', minSize: PROFILE_ONLY_SIZE, priceUsd: 1 },
  { id: 'halo', slot: 'crown', name: 'Halo', minSize: 32, priceUsd: 1 },
  { id: 'angel-wings', slot: 'back', name: 'Angel wings', minSize: PROFILE_ONLY_SIZE, priceUsd: 2 },
]

/** Whether a catalog entry has to be bought before it can be worn. */
export const isPaid = (item) => Number(item?.priceUsd) > 0

/** Seasonal is reserved for entries with an explicitly configured availability season. */
export const decorationLabel = (item) => item?.season ? 'Seasonal' : isPaid(item) ? 'Premium' : 'Free'

/** Whether a catalog entry is kept out of feeds. */
export const isProfileOnly = (item) => item.minSize >= PROFILE_ONLY_SIZE

const BY_ID = new Map(DECORATIONS.map((item) => [item.id, item]))

/** The catalog entry for an id, or undefined for one this build does not list. */
export const findDecoration = (id) => BY_ID.get(id)

/**
 * Only the slots holding an id this build lists, for that slot. Anything else — an old id, a
 * hand-edited row, a slot name the catalog dropped — reads as nothing equipped there.
 * @param {Object} [equipped] `{ [slot]: decorationId }`.
 * @returns {Object} The same shape, cleaned.
 */
export const normalizeDecorations = (equipped) => {
  const clean = {}
  for (const slot of DECORATION_SLOTS) {
    const item = findDecoration(equipped?.[slot])
    if (item?.slot === slot) clean[slot] = item.id
  }
  return clean
}
