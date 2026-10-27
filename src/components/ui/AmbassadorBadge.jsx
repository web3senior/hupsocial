'use client'

import Link from 'next/link'
import clsx from 'clsx'
import ambassadorMark from '@/../public/ambassadors.webp'
import { ROLES } from '@/lib/roles'
import styles from './AmbassadorBadge.module.scss'

const ICON_SIZE = { sm: 14, lg: 18 }

/**
 * Ambassador Badge
 * The mark an admin gives a Hupster — someone spreading the word about Hup. A bare glyph at the
 * size of the chain and Universal Profile marks it sits in a row with, rendered from the app's own
 * ambassadors.webp the same way the premium mark renders its checkmark.
 *
 * Renders straight from profile.roles, which the profile route resolves on every read: a revoked
 * role drops the mark on the next load. Label and wording come from lib/roles.js.
 *
 * Linked, the mark opens /hupsters — anyone curious about it lands on the page explaining it and
 * how to join. Callers already inside a link (a byline that is one big link) pass `linked={false}`,
 * since an anchor cannot hold another.
 *
 * @param {string[]|null} props.roles From profile.roles.
 * @param {'sm'|'lg'} [props.size='sm']
 * @param {boolean} [props.linked=true]
 * @param {string} [props.className]
 */
export default function AmbassadorBadge({ roles, size = 'sm', linked = true, className }) {
  if (!roles?.includes('ambassador')) return null

  const { label, description } = ROLES.ambassador
  const pixels = ICON_SIZE[size] ?? ICON_SIZE.sm

  const mark = (
    <img
      className={clsx(styles.ambassadorBadge, !linked && className)}
      src={ambassadorMark.src || ambassadorMark}
      alt={linked ? '' : label}
      width={pixels}
      height={pixels}
      title={`${label} — ${description}`}
    />
  )

  if (!linked) return mark

  return (
    <Link
      href="/hupsters"
      prefetch={false}
      className={clsx(styles['ambassadorBadge--link'], className)}
      aria-label={`${label} — learn about ${label}s`}
      // A post card opens the post on click; the mark is its own destination
      onClick={(event) => event.stopPropagation()}
    >
      {mark}
    </Link>
  )
}
