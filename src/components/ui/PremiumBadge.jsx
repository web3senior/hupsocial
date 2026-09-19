'use client'

import clsx from 'clsx'
import blueCheckMark from '@/../public/icons/blue-checkmark.svg'
import styles from './PremiumBadge.module.scss'

const ICON_SIZE = { sm: 14, lg: 18 }

/**
 * Premium Badge
 * The mark beside a name. It renders straight from the profile payload, which resolves the
 * subscription at read time against the deployments this build pins — so a lapsed term drops
 * the mark on the next load without anything being written.
 *
 * The app's own blue-checkmark.svg rather than a drawn glyph: the asset predates this feature
 * and its blue is what the product already meant by a mark beside a name. The colour is baked
 * into the file's fill, so nothing here tints it.
 *
 * Deliberately NOT a verification mark: it says this account pays for Hup, and nothing about
 * who they are. The Universal Profile glyph beside it is the identity claim.
 *
 * @param {{premium: boolean, expiresAt: number|null}|null} props.premium From profile.premium.
 * @param {'sm'|'lg'} [props.size='sm']
 * @param {string} [props.className]
 */
export default function PremiumBadge({ premium, size = 'sm', className }) {
  if (!premium?.premium) return null

  const pixels = ICON_SIZE[size] ?? ICON_SIZE.sm

  return (
    <img
      className={clsx(styles.premiumBadge, className)}
      src={blueCheckMark.src || blueCheckMark}
      alt=""
      width={pixels}
      height={pixels}
      title="Hup Premium"
      aria-label="Hup Premium"
      role="img"
    />
  )
}
