'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useConnection, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import { toast } from '@/components/NextToast'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { CONTRACTS } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import { openConnect } from '@/lib/connectDialog'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import styles from './WhoToFollow.module.scss'

const SUGGESTIONS_ENDPOINT = '/api/v1/users/suggested'
const SUGGESTION_COUNT = 3

const fetchSuggestions = async (viewer) => {
  const params = new URLSearchParams({ limit: String(SUGGESTION_COUNT) })
  if (viewer) params.set('viewer', viewer)
  const response = await fetch(`${SUGGESTIONS_ENDPOINT}?${params}`)
  if (!response.ok) throw new Error(`Suggestions request failed (${response.status})`)
  const body = await response.json()
  return body?.data ?? { users: [] }
}

/**
 * Who To Follow
 * A random handful of the leaderboard's top 20, drawn in the home feed between posts. Renders its own trailing
 * divider so the feed's rhythm holds, and nothing at all when there is no one to suggest.
 */
export default function WhoToFollow() {
  const { address: viewer } = useActiveWallet()
  const { data, isLoading, mutate } = useSWR(['suggested-users', viewer ?? 'anon'], () => fetchSuggestions(viewer), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const users = data?.users ?? []
  if (!isLoading && users.length === 0) return null

  return (
    <>
      <section className={styles.follow} aria-label="Who to follow">
        <h2 className={styles.follow__title}>Who to follow</h2>

        {isLoading && !data && (
          <ul className={styles.follow__list} aria-hidden="true">
            {Array.from({ length: SUGGESTION_COUNT }, (_, index) => (
              <li key={index} className={clsx(styles.follow__row, styles['follow__row--skeleton'])}>
                <span className={styles.follow__skeletonAvatar} />
                <span className={styles.follow__skeletonLines}>
                  <span className={styles.follow__skeletonLine} />
                  <span className={clsx(styles.follow__skeletonLine, styles['follow__skeletonLine--short'])} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {users.length > 0 && (
          <ul className={styles.follow__list}>
            {users.map((user) => (
              <li key={user.address} className={styles.follow__row}>
                <Profile
                  creator={user.address}
                  variant="compact"
                  size={40}
                  hoverCard={false}
                  className={styles.follow__profile}
                  fallback={profileFallbackFromRow({
                    wallet_address: user.address,
                    display_name: user.name,
                    username: user.username,
                    profile_image: user.profileImage,
                  })}
                />
                <FollowButton target={user.address} />
              </li>
            ))}
          </ul>
        )}

        {users.length > 0 && (
          <button type="button" className={styles.follow__more} onClick={() => mutate()}>
            Show more
          </button>
        )}
      </section>
      <hr />
    </>
  )
}

/**
 * One LSP26 `follow` on the connected chain. The list already leaves out anyone the viewer
 * follows, so the button starts at "Follow" and flips on the transaction hash — the receipt only
 * has to confirm it, or roll it back with a word.
 */
const FollowButton = ({ target }) => {
  const { isConnected } = useConnection()
  const [activeChain] = getActiveChain()
  const followerSystemAddress = CONTRACTS[`chain${activeChain?.id}`]?.followerSystem
  const [following, setFollowing] = useState(false)

  const { data: hash, isPending: isSigning, mutate: writeContract } = useWriteContract()
  const { isSuccess: isConfirmed, isError: isFailed } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isConfirmed) toast(`You're now following`, `success`)
  }, [isConfirmed])

  useEffect(() => {
    if (isFailed) {
      setFollowing(false)
      toast(`Follow didn't go through`, `error`)
    }
  }, [isFailed])

  const handleFollow = () => {
    if (!isConnected) {
      if (!openConnect()) toast(`Please connect wallet`, `error`)
      return
    }
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    writeContract(
      { address: followerSystemAddress, abi: followerSystemAbi, functionName: 'follow', args: [target] },
      { onSuccess: () => setFollowing(true) },
    )
  }

  return (
    <button
      type="button"
      className={clsx(styles.follow__button, following && styles['follow__button--following'])}
      onClick={handleFollow}
      disabled={isSigning || following}
    >
      {isSigning ? 'Confirm…' : following ? 'Following' : 'Follow'}
    </button>
  )
}
