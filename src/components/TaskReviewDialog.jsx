'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useConnection, useSwitchChain, useWriteContract } from 'wagmi'
import { config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import {
  DEFAULT_RATING,
  MAX_APPROVAL_BATCH,
  MAX_TASK_DURATION_SECONDS,
  canReclaim,
  escrowRemaining,
  formatTokenAmount,
  slotsLeft,
  submissionStatus,
  taskStatus,
  toRelative,
} from '@/lib/task'
import StatusBadge from './ui/StatusBadge'
import { openSubmission, submissionKeyHex, unlockTaskIdentity } from '@/lib/taskVault'
import { trackTaskTx } from '@/lib/taskTracking'
import { networkColorStyle } from '@/lib/networkColors'
import { renderMarkdown } from '@/lib/markdown'
import { shortTxError } from '@/lib/utils'
import tasksAbi from '@/abis/HupTasks.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import Profile from './Profile'
import MediaGallery from './Gallery'
import { LockSimpleOpenIcon, RobotIcon, WarningIcon } from '@phosphor-icons/react'
import styles from './TaskReviewDialog.module.scss'

const EXTEND_SECONDS = 7 * 24 * 3600

/**
 * The poster's side of a task: read submissions (opening sealed ones with the task key), pick
 * the ones to pay, rate agents, and close the task when done.
 * @param {Object} props
 * @param {Object} props.task Indexed task row.
 * @param {Array} props.submissions Rows from the task detail API.
 * @param {Function} props.onClose
 */
export default function TaskReviewDialog({ task, submissions, onClose }) {
  const dialogRef = useRef(null)
  const { chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { writeContractAsync } = useWriteContract()

  const chainId = Number(task.network_id)
  const postId = String(task.post_id)
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const isSealed = Number(task.is_sealed) === 1
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)
  const entries = useMemo(() => submissions.filter((row) => !row.is_poster), [submissions])
  const unpaid = entries.filter((row) => !row.payout)
  const left = slotsLeft(task)

  const [selected, setSelected] = useState(() => new Set())
  const [ratings, setRatings] = useState({})
  const [opened, setOpened] = useState({})
  const [identity, setIdentity] = useState(null)
  const [reveal, setReveal] = useState(true)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const close = () => dialogRef.current?.close()
  const symbol = task.token_symbol || chainInfo?.nativeCurrency?.symbol || ''
  const rewardLabel = formatTokenAmount(task.reward_per_slot, task.token_decimals, symbol)

  const toggle = (replyId) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(replyId)) next.delete(replyId)
      else if (next.size < Math.min(left, MAX_APPROVAL_BATCH)) next.add(replyId)
      else toast(`You can pay ${Math.min(left, MAX_APPROVAL_BATCH)} at a time`, 'info')
      return next
    })
  }

  const openSealed = async () => {
    try {
      const id = identity ?? (await unlockTaskIdentity('Opening the sealed replies to your task'))
      setIdentity(id)
      const results = {}
      for (const row of entries) {
        if (!row.sealed) continue
        try {
          results[row.reply_id] = await openSubmission(row.sealed, id.privKeyHex)
        } catch {
          results[row.reply_id] = { error: true }
        }
      }
      setOpened(results)
    } catch (err) {
      toast(err?.code === 4001 ? 'Unlock cancelled' : err.message || 'Could not open the sealed replies', 'error')
    }
  }

  const send = async (label, request, copy) => {
    if (busy) return
    setBusy(label)
    try {
      const hash = await writeContractAsync({ abi: tasksAbi, address: task.contract_address, chainId, ...request })
      trackTaskTx({ chainId, postId, hash, ...copy })
      close()
    } catch (err) {
      toast(err?.code === 4001 ? 'Cancelled' : shortTxError(err, 'Transaction failed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleApprove = async () => {
    const picked = unpaid.filter((row) => selected.has(row.reply_id))
    if (picked.length === 0) return

    let id = identity
    if (isSealed && reveal && picked.some((row) => row.sealed) && !id) {
      try {
        id = await unlockTaskIdentity('Publishing the work you approve')
        setIdentity(id)
      } catch {
        toast('Unlock your vault to publish sealed work, or untick publishing', 'error')
        return
      }
    }

    const approvals = picked.map((row) => {
      const rating = row.agent_id ? Number(ratings[row.reply_id] ?? DEFAULT_RATING) : 0
      let revealKey = '0x'
      if (isSealed && reveal && row.sealed && id) {
        try {
          revealKey = submissionKeyHex(row.sealed, id.privKeyHex)
        } catch {
          revealKey = '0x'
        }
      }
      return { replyId: BigInt(row.reply_id), agentId: BigInt(row.agent_id ?? 0), rating, revealKey }
    })

    const total = formatTokenAmount(BigInt(task.reward_per_slot) * BigInt(approvals.length), task.token_decimals, symbol)
    await send('approve', { functionName: 'approve', args: [BigInt(postId), approvals] }, {
      pending: `Paying ${approvals.length} ${approvals.length === 1 ? 'reply' : 'replies'} ${total}…`,
      success: `Paid ${total}`,
      failure: 'The payment was rejected onchain — nothing moved.',
    })
  }

  const handleReclaim = () =>
    send('reclaim', { functionName: 'reclaim', args: [BigInt(postId)] }, {
      pending: 'Closing your task…',
      success: `Task closed — ${formatTokenAmount(escrowRemaining(task), task.token_decimals, symbol)} is back in your wallet`,
      failure: 'Closing was rejected onchain.',
    })

  const handleCancel = () =>
    send('cancel', { functionName: 'cancel', args: [BigInt(postId)] }, {
      pending: 'Cancelling your task…',
      success: 'Task cancelled and refunded',
      failure: 'Cancelling was rejected onchain — someone may have replied already.',
    })

  const handleExtend = () =>
    send('extend', { functionName: 'extendDeadline', args: [BigInt(postId), BigInt(Number(task.deadline) + EXTEND_SECONDS)] }, {
      pending: 'Extending the deadline…',
      success: 'Deadline extended by a week',
      failure: 'Extending was rejected onchain.',
    })

  const hasSealed = entries.some((row) => row.sealed)
  const canCancel = entries.length === 0 && Number(task.paid_slots) === 0
  const canExtend = !task.closed_reason && Number(task.deadline) + EXTEND_SECONDS <= Number(task.posted_at) + MAX_TASK_DURATION_SECONDS

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.review}
      aria-label="Review task replies"
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
      <header className={styles.review__header}>
        <button type="button" className={styles.review__cancel} onClick={close}>
          Close
        </button>
        <h3>Review replies</h3>
      </header>

      <main className={styles.review__body}>
        <p className={styles.review__lead}>
          <StatusBadge tone={taskStatus(task).tone}>{taskStatus(task).label}</StatusBadge> {rewardLabel} per approved reply · {task.paid_slots}/{task.slots} paid · {left} left ·{' '}
          {Number(task.deadline) > Date.now() / 1000 ? `closes ${toRelative(task.deadline)}` : `closed ${toRelative(task.deadline)}`}
        </p>

        {isWrongChain && (
          <div className={styles.review__chainWarning}>
            <WarningIcon size={14} />
            <span>This task lives on {chainInfo?.name || 'another network'}.</span>
            <button type="button" onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
              {switchChain.isPending ? 'Switching…' : 'Switch'}
            </button>
          </div>
        )}

        {hasSealed && Object.keys(opened).length === 0 && (
          <button type="button" className={styles.review__unseal} onClick={openSealed}>
            <LockSimpleOpenIcon size={16} />
            Open sealed replies
          </button>
        )}

        {entries.length === 0 && <p className={styles.review__empty}>No replies yet. Anyone who replies to your post shows up here.</p>}

        <ul className={styles.review__list}>
          {entries.map((row) => {
            const decrypted = opened[row.reply_id]
            const text = row.sealed ? (decrypted?.error ? 'This reply could not be opened with your key.' : decrypted?.elements?.[0]?.data?.text) : row.text
            const media = row.sealed ? decrypted?.elements?.[1]?.data?.items ?? [] : row.media
            const isPaid = Boolean(row.payout)
            return (
              <li key={row.reply_id} className={clsx(styles.review__item, selected.has(row.reply_id) && styles['review__item--selected'])}>
                <div className={styles.review__itemHead}>
                  <Profile variant="fullWithoutTime" creator={row.wallet_address} networkId={chainId} />
                  <span className={styles.review__itemBadges}>
                    {row.agent_id && (
                      <span className={styles.review__agent} data-tooltip="Verified ERC-8004 agent on this chain">
                        <RobotIcon size={12} weight="fill" /> #{row.agent_id}
                      </span>
                    )}
                    <StatusBadge tone={submissionStatus(row.payout).tone}>{submissionStatus(row.payout).label}</StatusBadge>
                  </span>
                </div>

                {row.sealed && !decrypted ? (
                  <p className={styles.review__sealed}>Sealed. Open sealed replies to read it.</p>
                ) : (
                  <div className={styles.review__text} dangerouslySetInnerHTML={{ __html: renderMarkdown(text || '') }} />
                )}
                {media?.length > 0 && <MediaGallery data={media} />}

                <div className={styles.review__itemFoot}>
                  {isPaid ? (
                    <span className={styles.review__paid}>
                      Paid {rewardLabel}
                      {Number(row.payout.rating) > 0 && ` · rated ${row.payout.rating}`}
                    </span>
                  ) : (
                    <>
                      <label className={styles.review__pick}>
                        <input type="checkbox" checked={selected.has(row.reply_id)} onChange={() => toggle(row.reply_id)} disabled={left === 0} />
                        Pay {rewardLabel}
                      </label>
                      {row.agent_id && selected.has(row.reply_id) && (
                        <label className={styles.review__rating}>
                          Rate
                          <input
                            type="range"
                            min={1}
                            max={100}
                            value={ratings[row.reply_id] ?? DEFAULT_RATING}
                            onChange={(e) => setRatings((current) => ({ ...current, [row.reply_id]: Number(e.target.value) }))}
                          />
                          <output>{ratings[row.reply_id] ?? DEFAULT_RATING}</output>
                        </label>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {isSealed && unpaid.length > 0 && (
          <label className={styles.review__revealToggle}>
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
            Publish the work I pay for, so anyone can read it
          </label>
        )}
      </main>

      <footer className={styles.review__footer}>
        <div className={styles.review__manage}>
          {canCancel && (
            <button type="button" onClick={handleCancel} disabled={Boolean(busy) || isWrongChain}>
              Cancel and refund
            </button>
          )}
          {canReclaim(task) && (
            <button type="button" onClick={handleReclaim} disabled={Boolean(busy) || isWrongChain}>
              {left > 0 ? `Close and take back ${formatTokenAmount(escrowRemaining(task), task.token_decimals, symbol)}` : 'Close task'}
            </button>
          )}
          {canExtend && (
            <button type="button" onClick={handleExtend} disabled={Boolean(busy) || isWrongChain}>
              Extend a week
            </button>
          )}
        </div>
        <button
          type="button"
          className={styles.review__submit}
          onClick={handleApprove}
          disabled={selected.size === 0 || Boolean(busy) || isWrongChain}
        >
          {busy === 'approve' ? 'Confirm in your wallet…' : selected.size > 0 ? `Pay ${selected.size}` : 'Select replies to pay'}
        </button>
      </footer>
    </NativeDialog>
  )
}
