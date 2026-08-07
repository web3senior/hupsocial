'use client'

/**
 * @file lib/luksoAssets.js
 * @description Fungible (LSP7) wallet discovery on LUKSO.
 *
 * LUKSO is the one chain that can answer "which tokens does this wallet hold" — the Envio index
 * behind Universal Profiles keeps a Hold row per (profile, asset), and the fungible rows are the
 * ones with a null token_id (a non-null token_id is an individual LSP8 NFT, which is what
 * nftInventory.js reads). Everywhere else the app has to probe a candidate list with balanceOf.
 *
 * The index hands back decimals, symbol and icon alongside the balance, so a scanned LUKSO token
 * needs no follow-up onchain reads at all.
 */

const LUKSO_CHAIN_IDS = [42, 4201]

// One row per token held; a wallet with more distinct tokens than this is vanishingly rare and
// the tail would be dust anyway
const MAX_HOLDINGS = 100

/** True when fetchLuksoTokenHoldings can enumerate this chain's fungible holdings. */
export const supportsTokenScan = (chainId) => LUKSO_CHAIN_IDS.includes(Number(chainId))

/**
 * Every LSP7 the wallet holds a non-zero balance of, largest first. Returns [] on any other
 * chain, a missing endpoint, or network failure — the caller still has its candidate probe.
 * @param {number} chainId
 * @param {string} owner Wallet address.
 * @returns {Promise<Array<{address: string, symbol: string, name: string|null, decimals: number, balance: string, icon: string|null}>>}
 */
export async function fetchLuksoTokenHoldings(chainId, owner) {
  if (!supportsTokenScan(chainId) || !owner) return []

  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) return []

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `query WalletTokenHoldings($owner: String!, $limit: Int!) {
          Hold(
            where: {
              profile_id: {_eq: $owner}
              token_id: {_is_null: true}
              balance: {_gt: "0"}
              asset: {isLSP7: {_eq: true}}
            }
            order_by: {balance: desc}
            limit: $limit
          ) {
            balance
            asset {
              id
              decimals
              lsp4TokenName
              lsp4TokenSymbol
              icons(limit: 1) { src }
            }
          }
        }`,
        variables: { owner: owner.toLowerCase(), limit: MAX_HOLDINGS },
      }),
    })
    if (!response.ok) return []

    const body = await response.json()
    if (body?.errors) return []

    return (body?.data?.Hold || [])
      .filter((hold) => hold?.asset?.id?.startsWith('0x'))
      .map((hold) => ({
        address: hold.asset.id,
        symbol: hold.asset.lsp4TokenSymbol || hold.asset.lsp4TokenName || 'Token',
        name: hold.asset.lsp4TokenName || null,
        // decimals is nullable on the index; LSP7 defaults to 18 the same way ERC20 does
        decimals: Number.isFinite(Number(hold.asset.decimals)) ? Number(hold.asset.decimals) : 18,
        balance: String(hold.balance),
        // Raw storage reference — callers run it through resolveStorageImageUrl
        icon: hold.asset.icons?.[0]?.src || null,
      }))
  } catch {
    return []
  }
}
