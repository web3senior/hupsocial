'use client'

import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckIcon, GiftIcon, SealCheckIcon, SparkleIcon } from '@phosphor-icons/react'
import { useActiveChain } from '@/hooks/useActiveChain'
import { usePremium, plansForChain } from '@/hooks/usePremium'
import { resolveChain } from '@/lib/chains'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import { formatCoin, formatUsd, planUsd, PLAN_LABELS, PLAN_MONTHLY, PLAN_YEARLY, PREMIUM_PERKS, yearlySavingPercent } from '@/lib/premium'
import EmptyState from '@/components/ui/EmptyState'
import PremiumCheckoutDialog from './PremiumCheckoutDialog'
import PremiumStatus from './PremiumStatus'
import styles from './PremiumPlans.module.scss'

export default function PremiumPlans() {
  const { chainId: activeChainId } = useActiveChain()
  const { isPremium, expiresAt, complimentary, chains, plans, tokens, prices, purchases, live, isLoading, refresh } = usePremium()

  const [planId, setPlanId] = useState(PLAN_YEARLY)
  const [pickedChainId, setPickedChainId] = useState(null)
  const [giftTo, setGiftTo] = useState(null)
  const checkoutRef = useRef(null)

  // Every chain with an indexed, enabled plan — a chain whose cidex cursor has not reached its
  // deploy block yet has no price to quote, so it cannot be bought on and is not offered.
  const sellingChainIds = useMemo(() => [...new Set(plans.filter((plan) => plan.enabled).map((plan) => plan.networkId))], [plans])

  // Follow the wallet where premium is actually sold there, so the default costs no clicks.
  const chainId = pickedChainId ?? (sellingChainIds.includes(Number(activeChainId)) ? Number(activeChainId) : (sellingChainIds[0] ?? null))
  const chainInfo = resolveChain(chainId)
  const { monthly, yearly } = plansForChain(plans, chainId)
  const selected = planId === PLAN_YEARLY ? yearly : monthly

  const usdPerCoin = prices?.[chainId] ?? null
  const saving = yearlySavingPercent(monthly?.priceWei, yearly?.priceWei)

  const openCheckout = (recipient = null) => {
    setGiftTo(recipient)
    checkoutRef.current?.open()
  }

  if (!isLoading && !live) {
    return (
      <EmptyState size="lg" align="center" icon={SealCheckIcon}>
        Premium isn’t live on any network yet. It’s coming.
      </EmptyState>
    )
  }

  return (
    <div className={styles.premium} style={networkColorStyle(chainInfo)}>
      <header className={styles.premium__hero}>
        <span className={styles.premium__mark} aria-hidden="true">
          <SealCheckIcon size={28} weight="fill" />
        </span>
        <h1 className={styles.premium__title}>Hup Premium</h1>
        <p className={styles.premium__lede}>
          The mark beside your name, your own accent colour, and room to post the things the free tier has to cut short. Paid onchain,
          on whichever network you already hold coins on.
        </p>
      </header>

      {isPremium && (
        <PremiumStatus
          expiresAt={expiresAt}
          complimentary={complimentary}
          chains={chains}
          purchases={purchases}
          onRenew={() => openCheckout()}
          onGift={() => openCheckout('')}
        />
      )}

      <div className={styles.premium__billing} role="group" aria-label="Billing period">
        {[PLAN_MONTHLY, PLAN_YEARLY].map((id) => (
          <button
            key={id}
            type="button"
            className={clsx(styles.premium__billingOption, planId === id && styles['premium__billingOption--active'])}
            onClick={() => setPlanId(id)}
            aria-pressed={planId === id}
          >
            {PLAN_LABELS[id].name}
            {id === PLAN_YEARLY && saving && <span className={styles.premium__saving}>save {saving}%</span>}
          </button>
        ))}
      </div>

      {sellingChainIds.length > 1 && (
        <div className={styles.premium__chains} role="group" aria-label="Pay on">
          {sellingChainIds.map((id) => {
            const chain = resolveChain(id)
            const icon = chainIconFor(chain)

            return (
              <button
                key={id}
                type="button"
                className={clsx(styles.premium__chain, id === chainId && styles['premium__chain--active'])}
                onClick={() => setPickedChainId(id)}
                aria-pressed={id === chainId}
              >
                {icon && <img src={icon} alt="" width={14} height={14} />}
                <span>{chain?.name ?? id}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className={styles.premium__card}>
        <div className={styles.premium__price}>
          {selected ? (
            <>
              {/* The dollar figure leads because it is the one people compare; the coin
                  amount below it is what the wallet will actually be asked for. */}
              <strong className={styles.premium__priceMain}>
                {formatUsd(planUsd(selected.priceWei, usdPerCoin)) ?? formatCoin(selected.priceWei, chainInfo?.nativeCurrency?.symbol)}
              </strong>
              <span className={styles.premium__pricePeriod}>{PLAN_LABELS[planId].short}</span>
              {usdPerCoin && (
                <span className={styles.premium__priceCoin}>{formatCoin(selected.priceWei, chainInfo?.nativeCurrency?.symbol)}</span>
              )}
            </>
          ) : (
            <EmptyState size="sm">No price indexed for this network yet.</EmptyState>
          )}
        </div>

        <ul className={styles.premium__perks}>
          {PREMIUM_PERKS.map((perk) => (
            <li key={perk.id} className={styles.premium__perk}>
              <CheckIcon size={14} weight="bold" aria-hidden="true" />
              <div>
                <strong>{perk.title}</strong>
                <span>{perk.description}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.premium__actions}>
          <button type="button" className={styles.premium__buy} onClick={() => openCheckout()} disabled={!selected}>
            <SparkleIcon size={16} weight="fill" aria-hidden="true" />
            {isPremium ? 'Extend premium' : 'Get Premium'}
          </button>
          <button type="button" className={styles.premium__gift} onClick={() => openCheckout('')} disabled={!selected}>
            <GiftIcon size={16} aria-hidden="true" />
            Gift it
          </button>
        </div>

        <p className={styles.premium__fineprint}>
          A term is added to whatever you already hold, so renewing early never costs you the days you’ve paid for. There is no
          auto-renewal to cancel — premium simply lapses unless you buy more.
        </p>
      </div>

      <PremiumCheckoutDialog
        ref={checkoutRef}
        chainId={chainId}
        planId={planId}
        plans={plans}
        tokens={tokens}
        prices={prices}
        giftTo={giftTo}
        onChainChange={setPickedChainId}
        onSubscribed={refresh}
      />
    </div>
  )
}
