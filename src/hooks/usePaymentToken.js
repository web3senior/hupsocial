'use client'

import { hexToString, isAddress } from 'viem'
import { useReadContracts } from 'wagmi'
import { LSP4_DATA_KEYS } from '@/lib/drops'

const erc20Abi = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
]

const erc725yAbi = [
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
]

/** Decodes an ERC725Y string value, tolerating the bare `0x` an unset key answers with. */
const decodeString = (value) => {
  if (!value || value === '0x') return ''
  try {
    return hexToString(value).replace(/ /g, '').trim()
  } catch {
    return ''
  }
}

/**
 * What is deployed at a payment-token address, read from the chain the drop will live on.
 *
 * A hook rather than a component's private read because two places need the same answer — the
 * field that confirms what was pasted, and the preview card that has to price in the right ticker.
 * wagmi keys the query by address and chain, so both callers share one request.
 *
 * Which call answers also names the standard: ERC20 exposes `symbol()`, LSP7 keeps it in ERC725Y.
 *
 * @param {number} chainId The chain to read on.
 * @param {string} token The address as typed; anything but a valid address disables the read.
 * @returns {{symbol: string, decimals: number|null, exists: boolean, looksLsp7: boolean, isLoading: boolean}}
 */
export function usePaymentToken(chainId, token) {
  const enabled = isAddress(token ?? '')

  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token, abi: erc20Abi, functionName: 'symbol', chainId },
      { address: token, abi: erc20Abi, functionName: 'decimals', chainId },
      { address: token, abi: erc725yAbi, functionName: 'getData', args: [LSP4_DATA_KEYS.symbol], chainId },
    ],
    query: { enabled },
  })

  if (!enabled || !data) {
    return { symbol: '', decimals: null, exists: false, looksLsp7: false, isLoading: enabled && isLoading }
  }

  const erc20Symbol = data[0]?.status === 'success' ? data[0].result : ''
  const decimals = data[1]?.status === 'success' ? Number(data[1].result) : null
  const lspSymbol = data[2]?.status === 'success' ? decodeString(data[2].result) : ''

  return {
    symbol: erc20Symbol || lspSymbol || '',
    decimals,
    // decimals() is the one call both standards answer — without it there is no token here
    exists: decimals !== null,
    looksLsp7: !erc20Symbol && Boolean(lspSymbol),
    isLoading,
  }
}
