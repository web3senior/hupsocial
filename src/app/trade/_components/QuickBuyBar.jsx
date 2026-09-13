'use client'

import { useState } from 'react'
import clsx from 'clsx'
import NativePopover from '@/components/ui/NativePopover'
import useQuickBuyAmount, { MAX_QUICK_BUY_USD, QUICK_BUY_PRESETS } from '@/hooks/useQuickBuyAmount'
import useSlippagePreference, { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } from '@/hooks/useSlippagePreference'
import { GearSixIcon, LightningIcon } from '@phosphor-icons/react'
import styles from './QuickBuyBar.module.scss'

/**
 * Quick Buy Bar
 * What one press of a row's ⚡ is authorised to spend, and how much slippage it may accept.
 *
 * The amount sits in the toolbar rather than behind the gear because it is the number a trader
 * changes between tokens, not once a month — and because a button that spends money should say
 * what it spends without being opened first. Slippage is the opposite kind of setting, so it
 * lives in the panel.
 *
 * Dollars rather than the pool's own asset: every launch is priced in whatever it was paired
 * against, so a single figure across a table of them can only be a dollar one. Each row converts
 * at its own quote asset's price, and a pool with no feed disables its button instead of guessing.
 */
const QuickBuyBar = () => {
  const [amount, setAmount] = useQuickBuyAmount()
  const [slippageBps, setSlippageBps] = useSlippagePreference()
  // Typing "1." has to survive the keystroke that made it, so the box holds a draft until it is
  // left — only a finished edit is worth remembering
  const [draft, setDraft] = useState(null)

  const commit = () => {
    if (draft !== null) setAmount(draft)
    setDraft(null)
  }

  return (
    <div className={styles.quickBuy}>
      <span className={styles.quickBuy__mark} aria-hidden="true">
        <LightningIcon size={15} weight="fill" />
      </span>

      <input
        className={styles.quickBuy__amount}
        type="number"
        inputMode="decimal"
        min="0"
        max={MAX_QUICK_BUY_USD}
        step="any"
        value={draft ?? amount}
        aria-label="One-click buy amount in dollars"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />

      <span className={styles.quickBuy__unit}>USD</span>

      <NativePopover
        placement="bottom-end"
        className={styles.quickBuy__panel}
        trigger={
          <button type="button" className={styles.quickBuy__gear} aria-label="Quick buy settings">
            <GearSixIcon size={16} />
          </button>
        }
      >
        <div className={styles.quickBuy__group}>
          <span className={styles.quickBuy__label}>Buy amount</span>
          <div className={styles.quickBuy__presets}>
            {QUICK_BUY_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(Number(amount) === preset && styles['quickBuy__preset--active'])}
                onClick={() => setAmount(preset)}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.quickBuy__group}>
          <span className={styles.quickBuy__label}>Max slippage</span>
          <div className={styles.quickBuy__slippage}>
            <input
              type="number"
              min="0.1"
              max={MAX_SLIPPAGE_BPS / 100}
              step="0.1"
              value={slippageBps / 100}
              aria-label="Max slippage percent"
              onChange={(event) => setSlippageBps(Number(event.target.value) * 100)}
            />
            <span>%</span>
            {slippageBps !== DEFAULT_SLIPPAGE_BPS && (
              <button type="button" onClick={() => setSlippageBps(DEFAULT_SLIPPAGE_BPS)}>
                Reset
              </button>
            )}
          </div>
        </div>

        <p className={styles.quickBuy__note}>
          One press buys straight from your connected wallet. A pool quoted in an ERC20 needs its
          approval first — the button walks you through it.
        </p>
      </NativePopover>
    </div>
  )
}

export default QuickBuyBar
