'use client'

import { ArrowClockwiseIcon, GiftIcon, SealCheckIcon } from '@phosphor-icons/react'
import { resolveChain } from '@/lib/chains'
import { chainIconFor } from '@/lib/networkColors'
import { expiryDate, expiryRelative, formatCoin, PLAN_LABELS } from '@/lib/premium'
import Profile from '@/components/Profile'
import styles from './PremiumStatus.module.scss'

const RECENT_COUNT = 4

/**
 * The panel a subscriber sees above the plans: what they hold, until when, and the two things
 * they can do about it.
 *
 * @param {number|null} props.expiresAt Furthest expiry across every chain, unix seconds.
 * @param {boolean} props.complimentary Premium given by a moderator, which never expires.
 * @param {object[]} props.chains Per-chain standing, furthest first.
 * @param {object[]} props.purchases Recent purchases and gifts.
 */
export default function PremiumStatus({ expiresAt, complimentary, chains, purchases, onRenew, onGift }) {
  const active = (chains ?? []).filter((entry) => entry.active)
  const recent = (purchases ?? []).slice(0, RECENT_COUNT)

  return (
    <section className={styles.status}>
      <header className={styles.status__header}>
        <span className={styles.status__mark} aria-hidden="true">
          <SealCheckIcon size={18} weight="fill" />
        </span>
        <div>
          <strong className={styles.status__title}>Premium is active</strong>
          {complimentary ? (
            /* A comp has no expiry, so there is no date to print. Saying "lapses never" would
               be worse than saying what it actually is. */
            <span className={styles.status__expiry}>
              Complimentary — given by the Hup team, with no end date. Nothing to renew.
            </span>
          ) : (
            /* Both forms, because neither is enough on its own: the date is what people plan
               around, the relative phrase is what they actually read. */
            <span className={styles.status__expiry}>
              Renews nothing automatically — it lapses {expiryRelative(expiresAt)}, on {expiryDate(expiresAt)}.
            </span>
          )}
        </div>
      </header>

      {active.length > 0 && (
        <ul className={styles.status__chains}>
          {active.map((entry) => {
            const chain = resolveChain(entry.networkId)
            const icon = chainIconFor(chain)

            return (
              <li key={entry.networkId} className={styles.status__chain}>
                {icon && <img src={icon} alt="" width={13} height={13} />}
                <span>{chain?.name ?? entry.networkId}</span>
                <span className={styles.status__muted}>
                  {entry.complimentary ? 'complimentary' : expiryRelative(entry.expiresAt)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {recent.length > 0 && (
        <ul className={styles.status__history}>
          {recent.map((purchase) => {
            const chain = resolveChain(purchase.networkId)

            return (
              <li key={purchase.txHash} className={styles.status__entry}>
                <span className={styles.status__entryLabel}>
                  {purchase.kind === 'grant' ? 'Credited' : (PLAN_LABELS[purchase.planId]?.name ?? 'Premium')}
                  {purchase.gifted && (
                    <>
                      {' · gift from '}
                      <Profile
                        creator={purchase.payer}
                        networkId={purchase.networkId}
                        variant="fullWithoutTime"
                        size={18}
                        fingerprint={false}
                        className={styles.status__giver}
                      />
                    </>
                  )}
                </span>
                {/* A token purchase is stored in that token's base units, so it must be scaled
                    by the token's decimals and not the chain coin's — six decimals apart. */}
                <span className={styles.status__muted}>
                  {purchase.kind === 'grant'
                    ? '—'
                    : purchase.tokenSymbol
                      ? formatCoin(purchase.paidWei, purchase.tokenSymbol, purchase.tokenDecimals ?? 18)
                      : formatCoin(purchase.paidWei, chain?.nativeCurrency?.symbol)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.status__actions}>
        <button type="button" onClick={onRenew} className={styles.status__action}>
          <ArrowClockwiseIcon size={14} aria-hidden="true" />
          Add more time
        </button>
        <button type="button" onClick={onGift} className={styles.status__action}>
          <GiftIcon size={14} aria-hidden="true" />
          Gift it to someone
        </button>
      </div>
    </section>
  )
}
