'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useConnection, useSwitchChain, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import {
  BACK_PRESETS_USD,
  encodeMemo,
  formatAmount,
  formatUsdRound,
  MAX_FUND_MEMO_BYTES,
  memoByteLength,
  nativeToWei,
  usdToNative,
} from '@/lib/fund'
import { trackBacking } from '@/lib/fundTracking'
import { networkColorStyle } from '@/lib/networkColors'
import { shortTxError } from '@/lib/utils'
import fundAbi from '@/abis/HupFund.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import Profile from './Profile'
import { WarningIcon } from '@phosphor-icons/react'
import styles from './BackFundModal.module.scss'

/**
 * Back Fund Modal
 * Sends a backing to a campaign through HupFund, in the chain's native coin. The amount is
 * chosen in dollars, because that is the unit people think in — the coin figure underneath is
 * what actually goes on the wire, and it is always shown before the button is pressed. A chain
 * with no market price falls back to entering the coin amount directly.
 *
 * The money always comes from the connected wallet: the contract answers to nobody but the
 * signer, and there is no relayer or session key in the loop by design.
 * @param {Object} props
 * @param {Object} props.campaign Indexed campaign row.
 * @param {Function} props.onClose Clears the open-modal state.
 * @param {boolean} [props.firstTime=true] Whether the viewer has backed this campaign before —
 *   decides if the optimistic backer count moves as well as the raised figure.
 */
export default function BackFundModal({ campaign, onClose, firstTime = true }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { writeContractAsync } = useWriteContract()

  const chainId = Number(campaign.network_id)
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const symbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const fundAddress = CONTRACTS[`chain${chainId}`]?.fund || null
  const price = Number(campaign.native_usd) || null
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)
  const isCreator = address && campaign.wallet_address && address.toLowerCase() === campaign.wallet_address.toLowerCase()

  // Dollars while the chain has a price, coin otherwise — the same field either way, so the
  // whole form is one number and a unit rather than two modes to learn
  const [usd, setUsd] = useState(String(BACK_PRESETS_USD[1]))
  const [native, setNative] = useState('')
  const [memo, setMemo] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Mount = open / unmount = close, matching the TipModal contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const nativeAmount = price ? usdToNative(Number(usd), price) : native
  const amountWei = nativeAmount ? nativeToWei(nativeAmount) : null
  const memoBytes = memoByteLength(memo)
  const isMemoTooLong = memoBytes > MAX_FUND_MEMO_BYTES

  // What both the button and the toast call this backing. The dollar figure leads when there
  // is one, because that is what the backer chose.
  const amountLabel = price
    ? `${formatUsdRound(Number(usd))} · ${formatAmount(amountWei ?? 0n, symbol)}`
    : formatAmount(amountWei ?? 0n, symbol)

  const canSend = Boolean(amountWei && fundAddress && !isWrongChain && !isCreator && !isMemoTooLong && address)

  const handleBack = async (e) => {
    e.stopPropagation()
    if (!canSend || isSubmitting) return

    setIsSubmitting(true)
    try {
      const hash = await writeContractAsync({
        abi: fundAbi,
        address: fundAddress,
        functionName: 'back',
        args: [BigInt(campaign.campaign_id), encodeMemo(memo)],
        chainId,
        value: amountWei,
      })

      // The transaction is sent: the modal's job is done. The receipt, the toast that reports
      // it and the optimistic figure are handed to the tracker, which outlives this component.
      trackBacking({ campaign, hash, amount: amountWei, firstTime, amountLabel })
      dialogRef.current?.close()
    } catch (err) {
      toast(shortTxError(err, 'Backing failed'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.backModal}
      aria-label="Back this campaign"
      style={networkColorStyle(chainInfo)}
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
      onCancel={(e) => {
        e.stopPropagation()
        if (isSubmitting) e.preventDefault()
      }}
    >
      <header className={styles.backModal__header}>
        <button type="button" className={styles.backModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Back this campaign</h3>
      </header>

      <main className={styles.backModal__body}>
        <div className={styles.backModal__recipient}>
          <Profile variant="fullWithoutTime" creator={campaign.wallet_address} networkId={chainId} />
          <p className={styles.backModal__recipientNote}>
            {isCreator
              ? 'This is your own campaign — you cannot back it.'
              : `Your ${symbol} is held by the contract until backing ends. The creator then withdraws it to the campaign's payout address, or opens refunds and you take yours back in full.`}
          </p>
        </div>

        {isWrongChain && (
          <div className={styles.backModal__chainWarning}>
            <WarningIcon size={14} />
            <span>This campaign lives on {chainInfo?.name || 'another network'}.</span>
            <button type="button" onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {price ? (
          <div className={styles.backModal__field}>
            <label htmlFor="backAmountUsd">Amount</label>
            <div className={styles.backModal__amount}>
              <span className={styles.backModal__amountUnit}>$</span>
              <input
                type="number"
                id="backAmountUsd"
                value={usd}
                min={0}
                step="any"
                inputMode="decimal"
                onChange={(e) => setUsd(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className={styles.backModal__presets}>
              {BACK_PRESETS_USD.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={clsx(styles.backModal__preset, Number(usd) === preset && styles['backModal__preset--active'])}
                  onClick={() => setUsd(String(preset))}
                >
                  ${preset}
                </button>
              ))}
            </div>
            {/* The coin figure is what actually goes on the wire, so it is never hidden behind
                the dollar amount the backer typed */}
            <small className={styles.backModal__conversion}>
              {amountWei ? `You send ${formatAmount(amountWei, symbol)} at ${formatUsdRound(price)} per ${symbol}` : `Enter an amount in dollars`}
            </small>
          </div>
        ) : (
          <div className={styles.backModal__field}>
            <label htmlFor="backAmountNative">Amount</label>
            <div className={styles.backModal__amount}>
              <input
                type="number"
                id="backAmountNative"
                value={native}
                min={0}
                step="any"
                inputMode="decimal"
                onChange={(e) => setNative(e.target.value)}
                placeholder="0"
              />
              <span className={styles.backModal__amountUnit}>{symbol}</span>
            </div>
            <small className={styles.backModal__conversion}>This network has no market price, so backings are entered in {symbol}.</small>
          </div>
        )}

        <div className={styles.backModal__field}>
          <label htmlFor="backMemo">Say something (optional)</label>
          <textarea
            id="backMemo"
            rows={2}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Good luck with this"
            maxLength={400}
          />
          <small className={clsx(styles.backModal__conversion, isMemoTooLong && styles['backModal__conversion--error'])}>
            {isMemoTooLong ? `Too long by ${memoBytes - MAX_FUND_MEMO_BYTES} bytes` : 'Shown with your backing. It rides the transaction log, so it is public and permanent.'}
          </small>
        </div>
      </main>

      <footer className={styles.backModal__footer}>
        {!fundAddress && <p className={styles.backModal__hint}>Fundraising isn&apos;t available on this network yet</p>}
        <button type="button" className={styles.backModal__send} onClick={handleBack} disabled={!canSend || isSubmitting}>
          {isSubmitting ? 'Sending…' : amountWei ? `Back with ${amountLabel}` : 'Back this campaign'}
        </button>
      </footer>
    </NativeDialog>
  )
}
