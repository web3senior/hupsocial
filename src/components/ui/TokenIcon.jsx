'use client'

import clsx from 'clsx'
import { CoinIcon } from '@phosphor-icons/react'
import { tokenIconUrl } from '@/lib/tokenIcons'
import styles from './TokenIcon.module.scss'

// Glyph size per circle size — the fallback should read as a coin, not fill the ring
const GLYPH = { sm: 13, md: 16, lg: 18 }

/**
 * Token Icon
 * One circle for every token the swap page shows. The artwork layers OVER the coin glyph
 * instead of replacing it: CDN logos 404 for most addresses, so an <img> that hides itself
 * onError leaves the glyph already painted underneath with nothing to swap in.
 *
 * A token's own `logo` wins — the chain icon for native coins, the uploaded image for Hup
 * launches — and everything else falls back to TrustWallet, which covers the curated majors
 * and any listed ERC20 someone pastes in.
 *
 * An optional `badge` ({url, label}, from config/chainBadges) pins a chain mark to the corner,
 * for the tokens whose artwork does not say what chain they live on. It sits in a wrapper
 * rather than inside the circle, which clips its children to the disc.
 */
const TokenIcon = ({ token, chainId, size = 'lg', className, badge }) => {
  const src = token?.logo || tokenIconUrl(chainId, token?.address)

  const circle = (
    <span className={clsx(styles.tokenIcon, styles[`tokenIcon--${size}`], !badge && className)} aria-hidden="true">
      <CoinIcon size={GLYPH[size] ?? GLYPH.lg} />
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
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
