'use client'

import { useState } from 'react'
import { isAddress } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { CONTRACTS } from '@/config/contracts'
import { toast } from '@/components/NextToast'
import splitsAbi from '@/abis/HupSplits.json'

/**
 * Use Split Deployer
 * Puts a HupSplits split onchain so something else can name it as a recipient.
 *
 * A split's address is decided by its table, so a caller can name one before it exists — but a
 * payee cannot verify shares that have no code behind them, and only a deployed split can divide
 * what it is sent. This deploys when there is nothing there and says so, and costs no signature
 * at all when the same table is already onchain.
 *
 * @param {number} chainId
 * @returns {{ factory: string, isAvailable: boolean, isDeploying: boolean, ensureSplit: Function }}
 *          `ensureSplit(split, payees)` resolves true once the split exists, false if it did not.
 */
export function useSplitDeployer(chainId) {
  const publicClient = usePublicClient({ chainId })
  const { writeContractAsync } = useWriteContract()
  const [isDeploying, setIsDeploying] = useState(false)

  const factory = CONTRACTS[`chain${chainId}`]?.splits || ''

  const ensureSplit = async (split, payees) => {
    if (!isAddress(split) || !isAddress(factory) || !publicClient) {
      toast('Give every payee a wallet and shares totalling 100%', 'error')
      return false
    }

    setIsDeploying(true)
    let handle = null

    try {
      const existing = await publicClient.getCode({ address: split })
      if (existing && existing !== '0x') return true

      const hash = await writeContractAsync({ abi: splitsAbi, address: factory, functionName: 'create', args: [payees], chainId })

      handle = toast('Deploying the split…', 'loading')
      const receipt = await waitForTransactionReceipt(config, { chainId, hash })
      if (receipt.status !== 'success') throw new Error('The split was rejected onchain')

      handle.update('Split deployed', 'success')
      return true
    } catch (err) {
      const message = err.shortMessage || err.message || 'Could not deploy the split'
      if (!handle?.update(message, 'error')) toast(message, 'error')
      return false
    } finally {
      setIsDeploying(false)
    }
  }

  return { factory, isAvailable: isAddress(factory), isDeploying, ensureSplit }
}
