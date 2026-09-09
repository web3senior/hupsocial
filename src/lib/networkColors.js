/**
 * @file lib/networkColors.js
 * @description Scopes a chain's colours to one element. `:root` carries the CONNECTED wallet's
 * colours — setNetworkColor() in config/wagmi.js paints `--network-color-primary` and
 * `--network-color-text` there — which says nothing about a surface whose content lives on
 * another chain: a drop, a collection, a tile in a grid that aggregates every network. Spread
 * the result into that element's `style` and every descendant reading those variables sees
 * the chain the content is on, not the chain the wallet happens to be on.
 */

/**
 * Inline style declaring a chain's colour variables, for a surface rooted on that chain.
 * @param {{primaryColor?: string, textColor?: string}|null|undefined} chain An app chain
 * object, or nothing when the chain is unknown — the surface then inherits `:root`'s.
 * @returns {Object|undefined} A React style object, or undefined when there is nothing to scope.
 */
export const networkColorStyle = (chain) =>
  chain?.primaryColor
    ? // Both or neither: a scoped primary with the text colour left to :root reads the wallet's
      // chain, which is how white lands on a light brand colour
      { '--network-color-primary': chain.primaryColor, '--network-color-text': chain.textColor || '#fff' }
    : undefined

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
