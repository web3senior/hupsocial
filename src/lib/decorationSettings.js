/**
 * @file lib/decorationSettings.js
 * @description What the admin can change about a decoration without a deploy — its price, whether
 * it is kept out of feeds, whether the shop offers it — and how that lands on a catalog entry.
 * Pure, so the server (lib/decorationCatalog.js), every avatar and the admin page read it alike.
 */

import { DECORATIONS, isProfileOnly, PROFILE_ONLY_SIZE } from '../config/decorations.js'

/* The smallest a decoration taken out of profile-only is drawn: a feed byline. A piece the catalog
   already lets go smaller (the neon ring, at 24) keeps its own figure. */
const FEED_MIN_SIZE = 32
export const MAX_PRICE_USD = 1000

/**
 * A catalog entry as it stands with the admin's setting applied. Every live entry carries
 * `priceUsd`, `profileOnly` and `listed`; `minSize` follows `profileOnly`, so isPaid and
 * isProfileOnly read the result exactly as they read the catalog.
 * @param {Object} item A config/decorations.js entry.
 * @param {{priceUsd: number, profileOnly: boolean, listed: boolean}} [setting] The admin's row.
 */
export const applyDecorationSetting = (item, setting) => {
  const base = { ...item, priceUsd: Number(item.priceUsd) || 0, profileOnly: isProfileOnly(item), listed: true, overridden: false }
  if (!setting) return base
  const profileOnly = Boolean(setting.profileOnly)
  return {
    ...base,
    priceUsd: Number(setting.priceUsd) || 0,
    profileOnly,
    listed: Boolean(setting.listed),
    minSize: profileOnly ? Math.max(item.minSize, PROFILE_ONLY_SIZE) : Math.min(item.minSize, FEED_MIN_SIZE),
    overridden: true,
  }
}

/**
 * The whole catalog with settings applied, keyed by id.
 * @param {Object<string, Object>} [settings] `{ [decorationId]: setting }`.
 * @returns {Map<string, Object>}
 */
export const liveCatalog = (settings = {}) => new Map(DECORATIONS.map((item) => [item.id, applyDecorationSetting(item, settings[item.id])]))

export const decorationSettingMessage = ({ decorationId, reset, priceUsd, profileOnly, listed, nonce }) => [
  'Update a decoration on Hup',
  '',
  `Decoration: ${decorationId}`,
  ...(reset
    ? ['Action: Reset to catalog']
    : ['Action: Set', `Price: $${Number(priceUsd).toFixed(2)}`, `Profile only: ${profileOnly ? 'yes' : 'no'}`, `In shop: ${listed ? 'yes' : 'no'}`]),
  `Nonce: ${nonce}`,
].join('\n')
