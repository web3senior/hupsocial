'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { MAX_TASK_SLOTS, TASK_CATEGORIES, TASK_DURATIONS, paymentOptionsFor } from '@/lib/task'
import { LockSimpleIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachTaskDialog.module.scss'

const SLOT_PRESETS = [1, 3, 5, 10]
const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 })

/**
 * The composer's Task button. Collects the terms a post will promise; nothing is sent onchain
 * here. The post publishes first, then the poster funds the task on it (see FundTaskDialog).
 * @param {Object} props
 * @param {number|null} props.chainId Chain the post will land on.
 * @param {Function} props.onAttach Called with the terms object stored as content.hupTask.
 */
const AttachTaskDialog = forwardRef(function AttachTaskDialog({ chainId, onAttach }, ref) {
  const dialogRef = useRef(null)
  const chain = appChains.find((entry) => entry.id === Number(chainId))
  const tasksAddress = CONTRACTS[`chain${Number(chainId)}`]?.tasks || ''
  const options = useMemo(() => paymentOptionsFor(chainId), [chainId])

  const [category, setCategory] = useState(TASK_CATEGORIES[0].slug)
  const [tokenAddress, setTokenAddress] = useState(options[0]?.address)
  const [reward, setReward] = useState('')
  const [slots, setSlots] = useState('1')
  const [duration, setDuration] = useState(TASK_DURATIONS[2].seconds)
  const [sealed, setSealed] = useState(false)

  const token = options.find((option) => option.address === tokenAddress) ?? options[0]
  const rewardNumber = Number(reward)
  const slotCount = Number.parseInt(slots, 10)
  const validReward = Number.isFinite(rewardNumber) && rewardNumber > 0
  const validSlots = Number.isInteger(slotCount) && slotCount >= 1 && slotCount <= MAX_TASK_SLOTS
  const canAttach = Boolean(tasksAddress) && validReward && validSlots

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canAttach) return
    onAttach?.({
      chainId: Number(chainId),
      category,
      token: token.address,
      symbol: token.symbol,
      lsp7: Boolean(token.lsp7),
      reward: String(reward).trim(),
      slots: slotCount,
      duration,
      sealed,
    })
    dialogRef.current?.close()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachTask}
      aria-label="Add a task"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <form className={styles.attachTask__body} onSubmit={handleSubmit}>
        <header className={styles.attachTask__header}>
          <h3>Add a task</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.attachTask__close}>
            <XIcon size={18} />
          </button>
        </header>

        {!tasksAddress && <p className={styles.attachTask__notice}>Tasks aren&apos;t live on {chain?.name || 'this network'} yet.</p>}

        <p className={styles.attachTask__lead}>
          Your post becomes the brief. Anyone, agent or human, answers by replying, and you pay each reply you approve.
        </p>

        <fieldset className={styles.attachTask__field}>
          <legend>Kind of work</legend>
          <div className={styles.attachTask__chips}>
            {TASK_CATEGORIES.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                className={clsx(styles.attachTask__chip, category === entry.slug && styles['attachTask__chip--active'])}
                onClick={() => setCategory(entry.slug)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className={styles.attachTask__field}>
          <label htmlFor="taskReward">Reward per approved reply</label>
          <div className={styles.attachTask__amount}>
            <input
              id="taskReward"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder="0"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
            <select value={token?.address} onChange={(e) => setTokenAddress(e.target.value)} aria-label="Payment token">
              {options.map((option) => (
                <option key={option.address} value={option.address}>
                  {option.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className={styles.attachTask__field}>
          <legend>How many replies you will pay</legend>
          <div className={styles.attachTask__chips}>
            {SLOT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(styles.attachTask__chip, slotCount === preset && styles['attachTask__chip--active'])}
                onClick={() => setSlots(String(preset))}
              >
                {preset}
              </button>
            ))}
            <input
              className={styles.attachTask__slots}
              type="number"
              min={1}
              max={MAX_TASK_SLOTS}
              step={1}
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              aria-label="Slots"
            />
          </div>
        </fieldset>

        <fieldset className={styles.attachTask__field}>
          <legend>Open for</legend>
          <div className={styles.attachTask__chips}>
            {TASK_DURATIONS.map((entry) => (
              <button
                key={entry.seconds}
                type="button"
                className={clsx(styles.attachTask__chip, duration === entry.seconds && styles['attachTask__chip--active'])}
                onClick={() => setDuration(entry.seconds)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className={styles.attachTask__toggle}>
          <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} />
          <LockSimpleIcon size={16} />
          <span>
            <strong>Sealed replies</strong>
            <small>Only you can read submissions until you approve them, so nobody copies the first good answer.</small>
          </span>
        </label>

        <p className={styles.attachTask__summary}>
          {validReward && validSlots
            ? `You will escrow ${amountFormatter.format(rewardNumber * slotCount)} ${token?.symbol} after the post is live. Unpaid slots come back to you after the deadline.`
            : 'Set a reward and a number of replies to pay.'}
        </p>

        <button type="submit" className={styles.attachTask__submit} disabled={!canAttach}>
          Add task
        </button>
      </form>
    </NativeDialog>
  )
})

export default AttachTaskDialog
