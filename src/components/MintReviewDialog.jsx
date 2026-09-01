'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { formatUnits } from 'viem'
import { ArrowRightIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './MintReviewDialog.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

/**
 * Mint Review Dialog
 * The last screen before the wallet opens: what is being minted, what it costs in full, and where
 * it lands.
 *
 * It exists because the price on a mint button is not the price. A phase priced in a token is
 * quoted in that token while the platform fee is charged in the chain's native coin, so the
 * wallet prompt is the first place a minter would otherwise see two currencies — and a "free"
 * mint that asks for value is exactly the moment someone rejects the transaction and assumes
 * something is wrong. Naming both here means the wallet confirms what was already agreed.
 *
 * @param {Object} props
 * @param {string} props.name Collection name.
 * @param {string} [props.imageUrl] Artwork, shown small.
 * @param {number} props.quantity How many are being minted.
 * @param {bigint} props.unitPrice Creator's price per item, in the phase's currency.
 * @param {bigint} props.totalPrice `unitPrice × quantity`.
 * @param {string} props.priceSymbol The phase's currency symbol.
 * @param {number} props.priceDecimals The phase's currency decimals.
 * @param {bigint} props.platformFeeTotal Flat platform fee for this mint, in native coin.
 * @param {string} props.nativeSymbol The chain's native symbol.
 * @param {number} props.nativeDecimals The chain's native decimals.
 * @param {boolean} props.needsApproval Whether a token approval precedes the mint, which makes
 *   this a two-transaction flow and is worth saying before the first prompt rather than after.
 * @param {string} props.recipient Where the tokens land.
 * @param {string} [props.chainName] Chain the mint happens on.
 * @param {boolean} [props.busy] A transaction is already in flight.
 * @param {Function} props.onConfirm Runs the mint. The dialog closes itself first.
 */
const MintReviewDialog = forwardRef(function MintReviewDialog(
  {
    name,
    imageUrl,
    quantity,
    unitPrice,
    totalPrice,
    priceSymbol,
    priceDecimals,
    platformFeeTotal,
    nativeSymbol,
    nativeDecimals,
    needsApproval = false,
    recipient,
    chainName,
    busy = false,
    onConfirm,
  },
  ref,
) {
  const dialogRef = useRef(null)
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.open(), close: () => dialogRef.current?.close() }), [])

  const isFree = totalPrice === 0n
  const hasFee = platformFeeTotal > 0n
  const price = (value, decimals) => amountFormat.format(Number(formatUnits(value, decimals)))

  // Two currencies cannot be summed into one total, and pretending otherwise is how a minter ends
  // up surprised at the wallet. A token-priced phase shows its two lines and no total.
  const sameCurrency = priceSymbol === nativeSymbol
  const grandTotal = sameCurrency ? totalPrice + platformFeeTotal : null

  const steps = [needsApproval && 'Approve the token', 'Confirm the mint'].filter(Boolean)

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.review}
      aria-label="Review this mint"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      // Rendered inside a card that may itself sit in a dialog — React re-dispatches close and
      // cancel up the tree, so both stop here or closing this closes its host too
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <header className={styles.review__head}>
        <div>
          <h3>Review mint</h3>
          <small>
            {name} · {quantity} {quantity === 1 ? 'item' : 'items'}
          </small>
        </div>
        {imageUrl && <img src={imageUrl} alt="" className={styles.review__art} />}
      </header>

      {steps.length > 1 && (
        <ol className={styles.review__steps}>
          {steps.map((step, index) => (
            <li key={step}>
              <em>{index + 1}</em> {step}
            </li>
          ))}
        </ol>
      )}

      <dl className={styles.review__lines}>
        <div>
          <dt>
            Mint price {quantity > 1 && <span>× {quantity}</span>}
          </dt>
          <dd>{isFree ? 'Free' : `${price(totalPrice, priceDecimals)} ${priceSymbol}`}</dd>
        </div>

        {hasFee && (
          <div>
            <dt>
              Platform fee {quantity > 1 && <span>× {quantity}</span>}
            </dt>
            <dd>
              {price(platformFeeTotal, nativeDecimals)} {nativeSymbol}
            </dd>
          </div>
        )}

        <div className={styles['review__lines--total']}>
          <dt>Total</dt>
          <dd>
            {grandTotal !== null ? (
              `${price(grandTotal, nativeDecimals)} ${nativeSymbol}`
            ) : (
              <>
                {price(totalPrice, priceDecimals)} {priceSymbol}
                {hasFee && (
                  <>
                    {' + '}
                    {price(platformFeeTotal, nativeDecimals)} {nativeSymbol}
                  </>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      <dl className={styles.review__meta}>
        <div>
          <dt>Goes to</dt>
          <dd title={recipient}>{shortAddress(recipient)}</dd>
        </div>
        {chainName && (
          <div>
            <dt>Network</dt>
            <dd>{chainName}</dd>
          </div>
        )}
      </dl>

      <div className={styles.review__actions}>
        <button type="button" className={styles.review__cancel} onClick={() => dialogRef.current?.close()} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.review__confirm}
          disabled={busy}
          onClick={() => {
            // Closed before the wallet opens: an open dialog behind a wallet prompt is a dialog
            // the minter has to dismiss twice, and the outcome arrives as a toast either way.
            dialogRef.current?.close()
            onConfirm?.()
          }}
        >
          {busy ? 'Minting…' : needsApproval ? 'Approve and mint' : 'Confirm mint'}
          <ArrowRightIcon size={15} weight="bold" />
        </button>
      </div>
    </NativeDialog>
  )
})

export default MintReviewDialog
