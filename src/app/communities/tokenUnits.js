'use client'

// Token-amount plumbing shared by the community cards and forms.
//
// Onchain every balance is an integer in the asset's smallest unit, and showing or asking for
// that raw number is unreadable (a 1 USDC price reads as 1000000). So every amount that reaches
// the UI is scaled by the asset's own decimals — the chain's nativeCurrency for the native coin,
// decimals() for an ERC-20/LSP7 — and every amount leaving it is scaled back.

import { useEffect } from 'react'
import { useReadContract } from 'wagmi'
import { erc20Abi, formatUnits, hexToString, isAddress } from 'viem'
import { appChains } from '@/config/contracts'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// A blank or zero asset address means the chain's native coin, the way the contract stores it
export const isNativeAsset = (address) => !address || address === ZERO_ADDRESS

// LSP7 assets have no symbol() — their LSP4 metadata lives in ERC725Y storage under the
// keccak256('LSP4TokenSymbol') data key, the same read the tip modal uses
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'
const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// Decimals never change for a deployed asset, so one read per chain+address is enough for the
// whole session. useTokenMeta fills this too, which is what makes the forms' submit-time lookup
// instant for any token the page has already rendered.
const decimalsCache = new Map()
const decimalsKey = (chainId, address) => `${chainId}:${String(address).toLowerCase()}`

export const getNativeCurrency = (chainId) =>
  appChains.find((chain) => chain.id === Number(chainId))?.nativeCurrency ?? { name: 'Native coin', symbol: '', decimals: 18 }

/**
 * Decimals for an asset, outside React — the forms need them at submit time, where a hook result
 * would arrive too late. Throws when the read fails: a guessed scale would write a price off by
 * orders of magnitude, so callers surface the failure instead of proceeding.
 */
export async function fetchTokenDecimals(publicClient, chainId, address) {
  if (isNativeAsset(address)) return getNativeCurrency(chainId).decimals

  const key = decimalsKey(chainId, address)
  if (decimalsCache.has(key)) return decimalsCache.get(key)
  if (!publicClient) throw new Error(`No RPC client for chain ${chainId}`)

  const value = Number(await publicClient.readContract({ address, abi: erc20Abi, functionName: 'decimals' }))
  decimalsCache.set(key, value)
  return value
}

/**
 * decimals + symbol for an asset address. A blank or zero address resolves to the chain's native
 * coin, so callers can pass whatever the contract handed back without branching first.
 */
export function useTokenMeta(address, chainId) {
  const native = getNativeCurrency(chainId)
  const isNative = isNativeAsset(address)
  // Half-typed addresses in the forms are simply "no token yet" — never a failing read
  const enabled = !isNative && isAddress(String(address || ''))

  // decimals() shares its selector on ERC-20 and LSP7, so one read covers both
  const { data: decimalsData } = useReadContract({
    address,
    abi: erc20Abi,
    chainId,
    functionName: 'decimals',
    query: { enabled },
  })

  const { data: symbolData, isError: symbolUnavailable } = useReadContract({
    address,
    abi: erc20Abi,
    chainId,
    functionName: 'symbol',
    query: { enabled },
  })

  // Only LSP7s reach this second read — symbol() reverting is exactly what identifies them
  const { data: lsp4SymbolBytes } = useReadContract({
    address,
    abi: erc725yAbi,
    chainId,
    functionName: 'getData',
    args: [LSP4_TOKEN_SYMBOL_KEY],
    query: { enabled: enabled && symbolUnavailable },
  })

  const decimals = isNative ? native.decimals : decimalsData === undefined ? undefined : Number(decimalsData)

  useEffect(() => {
    if (!isNative && enabled && decimals !== undefined) decimalsCache.set(decimalsKey(chainId, address), decimals)
  }, [isNative, enabled, address, chainId, decimals])

  let lsp4Symbol = null
  if (lsp4SymbolBytes && lsp4SymbolBytes !== '0x') {
    try {
      lsp4Symbol = hexToString(lsp4SymbolBytes).trim() || null
    } catch {
      lsp4Symbol = null
    }
  }

  return {
    decimals,
    symbol: isNative ? native.symbol : symbolData || lsp4Symbol || '',
    isNative,
  }
}

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
// Sub-1 amounts keep their significant digits — fraction-digit rounding would collapse a
// 0.0001 minimum to '0'
const smallAmountFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })

/**
 * Raw smallest-unit amount → localized display string, e.g. ('1000000', 6) → '1'. Returns null
 * while the decimals are still unknown so callers render a placeholder rather than a number
 * that's wrong by a factor of a million.
 */
export function formatTokenDisplay(amount, decimals) {
  if (amount === undefined || amount === null || decimals === undefined) return null
  try {
    const value = Number(formatUnits(BigInt(amount), Number(decimals)))
    return value > 0 && value < 1 ? smallAmountFormatter.format(value) : amountFormatter.format(value)
  } catch {
    return null
  }
}

/**
 * Raw smallest-unit amount → the exact whole-unit string a form field is seeded with. Unlike
 * formatTokenDisplay this never rounds or localizes: the value goes straight back onchain.
 */
export function toAmountInput(amount, decimals) {
  try {
    return formatUnits(BigInt(amount ?? 0), Number(decimals))
  } catch {
    return '0'
  }
}
