'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useConnection, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import { toast } from '@/components/NextToast'
import { usePremium } from '@/hooks/usePremium'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { profileFallbackFromRow } from '@/hooks/useProfile'
import { CONTRACTS } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import { openConnect } from '@/lib/connectDialog'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import blueCheckMark from '@/../public/icons/blue-checkmark.svg'
import styles from './HomeRail.module.scss'

const SUGGESTIONS_ENDPOINT = '/api/v1/users/suggested'
const SUGGESTION_COUNT = 3

const UPSELL_DISMISSED_KEY = 'hup:home-premium-upsell'
// A closed card is "not now", so it comes back after two weeks — the same rhythm as PremiumNudge.
const UPSELL_DISMISSED_FOR_MS = 14 * 24 * 60 * 60 * 1000

const fetchSuggestions = async (viewer) => {
  const params = new URLSearchParams({ limit: String(SUGGESTION_COUNT) })
  if (viewer) params.set('viewer', viewer)
  const response = await fetch(`${SUGGESTIONS_ENDPOINT}?${params}`)
  if (!response.ok) throw new Error(`Suggestions request failed (${response.status})`)
  const body = await response.json()
  return body?.data ?? { users: [] }
}

const readUpsellDismissed = () => {
  try {
    const raw = window.localStorage.getItem(UPSELL_DISMISSED_KEY)
    return raw ? Date.now() - Number(raw) < UPSELL_DISMISSED_FOR_MS : false
  } catch {
    return false
  }
}

/**
 * Home Rail
 * The column beside the home feed on wide screens: an upgrade card for viewers without Premium
 * and a "Who to follow" card that suggests a random handful of accounts.
 */
export default function HomeRail() {
  return (
    <div className={styles.rail}>
      <PremiumUpsell />
      <WhoToFollow />
    </div>
  )
}

const PremiumUpsell = () => {
  const { isPremium, isLoading, live } = usePremium()
  // localStorage is read after mount so the server and first client render agree.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(readUpsellDismissed())
  }, [])

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(UPSELL_DISMISSED_KEY, String(Date.now()))
    } catch {
      /* Private mode: the card closes for this page view and that is enough. */
    }
    setDismissed(true)
  }, [])

  if (!live || isLoading || isPremium || dismissed) return null

  return (
    <section className={clsx(styles.card, styles.upsell)} aria-label="Upgrade to Premium">
      <button type="button" className={styles.upsell__close} onClick={dismiss} aria-label="Dismiss">
        <XIcon size={18} />
      </button>
      <h2 className={styles.card__title}>
        Upgrade to Premium
        <img className={styles.upsell__mark} src={blueCheckMark.src || blueCheckMark} alt="" width={16} height={16} aria-hidden="true" />
      </h2>
      <p className={styles.upsell__body}>Stand out with the mark beside your name and your own profile colour.</p>
      <Link href="/premium" className={styles.upsell__cta}>
        Upgrade to Premium
      </Link>
    </section>
  )
}

const WhoToFollow = () => {
  const { address: viewer } = useActiveWallet()
  const { data, isLoading, mutate } = useSWR(['suggested-users', viewer ?? 'anon'], () => fetchSuggestions(viewer), {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const users = data?.users ?? []
  // No one left to suggest (or the read failed): no card at all.
  if (!isLoading && users.length === 0) return null

  return (
    <section className={clsx(styles.card, styles.follow)} aria-label="Who to follow">
      <h2 className={styles.card__title}>Who to follow</h2>

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
