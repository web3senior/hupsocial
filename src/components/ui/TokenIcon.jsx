'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { CoinIcon } from '@phosphor-icons/react'
import { tokenIconUrl } from '@/lib/tokenIcons'
import styles from './TokenIcon.module.scss'

// Glyph size per circle size — the fallback should read as a coin, not fill the ring
const GLYPH = { sm: 13, md: 16, lg: 18 }

/**
 * Token Icon
 * One circle for every token the app shows. The coin glyph is a fallback, not a backdrop:
 * it draws only when there is no artwork to draw, because most token logos are transparent
 * PNGs and a coin sitting under one reads as two icons stacked.
 *
 * A token's own `logo` wins — the chain icon for native coins, the uploaded image for Hup
 * launches — and everything else falls back to TrustWallet, which covers the curated majors
 * and any listed ERC20 someone pastes in. Those CDN URLs 404 for most addresses, so a failed
 * load hands the circle back to the glyph.
 *
 * An optional `badge` ({url, label}, from config/chainBadges) pins a chain mark to the corner,
 * for the tokens whose artwork does not say what chain they live on. It sits in a wrapper
 * rather than inside the circle, which clips its children to the disc.
 */
const TokenIcon = ({ token, chainId, size = 'lg', className, badge }) => {
  const src = token?.logo || tokenIconUrl(chainId, token?.address)

  // The src that 404'd, not a flag: a circle handed a different token clears its own verdict
  // during render, so a swapped-in logo is never suppressed by the last one's failure
  const [failedSrc, setFailedSrc] = useState(null)
  const hasArt = Boolean(src) && failedSrc !== src

  const circle = (
    <span className={clsx(styles.tokenIcon, styles[`tokenIcon--${size}`], !badge && className)} aria-hidden="true">
      {hasArt ? (
        <img key={src} src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <CoinIcon size={GLYPH[size] ?? GLYPH.lg} />
      )}
    </span>
  )

  if (!badge) return circle

  return (
    <span className={clsx(styles.tokenIcon__wrap, styles[`tokenIcon__wrap--${size}`], className)}>
      {circle}
      <img className={styles.tokenIcon__badge} src={badge.url} alt="" title={badge.label} loading="lazy" />
    </span>
  )
}

export default TokenIcon
