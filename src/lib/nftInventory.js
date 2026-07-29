'use client'

/**
 * @file lib/nftInventory.js
 * @description Wallet NFT discovery for the sell flow.
 *
 * LUKSO is the one chain the app can ask "what does this wallet hold". The Envio index behind
 * Universal Profiles keeps a Hold row per (profile, token) — the same source profile and LSP7
 * lookups already use — so a real wallet scan is one query. No comparable index exists for the
 * other chains, where ownership is only knowable one collection at a time onchain
 * (see useOwnedTokenIds); callers there suggest collections and probe them instead of scanning.
 */

const LUKSO_CHAIN_IDS = [42, 4201]

// Holds are one row per token, so a whale in a big collection can return a lot of them. The cap
// is about the collection rollup below staying cheap, not about listing every token.
const MAX_HOLDS = 300
const MAX_COLLECTIONS = 12
const MAX_SEARCH_RESULTS = 8

/** True when fetchWalletCollections can enumerate a wallet's collections on this chain. */
export const supportsWalletScan = (chainId) => LUKSO_CHAIN_IDS.includes(chainId)

async function queryEnvio(query, variables) {
  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) return null

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) return null

  const body = await response.json()
  return body?.data ?? null
}

// Envio serves both a collection icon and a cover image; the icon is the square one, so it
// reads better at avatar size and the cover is only the fallback.
const pickCollectionImage = (asset) => asset?.icons?.[0]?.src || asset?.images?.[0]?.src || null

/**
 * Collections the wallet holds at least one LSP8 token in, most tokens held first. Returns []
 * on any chain without a wallet index, on a missing endpoint, or on network failure — the
 * caller's other suggestion sources carry the picker in that case.
 * @param {number} chainId
 * @param {string} owner Wallet address.
 * @returns {Promise<Array<{address: string, name: string|null, symbol: string|null, image: string|null, ownedCount: number}>>}
 */
export async function fetchWalletCollections(chainId, owner) {
  if (!supportsWalletScan(chainId) || !owner) return []

  try {
    const data = await queryEnvio(
      `query WalletNftCollections($owner: String!, $limit: Int!) {
        Hold(
          where: {profile_id: {_eq: $owner}, token_id: {_is_null: false}, balance: {_gt: "0"}}
          limit: $limit
        ) {
          token_id
          baseAsset {
            id
            lsp4TokenName
            lsp4TokenSymbol
            icons(limit: 1) { src }
            images(limit: 1) { src }
          }
        }
      }`,
      { owner: owner.toLowerCase(), limit: MAX_HOLDS },
    )

    const byAddress = new Map()
    for (const hold of data?.Hold || []) {
      // baseAsset is the collection; Hold.token_id is "{collection}-{bytes32 id}", which is the
      // fallback when the collection itself hasn't been indexed as an Asset yet
      const address = hold?.baseAsset?.id || `${hold?.token_id || ''}`.split('-')[0]
      if (!address || !address.startsWith('0x')) continue

      const key = address.toLowerCase()
      const existing = byAddress.get(key)
      if (existing) {
        existing.ownedCount += 1
        continue
      }
      byAddress.set(key, {
        address,
        name: hold?.baseAsset?.lsp4TokenName || null,
        symbol: hold?.baseAsset?.lsp4TokenSymbol || null,
        image: pickCollectionImage(hold?.baseAsset),
        ownedCount: 1,
      })
    }

    return [...byAddress.values()].sort((a, b) => b.ownedCount - a.ownedCount).slice(0, MAX_COLLECTIONS)
  } catch {
    return []
  }
}

/**
 * Searches NFT collections by name, most-held first. Same caveat as the token search it mirrors:
 * anyone can name a collection anything, so the picker shows the contract address alongside.
 * @param {number} chainId
 * @param {string} query
 * @returns {Promise<Array<{address: string, name: string|null, symbol: string|null, image: string|null, holderCount: number|null}>>}
 */
export async function searchNftCollections(chainId, query) {
  const trimmed = query.trim()
  if (!supportsWalletScan(chainId) || trimmed.length < 2) return []

  try {
    const data = await queryEnvio(
      `query SearchNftCollections($q: String!, $limit: Int!) {
        Asset(
          where: {lsp4TokenName: {_ilike: $q}, isCollection: {_eq: true}, isLSP7: {_eq: false}}
          limit: $limit
          order_by: {baseHolders_aggregate: {count: desc}}
        ) {
          id
          lsp4TokenName
          lsp4TokenSymbol
          baseHolders_aggregate { aggregate { count } }
          icons(limit: 1) { src }
          images(limit: 1) { src }
        }
      }`,
      { q: `%${trimmed}%`, limit: MAX_SEARCH_RESULTS },
    )

    return (data?.Asset || [])
      .filter((asset) => asset?.id)
      .map((asset) => ({
        address: asset.id,
        name: asset.lsp4TokenName || null,
        symbol: asset.lsp4TokenSymbol || null,
        image: pickCollectionImage(asset),
        // LSP8 holders hang off the collection as baseHolders — holders_aggregate counts
        // fungible LSP7 balances and reads 0 for every collection
        holderCount: asset.baseHolders_aggregate?.aggregate?.count ?? null,
      }))
  } catch {
    return []
  }
}

/**
 * Reads many contracts in one round trip where the chain has Multicall3, falling back to
 * individual reads where it doesn't (the app's transports are plain http(), so without this
 * a suggestion list would fire dozens of separate RPC requests). Mirrors multicall's
 * allowFailure shape so callers read results the same way either way.
 * @param {Object} publicClient viem public client for the target chain.
 * @param {Array<Object>} contracts viem contract-read descriptors.
 * @returns {Promise<Array<{status: 'success'|'failure', result: any}>>}
 */
export async function batchReadContracts(publicClient, contracts) {
  if (!publicClient || contracts.length === 0) return []

  try {
    return await publicClient.multicall({ contracts, allowFailure: true })
  } catch {
    return Promise.all(
      contracts.map((contract) =>
        publicClient
          .readContract(contract)
          .then((result) => ({ status: 'success', result }))
          .catch(() => ({ status: 'failure', result: undefined })),
      ),
    )
  }
}
