'use client'

import { useState, useEffect, useRef } from 'react'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, isAddress, parseUnits, zeroAddress } from 'viem'
import { useSWRConfig } from 'swr'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { USDC } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import tipperAbi from '@/abis/HupTipper.json'
import { toast } from '@/components/NextToast'
import { getPostStatsKey } from '@/hooks/usePostStats'
import NativeDialog from './ui/NativeDialog'
import Profile from './Profile'
import styles from './TipModal.module.scss'

const TIP_PRESETS = [1, 2, 5, 10]

const LUKSO_CHAIN_IDS = [42, 4201]

// LSP7 Digital Asset (LUKSO) — operator-based equivalents of allowance/approve
const lsp7Abi = [
  {
    type: 'function',
    name: 'authorizedAmountFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenOwner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

/**
 * Tip Modal
 * Sends a tip for a post through HupTipper in the native coin, USDC, or a custom
 * ERC20/LSP7 token. The recipient is resolved onchain from the post's creator.
 * @param {Object} props
 * @param {Object} props.item Core content model with network metadata.
 * @param {Function} props.setShowTipModal Clears the open-modal state on close.
 */
const TipModal = ({ item, setShowTipModal }) => {
  const [amount, setAmount] = useState('1')
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const { address } = useConnection()
  const { mutate: mutateStats } = useSWRConfig()
  const dialogRef = useRef(null)
  const lastActionRef = useRef(null)
  const creator = item.wallet_address

  // Optimistic counter bump — the indexer lands the Tipped event a few seconds after the
  // receipt, so revalidating immediately would race it and snap the counter back
  const bumpTipCount = () => {
    mutateStats(
      getPostStatsKey(item, address),
      (current) => ({ ...(current || item), total_tips: Number((current || item)?.total_tips || 0) + 1 }),
      { revalidate: false },
    )
  }

  // Tips settle on the post's own chain, not whichever chain is currently active
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const tipperAddress = CONTRACTS[`chain${chainId}`]?.tipper || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const usdcConfig = USDC[chainId]
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  const isTokenTip = paymentChoice !== 'native'
  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  // Invalid/incomplete custom addresses resolve to null — every downstream read stays
  // disabled and the send button locked until a real address is pasted
  const tokenAddress =
    paymentChoice === 'usdc' ? usdcConfig?.address || null : isCustomToken && isAddress(customToken) ? customToken : null
  const isLsp7 = paymentChoice === 'custom-lsp7' || Boolean(paymentChoice === 'usdc' && usdcConfig?.lsp7)
  const isSelf = address?.toLowerCase() === creator?.toLowerCase()

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(isTokenTip && tokenAddress) },
  })

  // LSP7 has no symbol() (LSP4 metadata instead) — the read fails there and the
  // generic label below covers it
  const { data: customSymbol } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'symbol',
    chainId,
    query: { enabled: Boolean(isCustomToken && tokenAddress) },
  })
  const symbol = !isTokenTip ? nativeCurrency?.symbol || '' : paymentChoice === 'usdc' ? 'USDC' : customSymbol || 'tokens'
  const decimals = isTokenTip ? tokenDecimals : nativeCurrency?.decimals ?? 18

  const parsedAmount = Number(amount)
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  let amountUnits = null
  if (isValidAmount && decimals !== undefined) {
    try {
      amountUnits = parseUnits(amount, decimals)
    } catch {
      amountUnits = null
    }
  }

  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'allowance',
    args: [address, tipperAddress],
    chainId,
    query: { enabled: Boolean(isTokenTip && !isLsp7 && tokenAddress && address && tipperAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: tokenAddress,
    functionName: 'authorizedAmountFor',
    args: [tipperAddress, address],
    chainId,
    query: { enabled: Boolean(isLsp7 && tokenAddress && address && tipperAddress) },
  })

  const allowance = isLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isLsp7 ? refetchLsp7Allowance : refetchErc20Allowance
  const needsApproval = isTokenTip && allowance !== undefined && amountUnits !== null && allowance < amountUnits

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming || isBurnerBusy

  // Mount = open / unmount = close, matching the NewPost dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — you can send your tip now', 'success')
      refetchAllowance()
    } else {
      toast('Tip sent', 'success')
      bumpTipCount()
      dialogRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprove = (e) => {
    e.stopPropagation()
    if (amountUnits === null || !tokenAddress) return

    lastActionRef.current = 'approve'
    if (isLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: tokenAddress,
        functionName: 'authorizeOperator',
        args: [tipperAddress, amountUnits, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [tipperAddress, amountUnits],
        chainId,
      })
    }
  }

  const handleTip = async (e) => {
    e.stopPropagation()
    if (amountUnits === null || !tipperAddress || (isTokenTip && !tokenAddress)) return

    // The recipient is resolved onchain by HupTipper from the post's creator — the client
    // only commits the post id, amount, and token
    const args = [address, BigInt(item.id), amountUnits, tokenAddress ?? zeroAddress, isLsp7, '0x']

    // Route through the burner session key if one's active — same convenience BuyButton gets,
    // skipping the wallet popup. Approve/authorizeOperator stays wagmi-only regardless.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: tipperAddress,
          abi: tipperAbi,
          functionName: 'tip',
          args: isTokenTip ? args : [...args, { value: amountUnits }],
        })

        toast('Tip sent', 'success')
        bumpTipCount()
        dialogRef.current?.close()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    lastActionRef.current = 'tip'
    writeContract({
      abi: tipperAbi,
      address: tipperAddress,
      functionName: 'tip',
      args,
      chainId,
      ...(isTokenTip ? {} : { value: amountUnits }),
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.tipModal}
      aria-label="Support creator"
      onClick={(e) => e.stopPropagation()}
      onClose={() => setShowTipModal()}
    >
      <header className={styles.tipModal__header}>
        <button type="button" className={styles.tipModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Support creator</h3>
      </header>

      <main className={styles.tipModal__body}>
        <div className={styles.tipModal__recipient}>
          <Profile variant="fullWithoutTime" creator={creator} networkId={item.network_id} />
          <p className={styles.tipModal__recipientNote}>
            {isSelf ? `This is your own post` : `Your tip goes directly to the creator's wallet`}
          </p>
        </div>

        <div className={styles.tipModal__field}>
          <label htmlFor="tipModalToken">Token</label>
          <select id="tipModalToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
            {usdcConfig?.address && <option value="usdc">USDC</option>}
            <option value="custom-erc20">Custom ERC20</option>
            {isLukso && <option value="custom-lsp7">Custom LSP7</option>}
          </select>
        </div>

        {isCustomToken && (
          <div className={styles.tipModal__field}>
            <label htmlFor="tipModalCustomToken">Token address</label>
            <input
              type="text"
              id="tipModalCustomToken"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value.trim())}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className={styles.tipModal__field}>
          <label htmlFor="tipModalAmount">Amount</label>
          <div className={styles.tipModal__amount}>
            <input
              type="number"
              id="tipModalAmount"
              value={amount}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
            <span className={styles.tipModal__amountSymbol}>{symbol}</span>
          </div>
          <div className={styles.tipModal__presets}>
            {TIP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(styles.tipModal__preset, parsedAmount === preset && styles['tipModal__preset--active'])}
                onClick={() => setAmount(`${preset}`)}
              >
                {preset} {symbol}
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className={styles.tipModal__footer}>
        {!tipperAddress && <p className={styles.tipModal__hint}>Tipping isn&apos;t available on this network yet</p>}
        {needsApproval ? (
          <button type="button" className={styles.tipModal__send} onClick={handleApprove} disabled={isBusy || amountUnits === null}>
            {isBusy ? 'Confirming...' : `Approve ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(parsedAmount)} ${symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className={styles.tipModal__send}
            onClick={handleTip}
            disabled={isBusy || amountUnits === null || isSelf || !tipperAddress}
          >
            {isBusy
              ? 'Confirming...'
              : isValidAmount
              ? `Send ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(parsedAmount)} ${symbol}`
              : `Send`}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default TipModal
