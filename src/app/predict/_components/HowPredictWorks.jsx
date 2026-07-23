'use client'

import { useRef } from 'react'
import { QuestionIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './HowPredictWorks.module.scss'

/**
 * How Predict Works
 * A small "?" trigger opening a light box with the general rules true for every market —
 * the moving-odds mechanic and the escrow/refund guarantees users can't infer from the UI.
 * Market-specific rules live in each market's own description.
 */
export default function HowPredictWorks() {
  const dialogRef = useRef(null)

  return (
    <>
      <button
        type="button"
        className={styles.howItWorks__trigger}
        onClick={() => dialogRef.current?.open()}
        aria-label="How Predict works"
        title="How Predict works"
      >
        <QuestionIcon size={16} />
      </button>

      <NativeDialog ref={dialogRef} className={styles.howItWorks} aria-label="How Predict works" onClick={(e) => e.stopPropagation()}>
        <header className={styles.howItWorks__header}>
          <h3>How Predict works</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.howItWorks__close}>
            <XIcon size={18} />
          </button>
        </header>

        <ol className={styles.howItWorks__list}>
          <li>
            <strong>You bet into pools, not at a fixed price.</strong>{' '}The percentages are each outcome&apos;s share of the pot —
            they keep moving as others bet, and your final payout multiplier is set only when betting closes.
          </li>
          <li>
            <strong>A judge picks the winner.</strong>{' '}Judges are people who accepted the role with their own wallet. Winners
            split the entire pot in proportion to their stake, minus the market&apos;s protocol fee — locked in when the market
            was created.
          </li>
          <li>
            <strong>You can always get your money back if things go wrong.</strong>{' '}Canceled markets, judges who never resolve
            in time, or a result nobody bet on — all of it refunds every stake 100%, no fee.
          </li>
          <li>
            <strong>Winnings and refunds never expire.</strong>{' '}They sit in the contract until you claim them — tomorrow or
            next year.
          </li>
          <li>
            <strong>Nobody can touch the pot.</strong>{' '}Staked money can&apos;t be withdrawn by the creator, the judges, or the
            platform — the contract only ever pays bettors. Verdicts require the judge&apos;s own signature.
          </li>
          <li>
            <strong>Each market has its own rules.</strong>{' '}Read the market&apos;s description for how its judge will decide. The
            judge panel is fixed from the first bet onward.
          </li>
        </ol>
      </NativeDialog>
    </>
  )
}
