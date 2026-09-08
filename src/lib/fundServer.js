/**
 * @file lib/fundServer.js
 * @description Server-only helpers shared by the Hup Fund API routes. Lives here rather than
 * in one route importing the other: a route module is an endpoint, not a library, and
 * importing across them drags a second handler into the first one's bundle.
 */

import { fetchUsdPrices, priceKeyFor } from '@/lib/prices'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

/**
 * Native coin prices for every chain on a page of campaigns, keyed by network id. Best
 * effort — a chain with no market price (every testnet) comes back null, and the client
 * then prints the coin amount alone rather than a wrong dollar figure.
 * @param {Array<number|string>} networkIds
 * @returns {Promise<Object<number, number|null>>}
 */
export const nativePricesFor = async (networkIds) => {
  const ids = [...new Set(networkIds.map(Number).filter(Boolean))]
  if (ids.length === 0) return {}

  const keys = ids.map((id) => priceKeyFor(id, NATIVE_TOKEN))
  const prices = await fetchUsdPrices(keys).catch(() => new Map())
  return Object.fromEntries(ids.map((id, index) => [id, prices.get(keys[index]) ?? null]))
}
