'use client'

/**
 * @file lib/solanaSwap.js
 * @description Jupiter, from the browser: quote a pair, build the transaction, read the account
 * state the quote cannot supply.
 *
 * Jupiter is called directly rather than proxied, unlike the cashtag price route next door. Two
 * reasons, and they both cut the other way from that one. A swap quote is keyed to one wallet's
 * exact amount, so there is nothing for a shared cache to hold; and Jupiter rate-limits by IP,
 * which means relaying every card's poll through one server address pools the whole app onto a
 * single bucket, where going direct spreads it across users. Jupiter sends CORS headers, so this
 * works — the cluster RPC does not, which is why the reads below still go through our own route.
 *
 * No platform fee is requested. Jupiter refuses a fee without a `feeAccount`, that account has to
 * be a real SPL token account, and a post's author is an EVM address — Hup has no linked Solana
 * address to derive one from yet. Asking for a fee with nowhere to send it would fail the swap.
 */

import { VersionedTransaction } from '@solana/web3.js'

const JUPITER_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote'
const JUPITER_SWAP = 'https://lite-api.jup.ag/swap/v1/swap'
const JUPITER_TOKEN = 'https://lite-api.jup.ag/tokens/v2/search?query='

/** Native SOL has no mint; wSOL is what every venue quotes against. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/** Base58, 32–44 characters — enough to reject an EVM address or a typo before any request. */
export const isMint = (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value ?? ''))

/**
 * A Jupiter quote for an exact input amount, or null when no route exists.
 *
 * @param {{inputMint: string, outputMint: string, amount: bigint|string, slippageBps?: number,
 *   signal?: AbortSignal}} params
 * @returns {Promise<{outAmount: bigint, priceImpactPct: number, raw: object}|null>}
 */
export async function fetchSolanaQuote({ inputMint, outputMint, amount, slippageBps = 250, signal }) {
  if (!isMint(inputMint) || !isMint(outputMint)) return null
  if (BigInt(amount ?? 0) <= 0n) return null

  const url = `${JUPITER_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
  const response = await fetch(url, { signal })
  if (!response.ok) return null

  const quote = await response.json()
  if (!quote?.outAmount) return null

  return {
    outAmount: BigInt(quote.outAmount),
    priceImpactPct: Number(quote.priceImpactPct) || 0,
    // Jupiter will only build a transaction from a quote object it produced itself, unaltered
    raw: quote,
  }
}

/**
 * The signed-transaction-shaped object Jupiter builds for a quote, ready for the wallet.
 *
 * @param {{quote: object, userPublicKey: string}} params
 * @returns {Promise<VersionedTransaction>}
 */
export async function buildSolanaSwap({ quote, userPublicKey }) {
  const response = await fetch(JUPITER_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      // Lets the router open and close the wSOL account around a native leg, so the reader
      // never has to hold wrapped SOL or clean up an account afterwards
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.error || 'Jupiter could not build that swap')
  }

  const { swapTransaction } = await response.json()
  if (!swapTransaction) throw new Error('Jupiter returned no transaction')

  return VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
}

/**
 * A mint's decimals plus the viewer's SOL and token balances, through our own route — the
 * public clusters answer browser callers with 403.
 *
 * @param {{networkId: number, mint: string, owner?: string|null, signal?: AbortSignal}} params
 * @returns {Promise<{decimals: number, sol: bigint|null, balance: bigint|null}|null>}
 */
export async function fetchSolanaAccount({ networkId, mint, owner, signal }) {
  if (!isMint(mint)) return null

  const params = new URLSearchParams({ networkId: String(networkId), mint })
  if (owner) params.set('owner', owner)

  const response = await fetch(`/api/v1/tokens/solana/account?${params}`, { signal })
  if (!response.ok) return null

  const body = await response.json()
  const data = body?.data
  if (!data) return null

  return {
    decimals: Number(data.decimals),
    sol: data.sol === null || data.sol === undefined ? null : BigInt(data.sol),
    balance: data.balance === null || data.balance === undefined ? null : BigInt(data.balance),
  }
}

/** Whether a signature has landed, through our own route. */
export async function fetchSolanaStatus({ networkId, signature, signal }) {
  const params = new URLSearchParams({ networkId: String(networkId), signature })
  const response = await fetch(`/api/v1/tokens/solana/status?${params}`, { signal })
  if (!response.ok) return null
  return (await response.json())?.data ?? null
}

/**
 * A mint's identity, price and standing from Jupiter's token index.
 *
 * Jupiter is asked rather than the chain because an SPL mint carries no symbol of its own — the
 * name lives in Metaplex metadata, and Jupiter has already resolved it. A mint Jupiter does not
 * index is also a mint it cannot route, so refusing one here is the same check as refusing a
 * token with no pool on the EVM side.
 *
 * `isVerified` and `organicScore` come back because on Solana a ticker is not a unique key:
 * every popular symbol has spoof mints that copy the name as well, at a fraction of a percent
 * of the real market cap. config/solanaTokens.js deals with that by refusing to resolve a
 * symbol at all; a widget takes a mint directly, so instead it warns the author before the post
 * goes out.
 *
 * @param {string} mint
 * @returns {Promise<Object|null>}
 */
export async function fetchSolanaTokenInfo(mint) {
  if (!isMint(mint)) return null

  const response = await fetch(`${JUPITER_TOKEN}${mint}`)
  if (!response.ok) return null

  const rows = await response.json()
  const row = Array.isArray(rows) ? rows.find((entry) => entry?.id === mint) : null
  if (!row) return null

  return {
    symbol: row.symbol ?? null,
    name: row.name ?? null,
    decimals: Number.isFinite(row.decimals) ? Number(row.decimals) : null,
    logo: row.icon ?? null,
    usd: Number.isFinite(row.usdPrice) ? row.usdPrice : null,
    change24h: Number.isFinite(row.stats24h?.priceChange) ? row.stats24h.priceChange : null,
    liquidity: Number.isFinite(row.liquidity) ? row.liquidity : null,
    isVerified: Boolean(row.isVerified),
    organicScore: Number.isFinite(row.organicScore) ? row.organicScore : null,
  }
}
