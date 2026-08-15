'use client'

import { useReadContract } from 'wagmi'
import { erc20Abi, hexToString } from 'viem'

// LSP7 has no symbol() — LSP4 metadata lives in ERC725Y storage, read via getData with the
// keccak256('LSP4TokenSymbol') data key. Same key TipModal and OfferModal use.
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
 * Symbol and decimals for one fungible asset, whichever standard it speaks.
 *
 * An OTC deal names its asset by address alone, so every row on this page has to resolve its
 * own ticker — the indexer caches payment tokens in store_tokens, but the asset side is a
 * token nobody has necessarily traded before. decimals() shares a selector across ERC20 and
 * LSP7, so one read covers both; only the symbol needs the fork.
 *
 * @param {Object} params
 * @param {number} params.chainId Chain the token lives on.
 * @param {string|null} params.token Token address, or null/undefined for the native coin.
 * @param {boolean} [params.isLsp7] Read the symbol from LSP4 metadata instead of symbol().
 * @param {Object} [params.nativeCurrency] Chain config entry, used when token is null.
 * `isError` is reported separately from `isResolved` on purpose: a token whose decimals() call
 * reverts — an NFT contract, a non-token address, a token that lives on another chain — never
 * resolves, and callers that only watch `isResolved` would show "loading" forever instead of
 * saying the address is wrong.
 *
 * @returns {{symbol: string, decimals: number|undefined, isResolved: boolean, isLoading: boolean, isError: boolean}}
 */
export default function useTokenMeta({ chainId, token, isLsp7 = false, nativeCurrency }) {
  const isNative = !token

  const {
    data: decimals,
    isLoading: isDecimalsLoading,
    isError: isDecimalsError,
  } = useReadContract({
    abi: erc20Abi,
    address: isNative ? null : token,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(!isNative && token) },
  })

  const { data: erc20Symbol, isError: isErc20SymbolError } = useReadContract({
    abi: erc20Abi,
    address: isNative ? null : token,
    functionName: 'symbol',
    chainId,
    query: { enabled: Boolean(!isNative && token && !isLsp7) },
  })

  // Falls back to LSP4 whenever symbol() is absent, not only when the caller already knew the
  // standard: an OTC deal names its asset by address alone, so the card resolving it has no
  // idea whether it's an ERC20 or an LSP7 until one of the two reads answers.
  const { data: lsp4SymbolBytes } = useReadContract({
    abi: erc725yAbi,
    address: isNative ? null : token,
    functionName: 'getData',
    args: [LSP4_TOKEN_SYMBOL_KEY],
    chainId,
    query: { enabled: Boolean(!isNative && token && (isLsp7 || isErc20SymbolError)) },
  })

  let lsp4Symbol = null
  if (lsp4SymbolBytes && lsp4SymbolBytes !== '0x') {
    try {
      lsp4Symbol = hexToString(lsp4SymbolBytes).trim() || null
    } catch {
      lsp4Symbol = null
    }
  }

  if (isNative) {
    return {
      symbol: nativeCurrency?.symbol ?? '',
      decimals: nativeCurrency?.decimals ?? 18,
      isResolved: true,
      isLoading: false,
      isError: false,
    }
  }

  // Null rather than a "tokens" placeholder: a caller showing an amount needs to fall back to
  // the address, because "10 tokens" identifies nothing a user could verify
  const symbol = (isLsp7 ? lsp4Symbol : erc20Symbol) || lsp4Symbol || null
  return {
    symbol,
    decimals,
    isResolved: decimals !== undefined,
    isLoading: isDecimalsLoading,
    isError: isDecimalsError,
  }
}
