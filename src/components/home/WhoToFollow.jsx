'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useConnection, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import clsx from 'clsx'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import useRailScroll from '@/hooks/useRailScroll'
import Avatar from '@/components/ui/Avatar'
import PremiumBadge from '@/components/ui/PremiumBadge'
import Shimmer from '@/components/ui/Shimmer'
import { toast } from '@/components/NextToast'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { profileFallbackFromRow, useProfile } from '@/hooks/useProfile'
import { CONTRACTS } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import { openConnect } from '@/lib/connectDialog'
import { shortAddress } from '@/lib/address'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import styles from './WhoToFollow.module.scss'

const SUGGESTIONS_ENDPOINT = '/api/v1/users/suggested'
// A carousel wants more than a screen's worth; the route caps at 10
const SUGGESTION_COUNT = 10
const SKELETON_COUNT = 4
const AVATAR_SIZE = 80

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
 * "Suggested for you": a horizontally scrolling row of profile cards drawn from the leaderboard's
 * top 20, placed in the home feed between posts. Renders its own trailing divider, and nothing at
 * all when there is no one to suggest.
 */
export default function WhoToFollow() {
  const { address: viewer } = useActiveWallet()
  const { data, isLoading } = useSWR(['suggested-users', viewer ?? 'anon'], () => fetchSuggestions(viewer), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const users = data?.users ?? []
  const railRef = useRef(null)
  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(railRef, [users, isLoading])
  if (!isLoading && users.length === 0) return null

  return (
    <>
      <section className={styles.follow} aria-label="Suggested for you">
        <header className={styles.follow__header}>
          <h2 className={styles.follow__title}>Suggested for you</h2>

          {/* Same pair as the NFT market rail, and only once the row overflows: arrows on a row
              that fits would promise more people than there are */}
          {(canScrollLeft || canScrollRight) && (
            <div className={styles.follow__arrows}>
              <button
                type="button"
                className={styles.follow__arrow}
                aria-label="Scroll suggestions left"
                disabled={!canScrollLeft}
                onClick={() => scrollByPage(-1)}
              >
                <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.follow__arrow}
                aria-label="Scroll suggestions right"
                disabled={!canScrollRight}
                onClick={() => scrollByPage(1)}
              >
                <CaretRightIcon size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>
          )}
        </header>

        <ul ref={railRef} className={styles.follow__list}>
          {isLoading
            ? Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <li key={index} className={clsx(styles.follow__card, styles['follow__card--skeleton'])} aria-hidden="true">
                  <Shimmer className={styles.follow__skeletonAvatar} />
                  <Shimmer className={styles.follow__skeletonLine} />
                  <Shimmer className={clsx(styles.follow__skeletonLine, styles['follow__skeletonLine--short'])} />
                  <Shimmer className={styles.follow__skeletonButton} />
                </li>
              ))
            : users.map((user) => <SuggestionCard key={user.address} user={user} />)}
        </ul>
      </section>
      <hr />
    </>
  )
}

/**
 * One card: big picture with the premium mark on its corner, name, handle, and the follow
 * button. The suggestion row's own fields paint at once; the fetched profile refines them.
 */
const SuggestionCard = ({ user }) => {
  const { profile } = useProfile(
    user.address,
    profileFallbackFromRow({
      wallet_address: user.address,
      display_name: user.name,
      username: user.username,
      profile_image: user.profileImage,
    }),
  )

  const name = profile?.fullName || profile?.name || user.name
  const username = profile?.username || user.username
  const href = username ? `/@${username}` : `/${user.address}`

  return (
    <li className={styles.follow__card}>

      <Link href={href} prefetch={false} className={styles.follow__identity}>
        <span className={styles.follow__picture}>
          <Avatar className={styles.follow__avatar} src={profile?.profileImage ?? user.profileImage} alt={name} size={AVATAR_SIZE} />
          <PremiumBadge premium={profile?.premium} size="lg" className={styles.follow__badge} />
        </span>
        <span className={styles.follow__name}>{name}</span>
        <span className={styles.follow__handle}>{username || shortAddress(user.address)}</span>
      </Link>

      <FollowButton target={user.address} />
    </li>
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
  // Optimistic from the hash, rolled back by a failed receipt — derived, so no effect has to undo it
  const isFollowing = following && !isFailed

  useEffect(() => {
    if (isConfirmed) toast(`You're now following`, `success`)
  }, [isConfirmed])

  useEffect(() => {
    if (isFailed) toast(`Follow didn't go through`, `error`)
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
      className={clsx(styles.follow__button, isFollowing && styles['follow__button--following'])}
      onClick={handleFollow}
      disabled={isSigning || isFollowing}
    >
      {isSigning ? 'Confirm…' : isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}
