'use client'

import { useCallback, useState } from 'react'
import { useConfig } from 'wagmi'
import { estimateFeesPerGas, getConnection, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { toast } from '@/components/NextToast'

export function useVaultTransaction() {
  const config = useConfig()
  const [pending, setPending] = useState(null)
  const send = useCallback(async ({ chainId, label, ...request }) => {
    setPending(label)
    try {
      if (getConnection(config).chainId !== chainId) await switchChain(config, { chainId })
      if (getConnection(config).address?.toLowerCase() !== request.account?.toLowerCase()) throw new Error('The connected signing wallet changed. Review the transaction again.')
      let fees
      try {
        const estimate = await estimateFeesPerGas(config, { chainId })
        if (estimate.maxFeePerGas) fees = { maxFeePerGas: estimate.maxFeePerGas * 2n, maxPriorityFeePerGas: estimate.maxPriorityFeePerGas }
      } catch { /* Let the wallet estimate fees when the RPC cannot provide them. */ }
      const hash = await writeContract(config, { ...fees, ...request, chainId })
      toast(`${label}: sent`, 'info')
      let receipt
      try { receipt = await waitForTransactionReceipt(config, { chainId, hash }) } catch {
        throw new Error(`${label}: sent (${hash}), but confirmation could not be read. Check the explorer before trying again.`)
      }
      if (receipt.status !== 'success') throw new Error(`${label}: the transaction reverted`)
      toast(`${label}: confirmed`, 'success')
      return receipt
    } catch (error) {
      toast(error.shortMessage || error.message, 'error')
      throw error
    } finally {
      setPending(null)
    }
  }, [config])
  return { send, pending }
}
