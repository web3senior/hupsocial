'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import { canReclaim, categoryLabel, formatTokenAmount, slotsLeft, taskStatus, toRelative } from '@/lib/task'
import { taskDetailKey } from '@/lib/taskTracking'
import { requestTaskFunding } from '@/lib/taskFundingBus'
import { networkColorStyle } from '@/lib/networkColors'
import ProgressBar from '@/components/ui/ProgressBar'
import StatusBadge from '@/components/ui/StatusBadge'
import TaskReviewDialog from '@/components/TaskReviewDialog'
import { CheckCircleIcon, LockSimpleIcon, PaperPlaneTiltIcon, ToolboxIcon } from '@phosphor-icons/react'
import styles from './TaskCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * The task a post carries. The content only promises terms (content.hupTask); the funded task is
 * read from the index, so the money, the slots and the clock are always the chain's.
 * @param {Object} props
 * @param {Object} props.taskRef The post's content.hupTask.
 * @param {number} props.networkId
 * @param {string|number} props.postId
 * @param {string} props.author The post's author.
 * @param {Function} [props.onSubmit] Opens the reply composer on this post.
 */
export default function TaskCard({ taskRef, networkId, postId, author, onSubmit }) {
  const chainId = Number(networkId)
  const { address } = useConnection()
  const [reviewing, setReviewing] = useState(false)
  const { data } = useSWR(chainId && postId ? taskDetailKey(chainId, postId) : null, fetcher)
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])

  const task = data?.data?.task ?? null
  const submissions = data?.data?.submissions ?? []
  const viewer = address?.toLowerCase()
  const isPoster = Boolean(viewer && viewer === String(task?.wallet_address || author || '').toLowerCase())
  const status = taskStatus(task)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  if (task && Number(task.hidden) === 1) {
    return <p className={styles.taskCard__hidden}>This task was hidden by a moderator. Its escrow is untouched.</p>
  }

  const symbol = task?.token_symbol || taskRef?.symbol || nativeSymbol
  const paid = Number(task?.paid_slots || 0)
  const slots = Number(task?.slots || taskRef?.slots || 0)
  const entries = submissions.filter((row) => !row.is_poster)
  const viewerPaid = entries.filter((row) => row.payout && row.wallet_address?.toLowerCase() === viewer)
  const rewardLabel = task ? formatTokenAmount(task.reward_per_slot, task.token_decimals, symbol) : `${taskRef?.reward ?? '?'} ${symbol}`

  return (
    <section className={styles.taskCard} style={networkColorStyle(chainInfo)} onClick={(e) => e.stopPropagation()}>
      <div className={styles.taskCard__head}>
        <span className={styles.taskCard__kind}>
          <ToolboxIcon size={15} weight="fill" />
          {categoryLabel(task?.category || taskRef?.category)} task
          {(task ? Number(task.is_sealed) === 1 : taskRef?.sealed) && (
            <span className={styles.taskCard__sealed} data-tooltip="Replies are sealed to the poster until approved">
              <LockSimpleIcon size={12} weight="bold" /> Sealed
            </span>
          )}
        </span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <div className={styles.taskCard__amounts}>
        <span className={styles.taskCard__reward}>{rewardLabel}</span>
        <span className={styles.taskCard__per}>per approved reply · {slots} {slots === 1 ? 'slot' : 'slots'}</span>
      </div>

      {task && (
        <ProgressBar
          className={styles.taskCard__bar}
          percent={slots > 0 ? (paid / slots) * 100 : 0}
          height={6}
          gradient={false}
          color="var(--network-color-primary, #ec4899)"
          ariaLabel={`${paid} of ${slots} slots paid`}
          label={<span className={styles.taskCard__meta}>{paid} paid · {slotsLeft(task)} left</span>}
          hint={
            <span className={styles.taskCard__meta}>
              {status.key === 'open' ? `closes ${toRelative(task.deadline)}` : status.key === 'reviewing' ? `closed ${toRelative(task.deadline)}` : status.label}
            </span>
          }
        />
      )}

      <div className={styles.taskCard__foot}>
        <span className={styles.taskCard__meta}>
          {entries.length} {entries.length === 1 ? 'reply' : 'replies'}
        </span>

        {!task && isPoster && (
          <button
            type="button"
            className={styles.taskCard__action}
            onClick={() => requestTaskFunding({ networkId: chainId, postId, terms: taskRef })}
          >
            Fund task
          </button>
        )}

        {!task && !isPoster && <span className={styles.taskCard__meta}>Not funded yet</span>}

        {task && isPoster && (
          <button type="button" className={styles.taskCard__action} onClick={() => setReviewing(true)}>
            {canReclaim(task) && entries.every((row) => row.payout) ? 'Manage' : `Review ${entries.length > 0 ? entries.length : ''}`.trim()}
          </button>
        )}

        {task && !isPoster && status.key === 'open' && onSubmit && (
          <button type="button" className={styles.taskCard__action} onClick={onSubmit}>
            <PaperPlaneTiltIcon size={14} weight="fill" />
            Submit
          </button>
        )}
      </div>

      {viewerPaid.length > 0 && (
        <p className={styles.taskCard__yours}>
          <CheckCircleIcon size={13} weight="fill" />
          You were paid for {viewerPaid.length === 1 ? 'your reply' : `${viewerPaid.length} replies`}
        </p>
      )}

      {reviewing && task && <TaskReviewDialog task={task} submissions={submissions} onClose={() => setReviewing(false)} />}
    </section>
  )
}
