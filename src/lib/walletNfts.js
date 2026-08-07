'use client'

/**
 * @file lib/walletNfts.js
 * @description NFT (LSP8) wallet discovery on LUKSO.
 *
 * The mirror of luksoAssets.js: the same Envio Hold table, but the rows with a non-null
 * token_id — those are individual NFTs rather than a fungible balance. nftInventory.js already
 * reads this shape to roll holdings up into collections for the sell flow; here each token stays
 * its own row, because the gallery shows individual artwork.
 *
 * As with fungibles, LUKSO is the only chain that can answer "what does this wallet hold".
 * Everywhere else ownership is knowable one collection at a time (see useOwnedTokenIds), which
 * needs a candidate list the NFT space doesn't have — so this returns [] off LUKSO and the
 * gallery renders nothing rather than an empty grid.
 */

import { pad, toHex } from 'viem'

const LUKSO_CHAIN_IDS = [42, 4201]

// A gallery, not an inventory export. Kept low deliberately: NFT artwork is frequently huge
// (ORBS ships a 4.9MB animated GIF per token), so a big grid is megabytes of download before
// anything is readable.
const MAX_NFTS = 24

/** True when fetchLuksoNfts can enumerate this chain's NFT holdings. */
export const supportsNftScan = (chainId) => LUKSO_CHAIN_IDS.includes(Number(chainId))

/**
 * ERC721 ids are decimal numbers, LSP8 ids are bytes32 — normalize both to the bytes32 form
 * the LSP8 transfer takes. Invalid or incomplete input resolves to null so callers stay disabled.
 * (Same rule SellNftModal applies when writing a listing.)
 */
export const normalizeTokenId = (raw) => {
  const value = `${raw}`.trim()
  if (!value) return null
  try {
    if (value.startsWith('0x')) {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null
      return pad(value, { size: 32 })
    }
    if (!/^\d+$/.test(value)) return null
    return toHex(BigInt(value), { size: 32 })
  } catch {
    return null
  }
}

// Envio hands back UP-cloud CDN URLs, whose ?method/&data pair is a verification hash rather
// than content selection — the CID alone identifies the artwork. That CDN silently ignores
// ?width on animated GIFs (it returned the full 4.9MB ORBS file either way, and enough of those
// in one grid fail outright), so unwrap the CID and let the app's own IPFS image proxy resize it.
const UP_CLOUD_IMAGE = /^https:\/\/api\.universalprofile\.cloud\/image\/([^?/]+)/

const proxyableSource = (src) => {
  if (!src) return null
  const cid = src.match(UP_CLOUD_IMAGE)?.[1]
  // ipfs:// prefix, not the bare CID — that's what isIPFSHash recognises
  return cid ? `ipfs://${cid}` : src
}

// Envio serves both artwork and a square icon; the artwork is the display piece and the icon
// only the fallback, since several collections publish no icon at all
const pickTokenImage = (token) => token?.images?.[0]?.src || token?.icons?.[0]?.src || null

/**
 * Every LSP8 token the wallet holds. Returns [] on any other chain, a missing endpoint, or
 * network failure — the gallery simply doesn't render.
 * @param {number} chainId
 * @param {string} owner Wallet address.
 * @returns {Promise<Array<{id: string, address: string, tokenId: string, label: string, name: string, collection: string|null, image: string|null}>>}
 */
export async function fetchLuksoNfts(chainId, owner) {
  if (!supportsNftScan(chainId) || !owner) return []

  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) return []

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query WalletNfts($owner: String!, $limit: Int!) {
          Hold(
            where: {
              profile_id: {_eq: $owner}
              token_id: {_is_null: false}
              balance: {_gt: "0"}
            }
            limit: $limit
          ) {
            token {
              id
              tokenId
              formattedTokenId
              name
              lsp4TokenName
              images(limit: 1) { src }
              icons(limit: 1) { src }
              baseAsset {
                id
                lsp4TokenName
                lsp4TokenSymbol
              }
            }
          }
        }`,
        variables: { owner: owner.toLowerCase(), limit: MAX_NFTS },
      }),
    })
    if (!response.ok) return []

    const body = await response.json()
    if (body?.errors) return []

    const rows = []
    for (const hold of body?.data?.Hold || []) {
      const token = hold?.token
      // Hold.token_id is "{collection}-{bytes32 id}", the fallback when the collection itself
      // hasn't been indexed as an Asset yet
      const address = token?.baseAsset?.id || `${token?.id || ''}`.split('-')[0]
      const tokenId = normalizeTokenId(token?.tokenId)
      if (!address?.startsWith('0x') || !tokenId) continue

      const collection = token?.baseAsset?.lsp4TokenName || token?.baseAsset?.lsp4TokenSymbol || null
      rows.push({
        id: `${chainId}:${address.toLowerCase()}:${tokenId}`,
        chainId: Number(chainId),
        address,
        tokenId,
        // formattedTokenId is the human id the collection intends ("7287", not the bytes32)
        label: token?.formattedTokenId || null,
        name: token?.name || token?.lsp4TokenName || collection || 'Untitled',
        collection,
        image: proxyableSource(pickTokenImage(token)),
        // The CDN original, kept so a tile can heal itself: the resize proxy times out on the
        // heaviest artwork, where the unresized CDN copy still serves fine
        imageOriginal: pickTokenImage(token),
        isLsp8: true,
      })
    }

    return rows
  } catch {
    return []
  }
}
