'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, parseUnits } from 'viem'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import useStakeToken from '@/hooks/useStakeToken'
import predictAbi from '@/abis/HupPredict.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import styles from './PlaceBetModal.module.scss'

const BET_PRESETS = [1, 2, 5, 10]

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
 * Place Bet Modal
 * Stakes on one outcome of a Hup Predict market. The stake token is fixed by the market
 * (native coin, ERC20, or LSP7); token stakes surface an approve/authorizeOperator step
 * first, exactly like TipModal.
 * @param {Object} props
 * @param {Object} props.market Indexed market row (network_id, market_id, token, is_token_lsp7).
 * @param {number} props.outcomeIndex Zero-based outcome being backed.
 * @param {string} props.outcomeLabel Display label for the outcome.
 * @param {Function} props.onClose Clears the open-modal state on close.
 * @param {Function} props.onPlaced Revalidates the market after a confirmed bet.
 */
const PlaceBetModal = ({ market, outcomeIndex, outcomeLabel, onClose, onPlaced }) => {
  const [amount, setAmount] = useState('1')
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const { address } = useConnection()
  const dialogRef = useRef(null)
  const lastActionRef = useRef(null)

  // Bets settle on the market's own chain, not whichever chain is currently active
  const chainId = Number(market.network_id)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const predictAddress = CONTRACTS[`chain${chainId}`]?.predict || null

  const isLsp7 = Boolean(Number(market.is_token_lsp7))
  const { symbol, decimals, isNative } = useStakeToken(chainId, market.token, isLsp7)
  const tokenAddress = isNative ? null : market.token

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
    args: [address, predictAddress],
    chainId,
    query: { enabled: Boolean(tokenAddress && !isLsp7 && address && predictAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: tokenAddress,
    functionName: 'authorizedAmountFor',
    args: [predictAddress, address],
    chainId,
    query: { enabled: Boolean(tokenAddress && isLsp7 && address && predictAddress) },
  })

  const allowance = isLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isLsp7 ? refetchLsp7Allowance : refetchErc20Allowance
  const needsApproval = Boolean(tokenAddress) && allowance !== undefined && amountUnits !== null && allowance < amountUnits

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming || isBurnerBusy

  // Mount = open / unmount = close, matching the TipModal dialog contract
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
      toast('Token approved — you can place your bet now', 'success')
      refetchAllowance()
    } else {
      toast('Bet placed 🎯', 'success')
      onPlaced?.()
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
        args: [predictAddress, amountUnits, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [predictAddress, amountUnits],
        chainId,
      })
    }
  }

  const handleBet = async (e) => {
    e.stopPropagation()
    if (amountUnits === null || !predictAddress || !address) return

    const args = [address, BigInt(market.market_id), outcomeIndex, amountUnits]

    // Route through the burner session key if one's active — approve stays wagmi-only regardless
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: predictAddress,
          abi: predictAbi,
          functionName: 'placeBet',
          args: isNative ? [...args, { value: amountUnits }] : args,
        })

        toast('Bet placed 🎯', 'success')
        onPlaced?.()
        dialogRef.current?.close()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    lastActionRef.current = 'bet'
    writeContract({
      abi: predictAbi,
      address: predictAddress,
      functionName: 'placeBet',
      args,
      chainId,
      ...(isNative ? { value: amountUnits } : {}),
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.betModal}
      aria-label="Place a bet"
      onClick={(e) => e.stopPropagation()}
      onClose={() => onClose?.()}
    >
      <header className={styles.betModal__header}>
        <button type="button" className={styles.betModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Back &ldquo;{outcomeLabel}&rdquo;</h3>
      </header>

      <main className={styles.betModal__body}>
        <p className={styles.betModal__note}>
          Winnings are parimutuel — if this outcome wins, everyone who backed it splits the whole pot pro-rata.
        </p>

        <div className={styles.betModal__field}>
          <label htmlFor="betModalAmount">Amount</label>
          <div className={styles.betModal__amount}>
            <input
              type="number"
              id="betModalAmount"
              value={amount}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
            <span className={styles.betModal__amountSymbol}>{symbol}</span>
          </div>
          <div className={styles.betModal__presets}>
            {BET_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(styles.betModal__preset, parsedAmount === preset && styles['betModal__preset--active'])}
                onClick={() => setAmount(`${preset}`)}
              >
                {preset} {symbol}
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className={styles.betModal__footer}>
        {!predictAddress && <p className={styles.betModal__hint}>Predict isn&apos;t available on this network yet</p>}
        {needsApproval ? (
          <button type="button" className={styles.betModal__send} onClick={handleApprove} disabled={isBusy || amountUnits === null}>
            {isBusy ? 'Confirming...' : `Approve ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(parsedAmount)} ${symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className={styles.betModal__send}
            onClick={handleBet}
            disabled={isBusy || amountUnits === null || !predictAddress || !address}
          >
            {isBusy
              ? 'Confirming...'
              : isValidAmount
              ? `Bet ${new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(parsedAmount)} ${symbol}`
              : 'Bet'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default PlaceBetModal
