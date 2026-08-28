'use client'

import useStoredChoice from './useStoredChoice'

// Density, not content: every layout shows the same items, so switching is free and nothing has
// to refetch
export const GRID_LAYOUTS = ['comfortable', 'compact', 'list']

/**
 * Remember which grid density a reader picked, per surface.
 * A named slice of useStoredChoice — the density is the one stored choice with a fixed set of
 * values, so callers name the surface and nothing else.
 * @param {string} key Storage key suffix, e.g. 'nft-collection-layout'.
 * @param {string} [fallback='comfortable'] Layout for a reader who has never chosen.
 * @returns {[string, Function]} The current layout and a setter that persists it.
 */
export default function useGridLayout(key, fallback = 'comfortable') {
  return useStoredChoice(key, GRID_LAYOUTS, fallback)
}
