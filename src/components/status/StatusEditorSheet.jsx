'use client'

import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import moment from 'moment'
import { useConnection, useSignMessage } from 'wagmi'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import DialogSheet from '@/components/ui/DialogSheet'
import TextField from '@/components/ui/TextField'
import Avatar from '@/components/ui/Avatar'
import { requestAuthNonce } from '@/lib/api'
import { normalizeAddress } from '@/lib/address'
import { STATUS_MAX_LENGTH, STATUS_PERIODS, userStatusMessage } from '@/lib/userStatus'
import styles from './StatusEditorSheet.module.scss'

const STATUS_PLACEHOLDERS = [
  "What's on your mind?",
  'Working on a new idea...',
  'The best thing I saw today was...',
  "What's the next big thing in Web3?",
  'Launching something new soon!',
  'Share one emoji that describes your day.',
  'I just learned something new about...',
  'How are you feeling in 3 emojis?',
  'What book/podcast should everyone check out?',
  'Best DAO right now?',
  'Bull or bear today?',
  'Watching [Coin Ticker]...',
]

const STATUS_PERIOD_OPTIONS = STATUS_PERIODS.map((hours) => ({
  value: hours,
  label: hours === 0 ? 'Never' : `${hours}h`,
}))

/** "Updated 2 hours ago · clears in 6 hours", for a status row from the API. */
export function describeStatus(status) {
  if (!status?.content) return ''
  const clears = status.expires_at ? `clears ${moment.unix(status.expires_at).fromNow()}` : 'no expiry'
  return `Updated ${moment.unix(status.updated_at).fromNow()} · ${clears}`
}

/**
 * The sheet that sets or clears the connected wallet's status. Opened through the ref
 * (`open()`), seeded from `status`; `onSaved` receives the stored status, or null once cleared.
 *
 * Status is offchain: the wallet signs a message and the server stores it — no gas, no chain.
 */
const StatusEditorSheet = forwardRef(function StatusEditorSheet({ status, profileImage, onSaved }, ref) {
  const dialogRef = useRef(null)
  const formId = useId()
  const [content, setContent] = useState('')
  // Hours until the status clears itself; 0 = permanent
  const [periodHours, setPeriodHours] = useState(24)
  const [placeholder, setPlaceholder] = useState(STATUS_PLACEHOLDERS[0])
  const [isSaving, setIsSaving] = useState(false)
  const { address, chain } = useConnection()
  const { signMessageAsync } = useSignMessage()

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setContent(status?.content ?? '')
        setPeriodHours(status ? status.period_hours : 24)
        setPlaceholder(STATUS_PLACEHOLDERS[Math.floor(Math.random() * STATUS_PLACEHOLDERS.length)])
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    [status]
  )

  const close = () => {
    if (!isSaving) dialogRef.current?.close()
  }

  const save = async (claim) => {
    if (isSaving) return
    if (!address) {
      toast('Connect your wallet to set a status', 'error')
      return
    }

    setIsSaving(true)
    try {
      const owner = normalizeAddress(address)
      const nonce = await requestAuthNonce(owner)
      if (!nonce) throw new Error('Could not start wallet verification')
      const signed = { ...claim, address: owner, nonce, issuedAt: Date.now(), chainId: chain?.id }
      const signature = await signMessageAsync({ account: address, message: userStatusMessage(signed) })
      const response = await fetch('/api/v1/users/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...signed, signature }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Failed to update status')
      onSaved?.(result.data)
      dialogRef.current?.close()
      toast(claim.clear ? 'Status cleared' : 'Status updated', 'success')
    } catch (error) {
      toast(error.shortMessage || error.message || 'Failed to update status', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    save({ content: trimmed, periodHours })
  }

  const hasStatus = Boolean(status?.content)

  return (
    <DialogSheet
      ref={dialogRef}
      aria-label="Set your status"
      lightDismiss={!isSaving}
      swipeDismiss={!isSaving}
      onCancel={(event) => {
        event.stopPropagation()
        if (isSaving) event.preventDefault()
      }}
      onClose={(event) => event.stopPropagation()}
    >
      <DialogSheet.Header title="Set your status" description="Visible to everyone on your profile." onClose={isSaving ? undefined : close} bordered />
      <DialogSheet.Body>
        <form id={formId} className={styles.statusEditor__content} onSubmit={handleSubmit}>
          <div className={styles.statusEditor__composer}>
            <Avatar src={profileImage} size={44} />
            <TextField
              multiline
              rows={3}
              label="Status"
              className={styles.statusEditor__field}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={placeholder}
              maxLength={STATUS_MAX_LENGTH}
              disabled={isSaving}
              hint={`${[...content].length}/${STATUS_MAX_LENGTH}`}
              autoFocus
            />
          </div>

          <div className={styles.statusEditor__period}>
            <span id={`${formId}-period`} className={styles.statusEditor__label}>Clear after</span>
            <div className={styles.statusEditor__chips} role="radiogroup" aria-labelledby={`${formId}-period`}>
              {STATUS_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={periodHours === option.value}
                  className={clsx(styles.statusEditor__chip, periodHours === option.value && styles['statusEditor__chip--active'])}
                  onClick={() => setPeriodHours(option.value)}
                  disabled={isSaving}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {hasStatus && <p className={styles.statusEditor__meta}>{describeStatus(status)}</p>}
        </form>
      </DialogSheet.Body>
      <DialogSheet.Footer>
        <div className={styles.statusEditor__actions}>
          {hasStatus && (
            <button
              type="button"
              className={clsx(styles.statusEditor__button, styles['statusEditor__button--danger'])}
              onClick={() => save({ clear: true })}
              disabled={isSaving}
            >
              Clear status
            </button>
          )}
          <button
            type="submit"
            form={formId}
            className={clsx(styles.statusEditor__button, styles['statusEditor__button--primary'])}
            disabled={isSaving || !content.trim()}
          >
            {isSaving ? <><Spinner size={16} color="currentColor" /> Signing…</> : hasStatus ? 'Update' : 'Share'}
          </button>
        </div>
      </DialogSheet.Footer>
    </DialogSheet>
  )
})

export default StatusEditorSheet
