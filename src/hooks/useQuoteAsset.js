'use client'

/**
 * @file hooks/useQuoteAsset.js
 * @description What a Hup Launch is priced in — the chain's native coin, or the ERC20 an admin
 * approved as a quote asset. Every launch surface asks this instead of assuming native.
 *
 * Decimals are the reason this exists. A launch's price, market cap and volume are all raw base
 * units of its quote asset, so a USDC-quoted launch carries 1e6 units where a native one carries
 * 1e18. Rendering one with the other's precision is off by a factor of a trillion, which is not a
 * rounding error anyone notices as a rounding error — it reads as a plausible market cap.
 *
 * The curated list in lib/tokens.js supplies a symbol immediately so nothing renders blank, but
 * the chain is the authority: `decimals()` and `symbol()` are read onchain and win once they land.
 * They can never change, so the read is cached forever and shared across every card on the page.
 */

import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { appChains } from '@/config/contracts'
import { LAUNCH_QUOTES } from '@/lib/tokens'

export const NATIVE_QUOTE = '0x0000000000000000000000000000000000000000'

const erc20Abi = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
]

/**
 * Tokenized equities carry corporate actions in a multiplier rather than in the balance: a split
 * or a dividend moves `uiMultiplier()` and leaves `balanceOf` alone, which is exactly what makes
 * them safe to lock inside a pool. The cost is that raw token units stop equalling shares —
 * CRWD's multiplier is 4.0 after its split — so anything reported as shares scales by it.
 */
const multiplierAbi = [
  { name: 'uiMultiplier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

const WAD = 10n ** 18n

/** True when this launch is priced in the chain's own coin rather than a token. */
export const isNativeQuote = (quote) => !quote || String(quote).toLowerCase() === NATIVE_QUOTE

/** The curated candidate rows for a chain, or an empty list where none are configured. */
export const quoteCandidates = (chainId) => LAUNCH_QUOTES[chainId] ?? []

/**
 * Resolves one launch's quote asset.
 *
 * @param {number|null|undefined} chainId The chain the launch lives on.
 * @param {string|null|undefined} quote The launch's quote address; zero or absent means native.
 * @returns {{address: string, symbol: string, decimals: number, isNative: boolean,
 *   isResolved: boolean}} `isResolved` is false only while an ERC20's onchain read is in flight.
 */
export function useQuoteAsset(chainId, quote) {
  const isNative = isNativeQuote(quote)

  const nativeCurrency = useMemo(
    () => appChains.find((chain) => chain.id === chainId)?.nativeCurrency,
    [chainId],
  )

  // A curated row covers every asset an admin has allowlisted, so the onchain read is usually
  // just confirming what is already on screen rather than filling a gap
  const curated = useMemo(() => {
    if (isNative) return null
    const wanted = String(quote).toLowerCase()
    return quoteCandidates(chainId).find((row) => row.address.toLowerCase() === wanted) ?? null
  }, [chainId, quote, isNative])

  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: quote, abi: erc20Abi, functionName: 'symbol', chainId },
      { address: quote, abi: erc20Abi, functionName: 'decimals', chainId },
      // Absent on an ordinary ERC20, which is how an equity token is told apart from a stablecoin
      // without a list to keep current. allowFailure turns the missing function into a null.
      { address: quote, abi: multiplierAbi, functionName: 'uiMultiplier', chainId },
    ],
    // Symbol and decimals are immutable, but a multiplier moves on a corporate action — rare
    // enough to cache hard, real enough not to cache forever
    query: { enabled: Boolean(!isNative && quote && chainId), staleTime: 60 * 60 * 1000 },
  })

  const onchainSymbol = data?.[0]?.status === 'success' ? data[0].result : null
  const onchainDecimals = data?.[1]?.status === 'success' ? Number(data[1].result) : null
  const onchainMultiplier = data?.[2]?.status === 'success' ? BigInt(data[2].result) : null

  return useMemo(() => {
    if (isNative) {
      return {
        address: NATIVE_QUOTE,
        symbol: nativeCurrency?.symbol ?? 'ETH',
        decimals: nativeCurrency?.decimals ?? 18,
        isNative: true,
        isStock: false,
        multiplier: WAD,
        isResolved: true,
      }
    }

    return {
      address: quote,
      symbol: onchainSymbol || curated?.symbol || 'tokens',
      // 18 only as a last resort: a launch whose decimals cannot be read is broken either way,
      // and the alternative is rendering NaN across every figure on the page
      decimals: onchainDecimals ?? 18,
      isNative: false,
      isStock: onchainMultiplier !== null,
      // Identity for everything that is not an equity, so callers scale unconditionally rather
      // than branching on what kind of asset they happen to have
      multiplier: onchainMultiplier ?? WAD,
      isResolved: onchainDecimals !== null,
    }
  }, [isNative, quote, nativeCurrency, curated, onchainSymbol, onchainDecimals, onchainMultiplier])
}

/**
 * Raw quote units as the shares they represent.
 *
 * Only meaningful for an equity quote, and a no-op multiplication otherwise, so a caller holding
 * an amount of "whatever this launch is priced in" can convert without asking what it is.
 *
 * @param {bigint|string} amount Raw base units of the quote asset.
 * @param {bigint} multiplier The asset's `uiMultiplier`, WAD-scaled.
 */
export const toShareUnits = (amount, multiplier = WAD) => (BigInt(amount ?? 0) * BigInt(multiplier)) / WAD

export default useQuoteAsset
