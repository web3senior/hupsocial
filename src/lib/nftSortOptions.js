/**
 * @file lib/nftSortOptions.js
 * @description Sort menus for a view that shows nothing but sales.
 *
 * GET /api/v1/nfts orders a sales-only view's time sorts by sale time — a sale settled from an
 * accepted offer was never listed, so "listed" order has nothing to stand on there. The menus
 * say so: newest/oldest read as sale times, and "Recently sold" folds into them since it would
 * be the same order twice.
 */

const SALE_LABELS = { newest: 'Recently sold', oldest: 'Oldest sold' }

/**
 * The sort options to offer for a view.
 * @param {Array<{value: string, label: string}>} options The full listing-view menu.
 * @param {boolean} isSoldView Whether the view shows only sales.
 */
export function sortOptionsFor(options, isSoldView) {
  if (!isSoldView) return options
  return options.filter((option) => option.value !== 'recently_sold').map((option) => ({ ...option, label: SALE_LABELS[option.value] || option.label }))
}

/**
 * The menu value to show for a sort — "Recently sold" is offered as "newest" in a sold view.
 * @param {string} sort
 * @param {boolean} isSoldView
 */
export function shownSort(sort, isSoldView) {
  return isSoldView && sort === 'recently_sold' ? 'newest' : sort
}
