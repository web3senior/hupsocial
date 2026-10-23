/**
 * @file lib/networkColors.js
 * @description Shared app accent for surfaces that previously used network-dependent colors.
 * Network identity is represented by its name and logo, independent of control styling.
 */

/**
 * Keep existing surface callers on the app accent regardless of their chain argument.
 * @returns {Object} A React style object using the stable app accent.
 */
export const networkColorStyle = () => ({
  '--network-color-primary': 'var(--app-accent, #1d9bf0)',
  '--network-color-text': 'var(--app-accent-text, #fff)',
})

/**
 * A chain's logo as an image source: the hosted icon when the config carries one, else its inline
 * SVG as a data URL. Null for a chain with neither.
 * @param {Object|null|undefined} chain An entry from appChains.
 * @returns {string|null}
 */
export const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}
