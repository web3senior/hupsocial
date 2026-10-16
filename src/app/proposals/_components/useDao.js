'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { config } from '@/config/wagmi'
import { getIPFS } from '@/lib/ipfs'
import { daoAddressFor } from '@/lib/dao'
import { shortTxError } from '@/lib/utils'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import daoAbi from '@/abis/HupDao.json'
import { toast } from '@/components/NextToast'

/**
 * Sends a transaction from the connected wallet and waits for it, so every DAO write shares one
 * wrong-chain switch, one error copy and one receipt check. `busy` names the action in flight,
 * so each button can show its own pending state.
 * @param {number} chainId The chain the DAO lives on.
 */
export function useDaoWrite(chainId) {
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const publicClient = usePublicClient({ chainId })
  const { mutateAsync: writeContractAsync } = useWriteContract()
  const [busy, setBusy] = useState(null)

  /**
   * @param {string} action Key for `busy`.
   * @param {{address?: string, abi?: Array, functionName: string, args: Array}} call Defaults to HupDao.
   * @param {{success: string, failure: string}} copy Toast text.
   * @returns {Promise<Object|null>} The receipt, or null when the write did not land.
   */
  const send = async (action, call, copy) => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return null
    }
    const target = call.address ?? daoAddressFor(chainId)
    if (!target) {
      toast("DAOs aren't available on this network yet", 'error')
      return null
    }

    setBusy(action)
    try {
      if (walletChain?.id !== chainId) await switchChain.mutateAsync({ chainId })
      const hash = await writeContractAsync({
        abi: call.abi ?? daoAbi,
        address: target,
        functionName: call.functionName,
        args: call.args,
        chainId,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error(copy.failure)
      toast(copy.success, 'success')
      return receipt
    } catch (err) {
      toast(shortTxError(err, copy.failure), 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  return { send, busy, account: address }
}

/**
 * Parsed JSON behind an IPFS CID, cached per CID. Content-addressed, so it never revalidates.
 * @param {string} cid Bare CID, as stored onchain.
 */
export function useIpfsJson(cid) {
  const { data, isLoading } = useSWR(cid ? ['ipfs-json', cid] : null, async () => {
    const json = await getIPFS(cid)
    return json?.result === false ? null : json
  }, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })

  return { data: data ?? null, isLoading }
}

/**
 * One DAO's onchain record, its IPFS metadata and the token behind its votes.
 * @param {number} chainId
 * @param {string|number} daoId
 */
export function useDao(chainId, daoId) {
  const daoAddress = daoAddressFor(chainId)
  const { data: dao, isLoading, refetch } = useReadContract({
    abi: daoAbi,
    address: daoAddress,
    functionName: 'getDao',
    args: [BigInt(daoId || 0)],
    chainId,
    query: { enabled: Boolean(daoAddress && daoId) },
  })

  const exists = Boolean(dao && Number(dao.createdAt) > 0)
  const { data: metadata } = useIpfsJson(exists ? dao.metadata : null)
  const tokenInfo = usePaymentToken(chainId, exists && Number(dao.mode) !== 2 ? dao.token : undefined)

  return {
    dao: exists ? dao : null,
    metadata,
    token: tokenInfo,
    // Members mode counts whole votes; the token modes count in base units
    decimals: exists && Number(dao.mode) === 2 ? 0 : tokenInfo.decimals ?? 18,
    isLoading: Boolean(daoAddress) && isLoading,
    notFound: Boolean(daoAddress) && !isLoading && !exists,
    refetch,
  }
}
