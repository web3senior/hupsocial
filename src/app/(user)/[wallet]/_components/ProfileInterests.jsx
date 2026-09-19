'use client'

/**
 * What a profile is into, as a row of cards under the bio.
 *
 * The free-form `tags` beside it stay what they are — a hashtag line anyone can write anything
 * into. These are picked from config/interestOptions.js instead, because a card is drawn from an
 * icon and a pair of colours and neither can be invented from an arbitrary string.
 *
 * One row, never two: the profile column is narrow enough that six cards do not fit it, so the
 * overflow rides the same useStripScroll rail as the cashtag strip and the drops row — native
 * scrolling for touch and trackpads, arrows for the pointers that have no way into one.
 *
 * Each card is a search: an interest nobody can act on is decoration, and the one thing a visitor
 * wants after reading "Photography" on a profile is more of it.
 */

import Link from 'next/link'
import { useMemo } from 'react'
import clsx from 'clsx'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { resolveInterests } from '@/config/interestOptions'
import { useStripScroll } from '@/hooks/useStripScroll'
import InterestIcon from '@/components/ui/InterestIcon'
import styles from './ProfileInterests.module.scss'

export default function ProfileInterests({ interests: raw, className }) {
  // Serves slugs, not resolved entries, so the list has to be turned back into cards here — and
  // an unknown slug is dropped by the resolver rather than rendered as a blank tile.
  const interests = useMemo(() => resolveInterests(raw), [raw])
  const { trackRef, edges, nudge } = useStripScroll(interests.length)

  if (interests.length === 0) return null

  return (
    <section className={clsx(styles.interests, className)} aria-label="Interests">
      <h3 className={styles.interests__title}>Interests</h3>

      <div className={styles.interests__rail}>
        <ul ref={trackRef} className={styles.interests__list}>
          {interests.map((interest) => (
            <li key={interest.slug}>
              {/* The gradient rides on custom properties rather than a class per interest —
                  thirty catalogue entries would otherwise be thirty near-identical rules. */}
              <Link
                className={styles.interests__card}
                href={`/search?q=${encodeURIComponent(interest.label)}`}
                style={{ '--interest-from': interest.gradient[0], '--interest-to': interest.gradient[1] }}
                title={`Search ${interest.label}`}
              >
                <InterestIcon slug={interest.slug} size={26} className={styles.interests__icon} />
                <span className={styles.interests__label}>{interest.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Hidden from assistive tech: the track is already a keyboard-scrollable region, and
            every card in it is a link, so these would only add duplicate stops */}
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className={clsx(styles.interests__arrow, styles['interests__arrow--start'], edges.start && styles['interests__arrow--hidden'])}
          onClick={() => nudge(-1)}
        >
          <CaretLeftIcon size={14} weight="bold" />
        </button>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className={clsx(styles.interests__arrow, styles['interests__arrow--end'], edges.end && styles['interests__arrow--hidden'])}
          onClick={() => nudge(1)}
        >
          <CaretRightIcon size={14} weight="bold" />
        </button>
      </div>
    </section>
  )
}
