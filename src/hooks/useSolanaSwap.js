'use client'

/**
 * @file hooks/useSolanaSwap.js
 * @description The Solana half of the in-post trade widget's engine.
 *
 * Returns the same shape as useTokenSwap so the card can pick one of the two and render the
 * result without knowing which chain family it is looking at. The differences that matter are
 * all absences: SPL has no allowance, so nothing is ever approved; Jupiter does the routing, so
 * there is no venue race to run; and no creator fee is requested, because Jupiter will not take
 * one without a token account and a post's author has no linked Solana address to own it.
 *
 * Jupiter is reached straight from the browser; the cluster RPC is not, and goes through
 * api/v1/tokens/solana/*. See lib/solanaSwap.js for why they differ.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { canTradeOnSolana, solanaChainFor } from '@/config/solana'
import { signAndSendWithWallet } from '@/lib/solana/wallet'
import {
  WSOL_MINT,
  buildSolanaSwap,
  fetchSolanaAccount,
  fetchSolanaQuote,
  fetchSolanaStatus,
  fetchSolanaTokenInfo,
  isMint,
} from '@/lib/solanaSwap'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'

export const SOL_DECIMALS = 9

/**
 * A mint's identity and price from Jupiter, and the dollar price of SOL beside it — the two
 * figures the card's header and its dollar presets need.
 *
 * The EVM side reads both from /api/v1/tokens/market, which keys on an EVM chain id and has no
 * answer for a mint. Same information, different upstream.
 *
 * @param {string|null} mint
 */
export function useSolanaTokenInfo(mint, extraMints = []) {
  const wanted = isMint(mint)

  const { data: info } = useSWR(wanted ? ['solana-token', mint] : null, () => fetchSolanaTokenInfo(mint), {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    keepPreviousData: true,
  })

  // Shared key across every Solana card on the page, so a feed asks for SOL's price once
  const { data: sol } = useSWR(wanted ? ['solana-token', WSOL_MINT] : null, () => fetchSolanaTokenInfo(WSOL_MINT), {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    keepPreviousData: true,
  })

  // The card's other tokens, for the switcher's artwork. Only identity is wanted here, so this
  // never refreshes — a mint's icon does not move, unlike the price above it.
  const others = extraMints.filter((candidate) => isMint(candidate) && candidate !== mint)
  const { data: rest } = useSWR(
    others.length ? ['solana-tokens', [...others].sort().join(',')] : null,
    async () => {
      const rows = await Promise.all(others.map((candidate) => fetchSolanaTokenInfo(candidate).catch(() => null)))
      return Object.fromEntries(others.map((candidate, index) => [candidate, rows[index]]).filter(([, row]) => row))
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  return { info: info ?? null, solPrice: sol?.usd ?? null, others: rest ?? EMPTY_INFO }
}

const EMPTY_INFO = {}

// Long enough that a wallet prompt left open does not expire, short enough that a landed
// signature is reported while the card is still on screen
const CONFIRM_TIMEOUT_MS = 90_000
const CONFIRM_INTERVAL_MS = 2_500

/**
 * @param {Object} options
 * @param {number} options.chainId A Solana network id (501 mainnet).
 * @param {string|null} options.token The SPL mint being traded.
 * @param {'buy'|'sell'} options.direction Buy spends SOL, sell spends the token.
 * @param {bigint} options.amountIn Exact input in the spending side's base units.
 * @param {number} [options.slippageBps]
 */
/**
 * A mint's decimals and the viewer's two balances on that cluster.
 *
 * Exported for the same reason useTokenIdentity is on the EVM side: sizing a sell needs the
 * balance before an amount exists, and the amount is what the engine takes. Both callers share
 * one SWR key, so asking twice costs one request.
 *
 * @param {number|null} chainId
 * @param {string|null} mint
 * @param {string|null} owner
 */
export function useSolanaAccount(chainId, mint, owner) {
  const active = canTradeOnSolana(chainId) && isMint(mint)

  const { data, mutate } = useSWR(
    active ? ['solana-account', chainId, mint, owner ?? 'anon'] : null,
    () => fetchSolanaAccount({ networkId: chainId, mint, owner: owner ?? null }),
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  return {
    decimals: Number.isFinite(data?.decimals) ? data.decimals : null,
    tokenBalance: data?.balance ?? undefined,
    nativeBalance: data?.sol ?? undefined,
    refetch: mutate,
  }
}

export function useSolanaSwap({ chainId, token, direction = 'buy', amountIn = 0n, slippageBps = 250 }) {
  const { address, isConnected, getSigner } = useSolanaWallet()
  const buying = direction === 'buy'
  const active = canTradeOnSolana(chainId) && isMint(token)

  // --- mint identity and balances, through our own route ---

  const { decimals, tokenBalance, nativeBalance, refetch: refetchAccount } = useSolanaAccount(chainId, token, address)

  // --- the quote ---

  const inputMint = buying ? WSOL_MINT : token
  const outputMint = buying ? token : WSOL_MINT
  const wantsQuote = active && amountIn > 0n

  const {
    data: quote,
    isLoading: isQuoting,
    error: quoteError,
  } = useSWR(
    wantsQuote ? ['solana-quote', chainId, inputMint, outputMint, amountIn.toString(), slippageBps] : null,
    () => fetchSolanaQuote({ inputMint, outputMint, amount: amountIn, slippageBps }),
    { revalidateOnFocus: false, refreshInterval: 20_000, keepPreviousData: false },
  )

  // --- submission ---

  const [isBusy, setIsBusy] = useState(false)
  const [signature, setSignature] = useState(null)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const cancelledRef = useRef(false)

  useEffect(
    () => () => {
      cancelledRef.current = true
    },
    [],
  )

  const submit = useCallback(async () => {
    if (!active || !quote || amountIn <= 0n) return
    const signer = getSigner?.()
    if (!signer?.wallet || !signer?.account) {
      setSubmitError(new Error('Connect a Solana wallet first'))
      return
    }

    setIsBusy(true)
    setSubmitError(null)
    setIsConfirmed(false)

    try {
      const transaction = await buildSolanaSwap({ quote: quote.raw, userPublicKey: signer.account.address })
      const chain = solanaChainFor(chainId)
      // The wallet broadcasts through its own RPC — ours refuses browser callers, and this is
      // the same path the Solana posting flow already signs through
      const sent = await signAndSendWithWallet(signer.wallet, signer.account, transaction, chain.walletChain)
      if (cancelledRef.current) return
      setSignature(sent)

      // Optimistic from here: the signature is the receipt, and the verdict follows by poll
      const deadline = Date.now() + CONFIRM_TIMEOUT_MS
      for (;;) {
        if (cancelledRef.current) return
        const status = await fetchSolanaStatus({ networkId: chainId, signature: sent })
        if (status?.failed) throw new Error('The swap failed onchain')
        if (status?.confirmed) {
          if (!cancelledRef.current) {
            setIsConfirmed(true)
            refetchAccount()
          }
          return
        }
        if (Date.now() > deadline) return
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS))
      }
    } catch (error) {
      if (!cancelledRef.current) setSubmitError(error)
    } finally {
      if (!cancelledRef.current) setIsBusy(false)
    }
  }, [active, quote, amountIn, getSigner, chainId, refetchAccount])

  const spendBalance = buying ? nativeBalance : tokenBalance

  return {
    // identity
    decimals,
    symbol: null, // SPL mints carry no onchain symbol; the card falls back to the post's label
    tokenBalance,
    nativeBalance,
    nativeSymbol: 'SOL',
    // quote — Jupiter's output is already net of everything it charges, and Hup adds nothing
    quote: quote ? { amountOut: quote.outAmount, venue: 'jupiter' } : null,
    expectedOut: quote?.outAmount ?? 0n,
    minOut: 0n,
    feeAmount: 0n,
    feeBps: 0,
    priceImpactPct: quote?.priceImpactPct ?? null,
    isQuoting: Boolean(wantsQuote && isQuoting && !quote),
    noRoute: Boolean(wantsQuote && !isQuoting && (!quote || quoteError)),
    // action
    needsApproval: false,
    insufficient: amountIn > 0n && spendBalance !== undefined && amountIn > spendBalance,
    isBusy,
    isConfirmed,
    lastAction: 'swap',
    hash: signature,
    submitError,
    submit,
    isWalletConnected: isConnected,
    decimalsOfSpend: buying ? SOL_DECIMALS : decimals,
  }
}

export default useSolanaSwap
