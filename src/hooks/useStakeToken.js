'use client'

import { useReadContract } from 'wagmi'
import { erc20Abi, formatUnits, hexToString, zeroAddress } from 'viem'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'

// LSP7 has no symbol() — LSP4 metadata lives in ERC725Y storage, read via getData
// with the keccak256('LSP4TokenSymbol') data key
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

/**
 * Resolves the display symbol and decimals of a Hup Predict stake token: the chain's native
 * currency for address(0), a curated TIP_TOKENS entry by name, or onchain reads for anything
 * else. Decimals are always read onchain for token stakes (never trusted from config), so
 * amounts format correctly for 6-decimal stables and 18-decimal tokens alike.
 * @param {number|string} chainId The market's network id.
 * @param {string|null} token The stake token address (zero/empty = native).
 * @param {boolean} isLsp7 True when the token is an LSP7 Digital Asset (LUKSO).
 */
export default function useStakeToken(chainId, token, isLsp7) {
  const numericChainId = Number(chainId)
  const chainInfo = appChains.find((chain) => chain.id === numericChainId)
  const isNative = !token || token.toLowerCase() === zeroAddress
  const listedToken = isNative
    ? null
    : (TIP_TOKENS[numericChainId] ?? []).find((entry) => entry.address.toLowerCase() === token.toLowerCase())

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: isNative ? undefined : token,
    functionName: 'decimals',
    chainId: numericChainId,
    query: { enabled: !isNative },
  })

  const { data: erc20Symbol } = useReadContract({
    abi: erc20Abi,
    address: isNative ? undefined : token,
    functionName: 'symbol',
    chainId: numericChainId,
    query: { enabled: Boolean(!isNative && !isLsp7 && !listedToken) },
  })

  const { data: lsp4SymbolBytes } = useReadContract({
    abi: erc725yAbi,
    address: isNative ? undefined : token,
    functionName: 'getData',
    args: [LSP4_TOKEN_SYMBOL_KEY],
    chainId: numericChainId,
    query: { enabled: Boolean(!isNative && isLsp7 && !listedToken) },
  })
  let lsp4Symbol = null
  if (lsp4SymbolBytes && lsp4SymbolBytes !== '0x') {
    try {
      lsp4Symbol = hexToString(lsp4SymbolBytes).trim() || null
    } catch {
      lsp4Symbol = null
    }
  }

  const symbol = isNative
    ? chainInfo?.nativeCurrency?.symbol || ''
    : listedToken
    ? listedToken.symbol
    : isLsp7
    ? lsp4Symbol || 'tokens'
    : erc20Symbol || 'tokens'
  const decimals = isNative ? chainInfo?.nativeCurrency?.decimals ?? 18 : tokenDecimals

  return { symbol, decimals, isNative, chainInfo }
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })
// Sub-1 stakes (0.0003 MON, ETH dust) keep their leading zeros instead of rounding to "0" —
// significant digits scale precision to however small the amount is
const smallNumber = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 })

/**
 * Formats a raw onchain amount string (decimal(65,0) from the API, or bigint) into a compact
 * localized ticker number — "1.25K" for large stakes, "0.0003" for small ones. Returns null
 * while decimals are still loading.
 */
export function formatStake(rawAmount, decimals) {
  if (rawAmount === null || rawAmount === undefined || decimals === undefined) return null
  try {
    const value = Number(formatUnits(BigInt(rawAmount), decimals))
    if (value === 0) return '0'
    return value < 1 ? smallNumber.format(value) : compactNumber.format(value)
  } catch {
    return null
  }
}
