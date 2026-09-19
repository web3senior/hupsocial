'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { erc20Abi } from 'viem'
import { useConnection, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { GiftIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { resolveChain } from '@/lib/chains'
import { networkColorStyle } from '@/lib/networkColors'
import { plansForChain, paymentOptionsFor } from '@/hooks/usePremium'
import {
  durationLabel,
  formatCoin,
  formatUsd,
  isNativeToken,
  planUsd,
  PLAN_LABELS,
  PLAN_YEARLY,
  TOKEN_STANDARD,
  toWei,
} from '@/lib/premium'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import premiumAbi from '@/abis/HupPremium.json'
import lsp7Abi from '@/abi/lsp7.json'
import styles from './PremiumCheckoutDialog.module.scss'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/* An LSP7 grants an operator rather than an allowance, and the two calls take different
   arguments in a different order. Reading the current grant first is what keeps a second
   purchase down to one transaction instead of two. */
const allowanceCall = (option, owner, spender) =>
  option.standard === TOKEN_STANDARD.LSP7
    ? { abi: lsp7Abi, functionName: 'authorizedAmountFor', args: [spender, owner] }
    : { abi: erc20Abi, functionName: 'allowance', args: [owner, spender] }

const approveCall = (option, spender, amount) =>
  option.standard === TOKEN_STANDARD.LSP7
    ? { abi: lsp7Abi, functionName: 'authorizeOperator', args: [spender, amount, '0x'] }
    : { abi: erc20Abi, functionName: 'approve', args: [spender, amount] }

/**
 * Confirms and sends the purchase. Premium moves value, so it is signed by the connected
 * wallet — never a burner session, and never the relayer.
 *
 * Paying in a token is two transactions: the token has to be told this contract may take the
 * money before this contract can take it. That is a property of ERC20 and LSP7, not a choice
 * made here, so the dialog states it rather than hiding it behind one button.
 *
 * @param {number|null} props.chainId Chain the plan was priced on.
 * @param {number} props.planId Monthly or yearly.
 * @param {object[]} props.plans The indexed plan table.
 * @param {object[]} props.tokens The indexed token-price table.
 * @param {Object} props.prices Native coin USD price by network id.
 * @param {string|null} props.giftTo '' opens the dialog in gift mode; null buys for yourself.
 * @param {Function} props.onChainChange Called when the dialog's own chain picker moves.
 * @param {Function} props.onSubscribed Called once the purchase confirms, to refresh status.
 */
const PremiumCheckoutDialog = forwardRef(function PremiumCheckoutDialog(
  { chainId, planId, plans, tokens, prices, giftTo, onChainChange, onSubscribed },
  ref,
) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  const [recipient, setRecipient] = useState('')
  const [payWith, setPayWith] = useState(null)
  const [isApproving, setIsApproving] = useState(false)
  const isGift = giftTo !== null && giftTo !== undefined

  const chainInfo = resolveChain(chainId)
  const premiumAddress = CONTRACTS[`chain${chainId}`]?.premium
  const { monthly, yearly } = plansForChain(plans, chainId)
  const plan = planId === PLAN_YEARLY ? yearly : monthly
  const usdPerCoin = prices?.[chainId] ?? null
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)

  const options = paymentOptionsFor(tokens, chainId, planId, plan, chainInfo)
  const option = options.find((entry) => entry.token === payWith) ?? options[0] ?? null
  const paysWithToken = Boolean(option && !option.isNative)

  const sellingChainIds = [...new Set((plans ?? []).filter((entry) => entry.enabled).map((entry) => entry.networkId))]

  const { data: hash, isPending, mutate: writeContract, mutateAsync: writeContractAsync, error: submitError, reset } = useWriteContract()
  const { isSuccess: isConfirmed, isError: isReverted } = useWaitForTransactionReceipt({ hash })

  useImperativeHandle(ref, () => ({
    open: () => {
      setRecipient(isGift ? (giftTo ?? '') : '')
      setPayWith(null)
      setIsApproving(false)
      reset()
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  // Closed on the hash, not on the receipt: the wallet has accepted it and there is nothing
  // left to decide here. The verdict arrives as a toast, which outlives this dialog.
  useEffect(() => {
    if (!hash) return
    dialogRef.current?.close()
    toast('Payment sent — your premium starts as soon as it confirms', 'info')
  }, [hash])

  useEffect(() => {
    if (!isConfirmed) return
    toast(isGift ? 'Gifted — their premium is live' : 'Premium is live', 'success')
    onSubscribed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  useEffect(() => {
    if (!isReverted) return
    toast('The payment failed onchain — nothing was charged', 'error')
  }, [isReverted])

  /** Grants this contract the right to take the price, unless it already has it. */
  const ensureApproval = async () => {
    const amount = toWei(option.price)
    const publicClient = config.getClient({ chainId })

    const existing = await publicClient
      .readContract({ address: option.token, ...allowanceCall(option, address, premiumAddress) })
      .catch(() => 0n)

    if (toWei(existing) >= amount) return

    setIsApproving(true)
    try {
      const approvalHash = await writeContractAsync({
        address: option.token,
        chainId,
        ...approveCall(option, premiumAddress, amount),
      })

      /* Waited for, unlike the purchase itself: the next transaction reverts unless this one
         has landed, so there is nothing optimistic to be had here. */
      await publicClient.waitForTransactionReceipt({ hash: approvalHash })
    } finally {
      setIsApproving(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!premiumAddress || !plan || !option) {
      toast('Premium isn’t available on this network yet', 'error')
      return
    }

    const trimmed = recipient.trim()
    if (isGift && !ADDRESS_PATTERN.test(trimmed)) {
      toast('Enter the wallet address to gift premium to', 'error')
      return
    }

    if (!paysWithToken) {
      writeContract({
        abi: premiumAbi,
        address: premiumAddress,
        functionName: isGift ? 'subscribeFor' : 'subscribe',
        args: isGift ? [trimmed, planId] : [planId],
        value: toWei(option.price),
        chainId,
      })
      return
    }

    try {
      await ensureApproval()
    } catch (approvalError) {
      toast(approvalError.shortMessage || approvalError.message || 'Approval rejected', 'error')
      return
    }

    writeContract({
      abi: premiumAbi,
      address: premiumAddress,
      functionName: isGift ? 'subscribeForWithToken' : 'subscribeWithToken',
      args: isGift ? [trimmed, planId, option.token] : [planId, option.token],
      chainId,
    })
  }

  const priceLabel = option ? formatCoin(option.price, option.symbol, option.decimals) : null
  /* Only the native coin has a market rate to convert. A stablecoin's price is already the
     dollar figure, so printing "≈ $6.00" beside "6 USDC" would be noise. */
  const priceUsd = option?.isNative ? formatUsd(planUsd(option.price, usdPerCoin, option.decimals)) : null
  const isBusy = isPending || isApproving

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.checkout}
      aria-label={isGift ? 'Gift premium' : 'Get premium'}
      style={networkColorStyle(chainInfo)}
      onCancel={(event) => {
        // Esc must not close the dialog out from under a wallet prompt
        if (isBusy) event.preventDefault()
      }}
    >
      <form className={styles.checkout__body} onSubmit={handleSubmit}>
        <header className={styles.checkout__header}>
          <h3>{isGift ? 'Gift Premium' : 'Get Premium'}</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.checkout__close}>
            <XIcon size={18} />
          </button>
        </header>

        <dl className={styles.checkout__summary}>
          <div>
            <dt>Plan</dt>
            <dd>
              {PLAN_LABELS[planId].name}
              {plan && <span className={styles.checkout__muted}> · {durationLabel(plan.duration)}</span>}
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              <strong>{priceLabel ?? '—'}</strong>
              {priceUsd && <span className={styles.checkout__muted}> · {priceUsd}</span>}
            </dd>
          </div>
        </dl>

        {options.length > 1 && (
          <label className={styles.checkout__field}>
            <span>Pay with</span>
            <select value={option?.token ?? ''} onChange={(event) => setPayWith(event.target.value)} disabled={isBusy}>
              {options.map((entry) => (
                <option key={entry.token} value={entry.token}>
                  {entry.symbol || (isNativeToken(entry.token) ? 'Native coin' : 'Token')} —{' '}
                  {formatCoin(entry.price, entry.symbol, entry.decimals)}
                </option>
              ))}
            </select>
          </label>
        )}

        {sellingChainIds.length > 1 && (
          <label className={styles.checkout__field}>
            <span>Pay on</span>
            <select value={chainId ?? ''} onChange={(event) => onChainChange?.(Number(event.target.value))} disabled={isBusy}>
              {sellingChainIds.map((id) => (
                <option key={id} value={id}>
                  {resolveChain(id)?.name ?? id}
                </option>
              ))}
            </select>
          </label>
        )}

        {isGift && (
          <label className={styles.checkout__field}>
            <span>
              <GiftIcon size={13} aria-hidden="true" /> Recipient
            </span>
            <input
              type="text"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              disabled={isBusy}
            />
          </label>
        )}

        {isWrongChain && (
          <div className={styles.checkout__chainWarning}>
            <WarningIcon size={14} />
            <span>Paying on {chainInfo?.name || 'this network'} needs your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.checkout__switchChain}
            >
              Switch
            </button>
          </div>
        )}

        <button type="submit" className={styles.checkout__submit} disabled={isBusy || isWrongChain || !plan || !option}>
          {isApproving
            ? `Approving ${option?.symbol || 'the token'}…`
            : isPending
              ? 'Confirm in your wallet…'
              : isGift
                ? 'Send the gift'
                : 'Pay and activate'}
        </button>

        <p className={styles.checkout__note}>
          Paid from your connected wallet, not a session key.{' '}
          {paysWithToken
            ? `Paying in ${option.symbol || 'a token'} takes two transactions: one to let the contract take the payment, then the payment itself.`
            : 'Overpayment is refunded by the contract in the same transaction.'}
        </p>
      </form>
    </NativeDialog>
  )
})

export default PremiumCheckoutDialog
