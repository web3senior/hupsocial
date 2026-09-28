'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useSendTransaction, useSwitchChain } from 'wagmi'
import { parseUnits } from 'viem'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { sameAddress } from '@/lib/address'
import { trackLiveTip } from '@/lib/liveTip'
import { networkColorStyle } from '@/lib/networkColors'
import { shortTxError } from '@/lib/utils'
import { useNativePrice } from '@/hooks/useNativePrice'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import DialogHeader from '@/components/ui/DialogHeader'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './LiveTipDialog.module.scss'

const USD_PRESETS = [1, 2, 5, 10]

const amountNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const usdNumber = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

/**
 * Tips the streamer in the native coin of the chain they went live on, straight from the
 * viewer's connected wallet. Mount = open / unmount = close, like TipModal.
 */
export default function LiveTipDialog({ streamer, networkId, onClose }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const [amount, setAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const chain = useMemo(() => appChains.find((item) => item.id === Number(networkId)), [networkId])
  const symbol = chain?.nativeCurrency?.symbol || ''
  const decimals = chain?.nativeCurrency?.decimals ?? 18
  const price = useNativePrice(chain?.id)

  const amountUnits = useMemo(() => {
    if (!amount.trim()) return null
    try {
      return parseUnits(amount.trim(), decimals)
    } catch {
      return null
    }
  }, [amount, decimals])

  const wrongChain = Boolean(walletChain) && walletChain.id !== chain?.id
  const isSelf = sameAddress(address, streamer)
  const canSubmit = Boolean(chain && address && !isSelf && amountUnits !== null && amountUnits > 0n && !isSubmitting)
  const usdValue = price && Number(amount) > 0 ? usdNumber.format(Number(amount) * price) : null

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return

    setIsSubmitting(true)
    try {
      // The streamer's wallet may only exist on the chain they went live on
      if (wrongChain) await switchChainAsync({ chainId: chain.id })
      const hash = await sendTransactionAsync({ to: streamer, value: amountUnits, chainId: chain.id })
      trackLiveTip({ hash, chainId: chain.id, amountLabel: `${amountNumber.format(Number(amount))} ${symbol}` })
      dialogRef.current?.close()
    } catch (error) {
      toast(shortTxError(error, 'The tip was not sent'), 'error')
      setIsSubmitting(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.tip}
      style={networkColorStyle(chain)}
      aria-label="Tip the streamer"
      lightDismiss
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
    >
      <DialogHeader title="Tip" onCancel={() => dialogRef.current?.close()} compact />

      <form className={styles.tip__body} onSubmit={handleSubmit}>
        <Profile creator={streamer} variant="fullWithoutTime" hoverCard={false} />

        {price && (
          <div className={styles.tip__presets} role="group" aria-label="Amount in dollars">
            {USD_PRESETS.map((usd) => {
              const value = String(Number((usd / price).toPrecision(4)))
              return (
                <button
                  key={usd}
                  type="button"
                  className={clsx(styles.tip__preset, amount === value && styles['tip__preset--active'])}
                  onClick={() => setAmount(value)}
                  disabled={isSubmitting}
                >
                  ${usd}
                </button>
              )
            })}
          </div>
        )}

        <div className={styles.tip__field}>
          <label htmlFor="liveTipAmount">Amount in {symbol}</label>
          <input
            id="liveTipAmount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.0"
            autoComplete="off"
            spellCheck={false}
            disabled={isSubmitting}
          />
          {usdValue && <span className={styles.tip__hint}>About {usdValue}</span>}
        </div>

        {chain && (
          <p className={styles.tip__hint}>
            Sent on {chain.name}, the network the streamer went live on.
            {wrongChain && ' Your wallet will be asked to switch first.'}
          </p>
        )}
        {isSelf && <p className={styles.tip__hint}>This is your own stream.</p>}

        <button type="submit" className={styles.tip__submit} disabled={!canSubmit}>
          {isSubmitting ? 'Confirm in wallet…' : 'Send tip'}
        </button>
      </form>
    </NativeDialog>
  )
}
