'use client'

import { useEffect } from 'react'
import { useConnection, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import { openConnect } from '@/lib/connectDialog'
import { sameAddress } from '@/lib/address'
import { toast } from '@/components/NextToast'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'

/**
 * Whether the viewer follows `target` on LSP26, and the toggle that flips it. Read on the given
 * network rather than whichever chain the wallet is on, so a post's byline asks the post's chain.
 * Shared by the profile hover card and the post activity list.
 * @param {string} target Wallet to follow.
 * @param {string|number} [networkId] Chain whose follower system to use.
 * @param {{ onConfirmed?: Function }} [options] Runs after a follow/unfollow lands onchain.
 */
export function useFollowState(target, networkId, { onConfirmed } = {}) {
  const { address, isConnected } = useConnection()
  const [fallbackChain] = getActiveChain()
  const followerSystemAddress = CONTRACTS[`chain${networkId || fallbackChain?.id}`]?.followerSystem
  const isSelf = sameAddress(address, target)

  const { data, isLoading, refetch } = useReadContract({
    address: followerSystemAddress,
    abi: followerSystemAbi,
    functionName: 'isFollowing',
    args: [address, target],
    query: { enabled: !!followerSystemAddress && !!address && !!target && !isSelf },
  })
  const isFollowing = Boolean(data)

  const { data: hash, isPending: isSigning, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isConfirmed) return
    refetch()
    onConfirmed?.()
  }, [isConfirmed, refetch]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (!isConnected) {
      if (!openConnect()) toast(`Please connect wallet`, `error`)
      return
    }
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: isFollowing ? 'unfollow' : 'follow',
      args: [target],
    })
  }

  return {
    followerSystemAddress,
    isSelf,
    isFollowing,
    // Only meaningful with a wallet: signed out there is nothing to read, and the button says Follow
    isLoading: isConnected && !isSelf && isLoading,
    isBusy: isSigning || isConfirming,
    isSigning,
    toggle,
  }
}
