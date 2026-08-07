'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { lsp7Abi, normalizeAddress } from '@/lib/walletAssets'
import { EMPTY_RECIPIENT, rememberRecipient } from '@/lib/recipientSearch'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import RecipientField from './ui/RecipientField'
import styles from './SendTokenModal.module.scss'

/**
 * SendTokenModal
 * Wallet-to-wallet transfer of one holding from the profile Assets tab. Three shapes reach this
 * dialog and each moves differently: the native coin is a plain value transfer, an ERC20 is
 * transfer(to, amount), and an LSP7 is transfer(from, to, amount, force, data) — forced, because
 * an unforced LSP7 transfer rejects every recipient that isn't an LSP1-aware contract.
 *
 * Mount = open / unmount = close, matching the TipModal and NewPost dialog contract.
 */
export default function SendTokenModal({ asset, owner, onSent, onClose }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()

  const [recipient, setRecipient] = useState(EMPTY_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [hash, setHash] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: asset.chainId })

  const chain = useMemo(() => appChains.find((item) => item.id === asset.chainId), [asset.chainId])
  const balance = useMemo(() => BigInt(asset.balance), [asset.balance])
  const recipientAddress = recipient.address

  // parseUnits throws on anything that isn't a clean decimal, which is just "not a number yet"
  const amountUnits = useMemo(() => {
    if (!amount.trim()) return null
    try {
      return parseUnits(amount.trim(), asset.decimals)
    } catch {
      return null
    }
  }, [amount, asset.decimals])

  const wrongChain = Boolean(walletChain) && walletChain.id !== asset.chainId
  const overBalance = amountUnits !== null && amountUnits > balance
  const isBusy = isSubmitting || isSwitching || isConfirming
  const canSubmit = Boolean(recipientAddress) && amountUnits !== null && amountUnits > 0n && !overBalance && !isBusy

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!isConfirmed) return
    toast(`Sent ${amount} ${asset.symbol}`, 'success')
    // Only a confirmed transfer earns a place in the recipient shortlist
    rememberRecipient(owner, { address: recipientAddress, ...recipient.profile })
    onSent?.()
    dialogRef.current?.close()
    // Firing on confirmation only — re-running on the amount/symbol identity would double-toast
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const sender = normalizeAddress(address)
    if (!sender || sender !== normalizeAddress(owner)) {
      toast('Connect the wallet that holds this token to send it', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      // The write has to land on the asset's chain, not whichever one the wallet happens to be on
      if (wrongChain) await switchChainAsync({ chainId: asset.chainId })

      let submitted
      if (asset.isNative) {
        submitted = await sendTransactionAsync({ to: recipientAddress, value: amountUnits, chainId: asset.chainId })
      } else if (asset.isLsp7) {
        submitted = await writeContractAsync({
          address: asset.address,
          abi: lsp7Abi,
          functionName: 'transfer',
          args: [sender, recipientAddress, amountUnits, true, '0x'],
          chainId: asset.chainId,
        })
      } else {
        submitted = await writeContractAsync({
          address: asset.address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipientAddress, amountUnits],
          chainId: asset.chainId,
        })
      }

      setHash(submitted)
    } catch (error) {
      toast(error?.shortMessage || error?.message || 'Transaction rejected', 'error')
      setIsSubmitting(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sendToken}
      aria-label={`Send ${asset.symbol}`}
      onClick={(event) => event.stopPropagation()}
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.sendToken__header}>
        <button type="button" className={styles.sendToken__cancel} onClick={() => dialogRef.current?.close()} disabled={isBusy}>
          Cancel
        </button>
        <h2 className={styles.sendToken__title}>Send {asset.symbol}</h2>
      </header>

      <form className={styles.sendToken__body} onSubmit={handleSubmit}>
        <p className={styles.sendToken__balance}>
          <span>Available</span>
          <span>
            {formatUnits(balance, asset.decimals)} {asset.symbol}
            {chain && <span className={styles.sendToken__network}> on {chain.name}</span>}
          </span>
        </p>

        <RecipientField
          id="sendTokenRecipient"
          label="Recipient"
          value={recipient}
          onChange={setRecipient}
          viewer={owner}
          exclude={[owner]}
          disabled={isBusy}
        />

        <div className={styles.sendToken__field}>
          <label htmlFor="sendTokenAmount">Amount</label>
          <div className={styles.sendToken__amountRow}>
            <input
              type="text"
              inputMode="decimal"
              id="sendTokenAmount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
            />
            {/* No Max for the native coin — spending the whole balance leaves nothing for gas */}
            {!asset.isNative && (
              <button
                type="button"
                className={styles.sendToken__max}
                onClick={() => setAmount(formatUnits(balance, asset.decimals))}
                disabled={isBusy}
              >
                Max
              </button>
            )}
          </div>
          {overBalance && <span className={styles.sendToken__error}>More than the available balance.</span>}
          {asset.isNative && <span className={styles.sendToken__hint}>Leave some {asset.symbol} behind to cover gas.</span>}
        </div>

        {wrongChain && chain && (
          <p className={styles.sendToken__hint}>Your wallet will be asked to switch to {chain.name} first.</p>
        )}

        <button type="submit" className={clsx(styles.sendToken__submit, 'w-100')} disabled={!canSubmit}>
          {isSwitching ? 'Switching network…' : isSubmitting && !isConfirming ? 'Confirm in wallet…' : isConfirming ? 'Sending…' : 'Send'}
        </button>
      </form>
    </NativeDialog>
  )
}
