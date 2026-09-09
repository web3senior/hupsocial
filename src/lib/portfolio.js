/**
 * @file lib/portfolio.js
 * @description A wallet's holdings reduced to the four figures a profile card can show: the
 * native balance on one chain, what everything is worth in dollars, how that moved in a day,
 * and how many positions it is spread over.
 *
 * Server-side on purpose. The same read done in the browser costs roughly twenty RPC calls per
 * wallet, which a feed of hovered avatars turns into hundreds; here it happens once per address
 * and is then shared — by the process cache below, and by the CDN in front of the route.
 *
 * Discovery has the same shape as lib/walletAssets: LUKSO can enumerate holdings through its
 * index, every other chain only answers balanceOf, so elsewhere this sees the native coin plus
 * the curated candidates and nothing else. A figure built from that is a floor, never a ceiling.
 */

import { erc20Abi } from 'viem'
import { appChains } from '@/config/contracts'
import { SOLANA_MAINNET_ID, isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { fetchLuksoTokenHoldings, supportsTokenScan } from '@/lib/luksoAssets'
import { fetchUsdChange24h, fetchUsdPrices, priceKeyFor } from '@/lib/prices'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { candidateTokensFor, nativeCurrencyFor, normalizeAddress } from '@/lib/walletAssets'

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// Balances move on their own, but nobody hovering a card is watching for a transfer to land.
const CACHE_TTL_MS = 120_000

// A chain whose endpoints are all timing out must not hold the other eight hostage
const CHAIN_BUDGET_MS = 6_000

// Enough that a busy feed reuses nearly every read, small enough to never be the leak
const MAX_CACHE_ENTRIES = 500

const SOLANA_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Cached on globalThis so a hot reload reuses the snapshots instead of re-reading nine chains
// on every edit, the same reasoning as lib/serverPublicClient.
const globalForPortfolio = globalThis
const cache = globalForPortfolio.__hupPortfolio ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForPortfolio.__hupPortfolio = cache

/** True for anything this module can read — a checksummable EVM address or a Solana one. */
export const isPortfolioAddress = (value) =>
  Boolean(normalizeAddress(value)) || (typeof value === 'string' && SOLANA_ADDRESS.test(value))

const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))])

/**
 * Every non-zero position on one EVM chain: the native coin, then the curated candidates read
 * with balanceOf. Decimals come off the token rather than the config — the curated lists say
 * as much themselves, and an 18-decimal assumption on a 6-decimal stablecoin is a millionfold
 * error in the headline figure.
 */
async function readEvmChain(chainId, holder) {
  const client = getServerPublicClient(chainId)
  if (!client) return []

  const rows = []

  const native = await client.getBalance({ address: holder }).catch(() => null)
  const nativeCurrency = nativeCurrencyFor(chainId)
  if (native) rows.push({ chainId, address: null, balance: native.toString(), decimals: nativeCurrency.decimals })

  const tokens = candidateTokensFor(chainId)
  const probed = await Promise.all(
    tokens.map(async (token) => {
      // The transport batches these into one JSON-RPC request per chain
      const [balance, decimals] = await Promise.all([
        client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }).catch(() => null),
        client.readContract({ address: token.address, abi: erc20Abi, functionName: 'decimals' }).catch(() => null),
      ])
      if (!balance || decimals === null) return null
      return { chainId, address: token.address, balance: balance.toString(), decimals: Number(decimals) }
    })
  )

  return [...rows, ...probed.filter(Boolean)]
}

/**
 * SOL plus the SPL positions the wallet keeps a token account for. Raw JSON-RPC rather than
 * @solana/web3.js: two calls in one batched request, and no wallet-standard code pulled into a
 * route handler. Held mints are counted but never priced — pricing whatever a wallet happens to
 * hold is how an airdropped spoof would inflate the headline.
 */
async function readSolanaWallet(networkId, owner) {
  const chain = solanaChainFor(networkId)
  if (!chain) return []

  try {
    const response = await fetch(chain.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(CHAIN_BUDGET_MS),
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [owner] },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'getTokenAccountsByOwner',
          params: [owner, { programId: SOLANA_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }],
        },
      ]),
    })
    if (!response.ok) return []

    const body = await response.json()
    const byId = new Map((Array.isArray(body) ? body : []).map((entry) => [entry?.id, entry?.result]))

    const rows = []
    const lamports = byId.get(1)?.value
    if (typeof lamports === 'number' && lamports > 0) {
      rows.push({ chainId: Number(networkId), address: null, balance: String(lamports), decimals: 9 })
    }

    for (const account of byId.get(2)?.value ?? []) {
      const info = account?.account?.data?.parsed?.info
      const amount = info?.tokenAmount
      // An emptied token account stays open until its owner closes it; it is not a holding
      if (!amount || amount.amount === '0') continue
      rows.push({
        chainId: Number(networkId),
        address: info.mint,
        balance: String(amount.amount),
        decimals: Number(amount.decimals) || 0,
      })
    }

    return rows
  } catch {
    return []
  }
}

/** Every position across every chain, deduplicated, with the LUKSO index folded in. */
async function readHoldings(address) {
  const holder = normalizeAddress(address)

  if (!holder) {
    // Solana profiles carry a base58 address and no EVM twin. Mainnet only: devnet SOL has no
    // price, so a devnet card would headline a dollar figure that means nothing.
    return SOLANA_ADDRESS.test(address) ? readSolanaWallet(SOLANA_MAINNET_ID, address) : []
  }

  const scannedChains = appChains.filter((chain) => supportsTokenScan(chain.id))

  const [chainResults, scanResults] = await Promise.all([
    Promise.all(appChains.map((chain) => withTimeout(readEvmChain(chain.id, holder), CHAIN_BUDGET_MS, []))),
    Promise.all(scannedChains.map((chain) => withTimeout(fetchLuksoTokenHoldings(chain.id, holder), CHAIN_BUDGET_MS, []))),
  ])

  const rows = chainResults.flat()
  const seen = new Set(rows.filter((row) => row.address).map((row) => `${row.chainId}:${row.address.toLowerCase()}`))

  scannedChains.forEach((chain, index) => {
    for (const holding of scanResults[index]) {
      const key = `${chain.id}:${holding.address.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ chainId: chain.id, address: holding.address, balance: holding.balance, decimals: holding.decimals })
    }
  })

  return rows
}

/** Cached holdings for one wallet. The cache is keyed by wallet alone — chain scoping only
 * decides which row gets headlined, never which rows were read. */
async function loadHoldings(address) {
  const key = address.toLowerCase()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached

  const rows = await readHoldings(address)
  const entry = { at: Date.now(), rows }

  // Insertion order is eviction order — the oldest snapshot goes first
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  cache.set(key, entry)

  return entry
}

const toNumber = (balance, decimals) => {
  try {
    return Number(balance) / 10 ** decimals
  } catch {
    return 0
  }
}

/**
 * The summary a card renders.
 *
 * `networkId` picks which chain's native balance is headlined — a post's own chain, so the
 * figure beside a LUKSO post is LYX. With no match the largest native holding stands in, which
 * is what a wallet app would show.
 *
 * @param {string} address EVM or Solana wallet.
 * @param {number|string|null} networkId Chain to headline.
 * @returns {Promise<Object|null>} Null when the address is unreadable.
 */
export async function fetchPortfolioSummary(address, networkId = null) {
  if (!isPortfolioAddress(address)) return null

  const { at, rows } = await loadHoldings(address)

  const priceKeys = rows.map((row) => priceKeyFor(row.chainId, row.address ?? NATIVE_TOKEN))
  const [prices, changes] = await Promise.all([fetchUsdPrices(priceKeys), fetchUsdChange24h(priceKeys)])

  let totalUsd = 0
  let priced = 0
  // Value-weighted: a dollar of a token that doubled must not move the headline as far as the
  // rest of the portfolio standing still
  let weightedChange = 0
  let changeWeight = 0

  const valued = rows.map((row, index) => {
    const key = priceKeys[index]
    const rate = key ? prices.get(key) : undefined
    const usd = typeof rate === 'number' ? toNumber(row.balance, row.decimals) * rate : null
    if (usd !== null) {
      totalUsd += usd
      priced += 1
      const change = key ? changes.get(key) : undefined
      if (typeof change === 'number') {
        weightedChange += usd * change
        changeWeight += usd
      }
    }
    return { ...row, usd }
  })

  const natives = valued.filter((row) => row.address === null)
  const requested = natives.find((row) => Number(row.chainId) === Number(networkId))
  const headline = requested ?? [...natives].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))[0] ?? null

  const chainOf = (chainId) =>
    isSolanaNetworkId(chainId) ? solanaChainFor(chainId) : appChains.find((chain) => chain.id === Number(chainId)) ?? null

  return {
    address,
    // When the snapshot was taken, not when it was served — a card served from the CDN says how
    // stale its figures actually are
    updatedAt: Math.floor(at / 1000),
    totalUsd: priced > 0 ? totalUsd : null,
    change24h: changeWeight > 0 ? weightedChange / changeWeight : null,
    tokenCount: rows.length,
    chainCount: new Set(rows.map((row) => row.chainId)).size,
    native: headline
      ? {
          chainId: headline.chainId,
          symbol: isSolanaNetworkId(headline.chainId) ? 'SOL' : nativeCurrencyFor(headline.chainId).symbol,
          name: chainOf(headline.chainId)?.name ?? null,
          balance: headline.balance,
          decimals: headline.decimals,
          usd: headline.usd,
        }
      : null,
  }
}

export default fetchPortfolioSummary
