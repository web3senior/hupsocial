'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { XIcon } from '@phosphor-icons/react'
import { usePremium } from '@/hooks/usePremium'
import { profilePath } from '@/lib/username'
import { shortAddress } from '@/lib/address'
import blueCheckMark from '@/../public/icons/blue-checkmark.svg'
import styles from './PremiumNudge.module.scss'

const DISMISSED_KEY_PREFIX = 'hup:premium-nudge:'
// Dismissed cards come back after two weeks, not never — a closed nudge is "not now".
const DISMISSED_FOR_MS = 14 * 24 * 60 * 60 * 1000

const dismissedKey = (address) => `${DISMISSED_KEY_PREFIX}${String(address).toLowerCase()}`

const readDismissed = (address) => {
  try {
    const raw = window.localStorage.getItem(dismissedKey(address))
    return raw ? Date.now() - Number(raw) < DISMISSED_FOR_MS : false
  } catch {
    return false
  }
}

/**
 * Premium Nudge
 * The card a signed-in visitor sees on their own profile while they do not hold Premium:
 * "you aren't Premium yet — get it like @someone". Shown only on the self view, only once the
 * standing has loaded, and hidden for two weeks after it is closed. It never appears while a
 * subscriber is browsing, and never on someone else's profile.
 *
 * @param {string} props.address The viewer's wallet, which is also this profile's.
 * @param {object} props.profile This profile's payload, for the handle in the greeting.
 */
export default function PremiumNudge({ address, profile }) {
  const { isPremium, isLoading, live, spotlight } = usePremium()
  // Read once on mount: the parent only renders this after the wallet reconnects, which is
  // client-side, so localStorage is there — and it keys on the address, so a switch remounts.
  const [dismissed, setDismissed] = useState(() => (address ? readDismissed(address) : true))

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(dismissedKey(address), String(Date.now()))
    } catch {
      /* Private mode — the card closes for this page view and that is enough. */
    }
    setDismissed(true)
  }, [address])

  if (!address || !live || isLoading || isPremium || dismissed) return null

  const handle = profile?.username ? `@${profile.username}` : profile?.name || shortAddress(address)
  const spotlightHandle = spotlight?.username ? `@${spotlight.username}` : spotlight?.name || null

  return (
    <div className={styles.nudge} role="status">
      <button type="button" className={styles.nudge__close} onClick={dismiss} aria-label="Dismiss">
        <XIcon size={18} />
      </button>

      <strong className={styles.nudge__title}>
        {`${handle}, you aren’t Premium yet`}
        <img className={styles.nudge__mark} src={blueCheckMark.src || blueCheckMark} alt="" width={20} height={20} aria-hidden="true" />
      </strong>

      <p className={styles.nudge__body}>
        {'Get Premium '}
        {spotlightHandle && (
          <>
            {'like '}
            <Link href={profilePath(spotlight.address, spotlight.username)} className={styles.nudge__spotlight}>
              {spotlightHandle}
            </Link>
            {' '}
          </>
        )}
        to stand out with the mark and your own profile colour.
      </p>

      <Link href="/premium" className={styles.nudge__cta}>
        Get Premium
      </Link>
    </div>
  )
}
