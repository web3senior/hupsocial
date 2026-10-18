'use client'

import { useState } from 'react'
import { useConnection, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { governanceAddressFor } from '@/lib/communityGovernance'
import { shortTxError } from '@/lib/utils'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import { toast } from '@/components/NextToast'

export default function useCommunityGovernance(chainId) {
  const { address: account, chain } = useConnection()
  const client = usePublicClient({ chainId })
  const switchChain = useSwitchChain()
  const { mutateAsync: write } = useWriteContract()
  const [busy, setBusy] = useState(null)
  const address = governanceAddressFor(chainId)

  const send = async (action, call, success) => {
    if (!account || !address) {
      toast(!account ? 'Connect your wallet first' : 'Community voting is not deployed on this network yet', 'error')
      return null
    }
    setBusy(action)
    try {
      if (chain?.id !== chainId) await switchChain.mutateAsync({ chainId })
      const hash = await write({ address, abi: governanceAbi, ...call, chainId })
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Transaction failed')
      toast(success, 'success')
      return receipt
    } catch (error) {
      toast(shortTxError(error, 'Transaction failed'), 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  return { address, account, busy, send }
}
