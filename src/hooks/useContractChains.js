'use client'

import useSWR from 'swr'
import { isAddress } from 'viem'
import { getPublicClient } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'

// null when the chain could not be asked — an unreachable RPC is not an empty address
const hasCodeOn = async (chainId, address) => {
  try {
    const client = getPublicClient(config, { chainId })
    if (!client) return null
    const code = await client.getBytecode({ address })
    return Boolean(code && code !== '0x')
  } catch {
    return null
  }
}

/**
 * Whether a contract exists at an address on the chosen chain — and, when it does not, on
 * which of the app's other chains it does. Behind almost every "nothing is deployed here" is a
 * right address on the wrong network, and the answer worth giving is the network.
 *
 * The sweep of the other chains only runs once the chosen one has said no: eight RPC reads
 * are not worth it for an address that was right all along.
 *
 * @param {Object} params
 * @param {string|null} params.address Contract address to look for.
 * @param {number} params.chainId The chain currently selected.
 * @param {boolean} [params.enabled=true]
 * @returns {{ hasCode: boolean|null, isChecking: boolean, elsewhere: number[], isSearching: boolean }}
 */
export default function useContractChains({ address, chainId, enabled = true }) {
  const ready = Boolean(enabled && address && isAddress(address))
  const lower = ready ? address.toLowerCase() : null

  const { data: here, isLoading: isChecking } = useSWR(ready ? ['contract-code', Number(chainId), lower] : null, () => hasCodeOn(Number(chainId), address), {
    revalidateOnFocus: false,
  })

  const { data: elsewhere, isLoading: isSearching } = useSWR(
    ready && here === false ? ['contract-code-elsewhere', Number(chainId), lower] : null,
    async () => {
      const others = appChains.filter((chain) => chain.id !== Number(chainId))
      const found = await Promise.all(others.map(async (chain) => [chain.id, await hasCodeOn(chain.id, address)]))
      return found.filter(([, present]) => present === true).map(([id]) => id)
    },
    { revalidateOnFocus: false },
  )

  return {
    hasCode: here ?? null,
    isChecking: ready && isChecking,
    elsewhere: elsewhere ?? [],
    isSearching: here === false && isSearching,
  }
}
