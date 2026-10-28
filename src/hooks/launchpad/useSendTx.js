'use client'

import { useCallback, useState } from 'react'
import { useConfig } from 'wagmi'
import { estimateFeesPerGas, getConnection, sendCalls, switchChain, waitForCallsStatus, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { toast } from '@/components/NextToast'
import { journal, updateJournal } from '@/lib/launchpad/txJournal'

const isRejection = (error) => /reject|denied|cancel/i.test(`${error?.shortMessage || ''} ${error?.message || ''}`) || error?.code === 4001

/**
 * The fee ceiling, read from our own RPC rather than left to the wallet. Wallets on a custom
 * Arbitrum Sepolia RPC sent exactly the 0.02 gwei floor and were refused once the base fee sat a
 * hair above it. Twice the estimate is only a cap: the chain charges the base fee plus the tip.
 * Null when the estimate fails, so the wallet fills the fees as before.
 */
async function feeCeiling(config, chainId) {
  try {
    const { maxFeePerGas, maxPriorityFeePerGas } = await estimateFeesPerGas(config, { chainId })
    if (!maxFeePerGas) return null
    return { maxFeePerGas: maxFeePerGas * 2n, maxPriorityFeePerGas }
  } catch {
    return null
  }
}

/**
 * Sends one contract write on one chain: switches the wallet there first, journals the intent,
 * waits for the receipt. Resolves to the receipt, or throws with a message fit for a toast.
 */
export function useSendTx() {
  const config = useConfig()
  const [pending, setPending] = useState(null)

  const send = useCallback(
    async ({ chainId, label, ...request }) => {
      setPending(label)
      let id = null
      try {
        if (getConnection(config).chainId !== chainId) await switchChain(config, { chainId })

        const fees = request.maxFeePerGas || request.gasPrice ? null : await feeCeiling(config, chainId)

        id = journal({ chainId, label, to: request.address, functionName: request.functionName })
        let hash
        try {
          hash = await writeContract(config, { ...fees, ...request, chainId })
        } catch (error) {
          updateJournal(id, { status: isRejection(error) ? 'rejected' : 'failed', error: error.shortMessage || error.message })
          throw error
        }
        updateJournal(id, { status: 'sent', hash })
        toast(`${label}: sent`, 'info')

        let receipt
        try {
          receipt = await waitForTransactionReceipt(config, { chainId, hash })
        } catch (error) {
          // Broadcast, but we lost sight of it: never resend on our own
          updateJournal(id, { status: 'unknown', error: error.shortMessage || error.message })
          throw new Error(`${label}: sent, but its confirmation could not be read. Check the explorer before trying again.`)
        }
        updateJournal(id, { status: receipt.status === 'success' ? 'confirmed' : 'reverted', block: receipt.blockNumber.toString() })
        if (receipt.status !== 'success') throw new Error(`${label}: the transaction reverted`)
        toast(`${label}: confirmed`, 'success')
        return receipt
      } catch (error) {
        const message = isRejection(error) ? 'You declined in the wallet' : error.shortMessage || error.message
        toast(message, 'error')
        throw error
      } finally {
        setPending(null)
      }
    },
    [config],
  )

  /**
   * Sends several calls as one atomic EIP-5792 batch: one wallet confirmation for, say, approve +
   * deposit. Only call it once getCapabilities reports atomic support on `chainId`. Resolves to
   * the last call's receipt with the logs of every call in the batch.
   */
  const sendBatch = useCallback(
    async ({ chainId, label, calls }) => {
      setPending(label)
      let id = null
      try {
        if (getConnection(config).chainId !== chainId) await switchChain(config, { chainId })

        id = journal({ chainId, label, to: calls.at(-1).to, functionName: 'batch' })
        let batch
        try {
          batch = await sendCalls(config, { chainId, calls, forceAtomic: true })
        } catch (error) {
          updateJournal(id, { status: isRejection(error) ? 'rejected' : 'failed', error: error.shortMessage || error.message })
          throw error
        }
        updateJournal(id, { status: 'sent', callsId: batch.id })
        toast(`${label}: sent`, 'info')

        let result
        try {
          result = await waitForCallsStatus(config, { id: batch.id, timeout: 300_000 })
        } catch (error) {
          updateJournal(id, { status: 'unknown', error: error.shortMessage || error.message })
          throw new Error(`${label}: sent, but its confirmation could not be read. Check your wallet activity before trying again.`)
        }
        const receipts = result.receipts || []
        const last = receipts.at(-1)
        updateJournal(id, { status: result.status === 'success' ? 'confirmed' : 'reverted', hash: last?.transactionHash, block: last?.blockNumber?.toString() })
        if (result.status !== 'success' || !last) throw new Error(`${label}: the batch reverted`)
        toast(`${label}: confirmed`, 'success')
        return { ...last, logs: receipts.flatMap((receipt) => receipt.logs || []) }
      } catch (error) {
        const message = isRejection(error) ? 'You declined in the wallet' : error.shortMessage || error.message
        toast(message, 'error')
        throw error
      } finally {
        setPending(null)
      }
    },
    [config],
  )

  return { send, sendBatch, pending }
}

export async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => null)
  if (!json?.success) throw new Error(json?.error || 'The server did not accept it')
  return json.data
}
