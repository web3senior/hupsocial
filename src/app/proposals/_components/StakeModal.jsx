'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { formatUnits, parseUnits } from 'viem'
import { useReadContracts } from 'wagmi'
import { daoAddressFor } from '@/lib/dao'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import { XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

const tokenAbi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
]

// LSP7 has no allowance: the DAO pulls as an authorized operator
const lsp7Abi = [
  {
    name: 'authorizedAmountFor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'tokenOwner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'authorizeOperator',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'operatorNotificationData', type: 'bytes' }],
    outputs: [],
  },
]

/**
 * Stake / Unstake
 * Locks the DAO's token for voting power, or takes it back. Staking is two steps the first
 * time: an ERC20 approval (or LSP7 operator authorization), then the stake itself.
 * @param {Object} props
 * @param {number} props.chainId
 * @param {Object} props.dao Onchain DAO record.
 * @param {{symbol: string, decimals: number|null}} props.token
 * @param {bigint} props.staked The viewer's current stake.
 * @param {Function} props.onDone Called after a confirmed stake or unstake.
 */
const StakeModal = forwardRef(function StakeModal({ chainId, dao, token, staked = 0n, onDone }, ref) {
  const dialogRef = useRef(null)
  const [tab, setTab] = useState('stake')
  const [amount, setAmount] = useState('')
  const { send, busy, account } = useDaoWrite(chainId)
  const daoAddress = daoAddressFor(chainId)
  const decimals = token?.decimals ?? 18
  const symbol = token?.symbol || 'tokens'

  const { data: reads, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: dao?.token, abi: tokenAbi, functionName: 'balanceOf', args: [account], chainId },
      dao?.isLsp7
        ? { address: dao?.token, abi: lsp7Abi, functionName: 'authorizedAmountFor', args: [daoAddress, account], chainId }
        : { address: dao?.token, abi: tokenAbi, functionName: 'allowance', args: [account, daoAddress], chainId },
    ],
    query: { enabled: Boolean(dao?.token && account && daoAddress) },
  })
  const balance = reads?.[0]?.status === 'success' ? reads[0].result : 0n
  const allowance = reads?.[1]?.status === 'success' ? reads[1].result : 0n

  useImperativeHandle(ref, () => ({
    open: (initialTab = 'stake') => {
      setTab(initialTab)
      setAmount('')
      refetch()
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  let parsed = 0n
  try {
    parsed = amount ? parseUnits(amount, decimals) : 0n
  } catch {
    parsed = -1n
  }
  const max = tab === 'stake' ? balance : staked
  const invalid = parsed <= 0n || parsed > max
  const needsApproval = tab === 'stake' && parsed > 0n && allowance < parsed
  const isBusy = Boolean(busy)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (invalid) {
      toast(parsed > max ? 'That is more than you have' : 'Enter an amount', 'error')
      return
    }

    if (tab === 'unstake') {
      const receipt = await send(
        'unstake',
        { functionName: 'unstake', args: [dao.id, parsed] },
        { success: `Unlocked ${amount} ${symbol}`, failure: 'Unlock failed' },
      )
      if (receipt) {
        dialogRef.current?.close()
        onDone?.()
      }
      return
    }

    if (needsApproval) {
      const approved = dao.isLsp7
        ? await send(
            'approve',
            { address: dao.token, abi: lsp7Abi, functionName: 'authorizeOperator', args: [daoAddress, parsed, '0x'] },
            { success: 'Tokens approved', failure: 'Approval failed' },
          )
        : await send(
            'approve',
            { address: dao.token, abi: tokenAbi, functionName: 'approve', args: [daoAddress, parsed] },
            { success: 'Approved', failure: 'Approval failed' },
          )
      if (!approved) return
      await refetch()
    }

    const receipt = await send(
      'stake',
      { functionName: 'stake', args: [dao.id, parsed] },
      { success: `Locked ${amount} ${symbol}`, failure: 'Lock failed' },
    )
    if (receipt) {
      dialogRef.current?.close()
      onDone?.()
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="Lock tokens"
      lightDismiss={!isBusy}
      onCancel={(event) => {
        if (isBusy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>Lock tokens to vote</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.daoDialog__tabs} role="tablist">
          {['stake', 'unstake'].map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={clsx(styles.daoDialog__tab, tab === key && styles['daoDialog__tab--active'])}
              onClick={() => setTab(key)}
              disabled={isBusy}
            >
              {key === 'stake' ? 'Lock' : 'Unlock'}
            </button>
          ))}
        </div>

        <p className={styles.daoDialog__intro}>
          {tab === 'stake'
            ? 'Locked tokens become votes on proposals posted after this. You can unlock them any time.'
            : 'Votes you already cast still count. Unlocked tokens won’t count on new proposals.'}
        </p>

        <form onSubmit={handleSubmit} className={styles.daoDialog__form}>
          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Amount ({symbol})</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.0"
              disabled={isBusy}
            />
            <span className={styles.daoDialog__hint}>
              {tab === 'stake' ? 'In your wallet' : 'Locked'}: {formatUnits(max, decimals)} {symbol}{' '}
              <button type="button" className={styles.daoDialog__linkButton} onClick={() => setAmount(formatUnits(max, decimals))} disabled={isBusy}>
                Max
              </button>
            </span>
          </label>

          <button type="submit" className={styles.daoDialog__submit} disabled={isBusy || invalid}>
            {isBusy && <Spinner size={16} color="currentColor" />}
            {busy === 'approve'
              ? 'Approving…'
              : busy === 'stake'
                ? 'Locking…'
                : busy === 'unstake'
                  ? 'Unlocking…'
                  : tab === 'unstake'
                    ? 'Unlock'
                    : needsApproval
                      ? 'Approve and lock'
                      : 'Lock'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default StakeModal
