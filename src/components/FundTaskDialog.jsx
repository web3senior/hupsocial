'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { erc20Abi } from 'viem'
import { useConnection, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { categoryLabel, formatTokenAmount, isNativeToken, lsp7OperatorAbi, normalizeCategory, parseTokenAmount, ZERO_ADDRESS } from '@/lib/task'
import { unlockTaskIdentity } from '@/lib/taskVault'
import { trackTaskTx } from '@/lib/taskTracking'
import { networkColorStyle } from '@/lib/networkColors'
import { shortTxError } from '@/lib/utils'
import tasksAbi from '@/abis/HupTasks.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import { LockSimpleIcon, WarningIcon } from '@phosphor-icons/react'
import styles from './FundTaskDialog.module.scss'

const durationFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

/**
 * Funds the task a post promised: escrows slots x reward on HupTasks from the connected wallet.
 * The terms come from the post's content.hupTask; the chain decides decimals and the fee.
 * Value never goes through a session key, so this always signs with the wallet itself.
 * @param {Object} props
 * @param {number} props.networkId
 * @param {string|number} props.postId
 * @param {Object} props.terms The post's content.hupTask.
 * @param {Function} props.onClose
 */
export default function FundTaskDialog({ networkId, postId, terms, onClose }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { writeContractAsync } = useWriteContract()
  const [step, setStep] = useState('idle')

  const chainId = Number(networkId)
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const tasksAddress = CONTRACTS[`chain${chainId}`]?.tasks || null
  const token = isNativeToken(terms?.token) ? ZERO_ADDRESS : terms.token
  const native = token === ZERO_ADDRESS
  const isLsp7 = !native && Boolean(terms?.lsp7)
  const symbol = native ? (chainInfo?.nativeCurrency?.symbol ?? 'ETH') : terms?.symbol || 'tokens'
  const slots = Number.parseInt(terms?.slots, 10) || 0
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: native ? undefined : token,
    functionName: 'decimals',
    chainId,
    query: { enabled: !native },
  })
  const decimals = native ? (chainInfo?.nativeCurrency?.decimals ?? 18) : tokenDecimals

  const { data: feeBps } = useReadContract({
    abi: tasksAbi,
    address: tasksAddress ?? undefined,
    functionName: 'taskFeeBps',
    chainId,
    query: { enabled: Boolean(tasksAddress) },
  })

  const reward = decimals !== undefined ? parseTokenAmount(terms?.reward, decimals) : null
  const feePerSlot = reward && feeBps !== undefined ? (reward * BigInt(feeBps)) / 10000n : 0n
  const escrow = reward ? BigInt(slots) * (reward + feePerSlot) : null

  const { data: erc20Allowance, refetch: refetchErc20 } = useReadContract({
    abi: erc20Abi,
    address: native || isLsp7 ? undefined : token,
    functionName: 'allowance',
    args: address && tasksAddress ? [address, tasksAddress] : undefined,
    chainId,
    query: { enabled: !native && !isLsp7 && Boolean(address && tasksAddress) },
  })
  const { data: lsp7Allowance, refetch: refetchLsp7 } = useReadContract({
    abi: lsp7OperatorAbi,
    address: isLsp7 ? token : undefined,
    functionName: 'authorizedAmountFor',
    args: address && tasksAddress ? [tasksAddress, address] : undefined,
    chainId,
    query: { enabled: isLsp7 && Boolean(address && tasksAddress) },
  })
  const allowance = isLsp7 ? lsp7Allowance : erc20Allowance
  const needsApproval = !native && escrow !== null && (allowance === undefined || allowance < escrow)
  const busy = step !== 'idle'

  const close = () => dialogRef.current?.close()

  const handleApprove = async () => {
    if (!escrow || !tasksAddress || busy) return
    setStep('approving')
    try {
      const hash = isLsp7
        ? await writeContractAsync({ abi: lsp7OperatorAbi, address: token, functionName: 'authorizeOperator', args: [tasksAddress, escrow, '0x'], chainId })
        : await writeContractAsync({ abi: erc20Abi, address: token, functionName: 'approve', args: [tasksAddress, escrow], chainId })
      const receipt = await waitForTransactionReceipt(config, { chainId, hash })
      if (receipt.status !== 'success') throw new Error('The approval was rejected onchain')
      await (isLsp7 ? refetchLsp7() : refetchErc20())
    } catch (err) {
      toast(shortTxError(err, 'Approval failed'), 'error')
    } finally {
      setStep('idle')
    }
  }

  const handleFund = async () => {
    if (!escrow || !tasksAddress || busy || needsApproval) return
    setStep('funding')
    try {
      let pubKey = '0x'
      if (terms?.sealed) {
        const identity = await unlockTaskIdentity('Creating the key sealed replies are encrypted to')
        pubKey = identity.pubKeyHex
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(terms.duration))
      const hash = await writeContractAsync({
        abi: tasksAbi,
        address: tasksAddress,
        functionName: 'postTask',
        args: [BigInt(postId), normalizeCategory(terms.category), token, isLsp7, reward, slots, deadline, pubKey],
        chainId,
        value: native ? escrow : 0n,
      })

      trackTaskTx({
        chainId,
        postId,
        hash,
        pending: `Funding your task with ${formatTokenAmount(escrow, decimals, symbol)}…`,
        success: 'Your task is funded and open for replies',
        failure: 'Funding was rejected onchain — nothing was sent.',
      })
      close()
    } catch (err) {
      toast(err?.code === 4001 ? 'Funding cancelled' : shortTxError(err, 'Funding failed'), 'error')
    } finally {
      setStep('idle')
    }
  }

  const days = Math.round(Number(terms?.duration || 0) / 86400)

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.fundTask}
      aria-label="Fund your task"
      style={networkColorStyle(chainInfo)}
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
      onCancel={(e) => {
        e.stopPropagation()
        if (busy) e.preventDefault()
      }}
    >
      <header className={styles.fundTask__header}>
        <button type="button" className={styles.fundTask__cancel} onClick={close}>
          Later
        </button>
        <h3>Fund your task</h3>
      </header>

      <main className={styles.fundTask__body}>
        <p className={styles.fundTask__lead}>
          Your post is live. Funding escrows the reward onchain, which is what opens the task to replies.
        </p>

        <dl className={styles.fundTask__terms}>
          <div>
            <dt>Work</dt>
            <dd>{categoryLabel(terms?.category)}</dd>
          </div>
          <div>
            <dt>Reward</dt>
            <dd>
              {terms?.reward} {symbol} × {slots}
            </dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{days > 0 ? durationFormatter.format(days, 'day') : '—'}</dd>
          </div>
          {terms?.sealed && (
            <div>
              <dt>Replies</dt>
              <dd className={styles.fundTask__sealed}>
                <LockSimpleIcon size={13} /> Sealed to you
              </dd>
            </div>
          )}
        </dl>

        {isWrongChain && (
          <div className={styles.fundTask__chainWarning}>
            <WarningIcon size={14} />
            <span>This task lives on {chainInfo?.name || 'another network'}.</span>
            <button type="button" onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
              {switchChain.isPending ? 'Switching…' : 'Switch'}
            </button>
          </div>
        )}

        <p className={styles.fundTask__total}>
          {escrow !== null ? `Escrow ${formatTokenAmount(escrow, decimals, symbol)}` : 'Reading the token…'}
          {feeBps !== undefined && Number(feeBps) > 0 && <small> includes a {Number(feeBps) / 100}% fee on top of each reward</small>}
        </p>

        {!tasksAddress && <p className={styles.fundTask__lead}>Tasks aren&apos;t live on this network yet.</p>}
      </main>

      <footer className={styles.fundTask__footer}>
        {needsApproval ? (
          <button type="button" className={styles.fundTask__submit} onClick={handleApprove} disabled={busy || isWrongChain || !escrow}>
            {step === 'approving' ? 'Approving…' : `Allow ${symbol}`}
          </button>
        ) : (
          <button type="button" className={styles.fundTask__submit} onClick={handleFund} disabled={busy || isWrongChain || !escrow || !tasksAddress || !address}>
            {step === 'funding' ? 'Confirm in your wallet…' : 'Fund task'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}
