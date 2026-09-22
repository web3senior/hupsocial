'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { usePremium } from '@/hooks/usePremium'
import blueCheckMark from '@/../public/icons/blue-checkmark.svg'
import styles from './HomeRail.module.scss'

const UPSELL_DISMISSED_KEY = 'hup:home-premium-upsell'
// A closed card is "not now", so it comes back after two weeks — the same rhythm as PremiumNudge.
const UPSELL_DISMISSED_FOR_MS = 14 * 24 * 60 * 60 * 1000

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
 * The column beside the home feed on wide screens: an upgrade card for viewers without Premium.
 * "Who to follow" lives in the feed itself (WhoToFollow), between posts.
 */
export default function HomeRail() {
  return (
    <div className={styles.rail}>
      <PremiumUpsell />
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
