'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import { fetchFollowRelations, setFollowing } from '@/lib/follow'
import { openConnect } from '@/lib/connectDialog'
import { isEvmAddress, sameAddress } from '@/lib/address'
import { toast } from '@/components/NextToast'

/**
 * Whether the viewer follows `target`, and the toggle that flips it. Following is offchain and the
 * same on every chain (lib/follow.js); an unfollow also clears a LUKSO LSP26 follow when there is
 * one. Shared by the profile page, the profile hover card and the post activity list.
 * @param {string} target Wallet to follow.
 * @param {{ onConfirmed?: (following: boolean) => void }} [options] Runs after a follow/unfollow is saved.
 */
export function useFollowState(target, { onConfirmed } = {}) {
  const { address, isConnected } = useConnection()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const isSelf = sameAddress(address, target)
  const canRead = isEvmAddress(address) && isEvmAddress(target) && !isSelf

  const { data, isLoading, mutate } = useSWR(canRead ? ['follow-relation', address.toLowerCase(), target.toLowerCase()] : null, async () => {
    const key = target.toLowerCase()
    const { following, onchain } = await fetchFollowRelations(address, [target])
    return { following: following.has(key), onchain: onchain.has(key) }
  })
  const relation = data ?? { following: false, onchain: false }
  const [isBusy, setIsBusy] = useState(false)

  const toggle = async () => {
    if (!isConnected) {
      if (!openConnect()) toast(`Please connect wallet`, `error`)
      return
    }
    if (!canRead || isBusy) return

    const wasFollowing = relation.following
    setIsBusy(true)
    mutate({ ...relation, following: !wasFollowing }, { revalidate: false })
    try {
      await setFollowing({
        address,
        targets: [target],
        following: !wasFollowing,
        signMessageAsync,
        chainId,
        onchain: relation.onchain ? [target] : [],
      })
      // Trusted rather than re-read: an onchain unfollow reaches the table only once cidex indexes it
      mutate({ following: !wasFollowing, onchain: wasFollowing ? false : relation.onchain }, { revalidate: false })
      onConfirmed?.(!wasFollowing)
    } catch (error) {
      toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
      mutate()
    } finally {
      setIsBusy(false)
    }
  }

  return {
    isSelf,
    isFollowing: relation.following,
    // Only meaningful with a wallet: signed out there is nothing to read, and the button says Follow
    isLoading: isConnected && canRead && isLoading,
    isBusy,
    toggle,
  }
}
