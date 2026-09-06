'use client'

import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { networkColorStyle } from '@/lib/networkColors'
import styles from './DropsHero.module.scss'

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * Drops Hero
 * The band above the drops surfaces: what this is, on the left, and the one thing to do about it
 * on the right.
 *
 * It stays dark in both themes on purpose. This is a banner rather than a panel — the same shape a
 * launchpad uses to introduce itself — and a band that flips to white in light mode stops reading
 * as one and starts reading as another card in the stack.
 *
 * @param {string} props.title The headline, one line.
 * @param {React.ReactNode} props.children The supporting line, so callers can inline chain marks.
 * @param {React.ReactNode} [props.action] The call to action, pinned right.
 * @param {number} [props.chainId] Tints the action with that chain's colour.
 */
export default function DropsHero({ title, children, action, chainId, className }) {
  const chainInfo = appChains.find((chain) => chain.id === chainId)

  return (
    <section className={clsx(styles.hero, className)} style={networkColorStyle(chainInfo)}>
      <div className={styles.hero__copy}>
        <p className={styles.hero__title}>{title}</p>
        {children && <p className={styles.hero__line}>{children}</p>}
      </div>

      {action && <div className={styles.hero__action}>{action}</div>}
    </section>
  )
}

/** A chain's icon and name, for the supporting line. Exported so callers can list several. */
export function HeroChain({ chainId }) {
  const chain = appChains.find((entry) => entry.id === chainId)
  if (!chain) return null
  const icon = chainIconFor(chain)

  return (
    <span className={styles.hero__chain}>
      {icon && <img src={icon} alt="" />}
      {chain.name}
    </span>
  )
}
