'use client'

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
 * @param {string[]|null} props.roles From profile.roles.
 * @param {'sm'|'lg'} [props.size='sm']
 * @param {string} [props.className]
 */
export default function AmbassadorBadge({ roles, size = 'sm', className }) {
  if (!roles?.includes('ambassador')) return null

  const { label, description } = ROLES.ambassador
  const pixels = ICON_SIZE[size] ?? ICON_SIZE.sm

  return (
    <img
      className={clsx(styles.ambassadorBadge, className)}
      src={ambassadorMark.src || ambassadorMark}
      alt=""
      width={pixels}
      height={pixels}
      title={`${label} — ${description}`}
      aria-label={label}
      role="img"
    />
  )
}
