'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './ConfirmVoteDialog.module.scss'

/**
 * Confirmation before a poll ballot is cast onchain. A ballot can't be changed once it lands, so
 * tapping an option only opens this dialog — the vote is sent on the confirm button, never on the
 * first tap.
 */
const ConfirmVoteDialog = forwardRef(function ConfirmVoteDialog({ onConfirm }, ref) {
  const dialogRef = useRef(null)
  const [option, setOption] = useState(null)

  useImperativeHandle(ref, () => ({
    open: (nextOption) => {
      setOption(nextOption)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.confirmVote}
      aria-labelledby="confirm-vote-title"
      appear="zoom"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <div className={styles.confirmVote__body}>
        <h3 id="confirm-vote-title" className={styles.confirmVote__title}>
          Cast your vote?
        </h3>
        {option && (
          <p className={styles.confirmVote__choice}>
            {option.emoji ? `${option.emoji} ` : ''}
            {option.label}
          </p>
        )}
        <p className={styles.confirmVote__message}>Votes are recorded onchain, so you won&apos;t be able to change it later.</p>
      </div>

      <div className={styles.confirmVote__actions}>
        <button type="button" className={styles.confirmVote__button} onClick={() => dialogRef.current?.close()} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className={clsx(styles.confirmVote__button, styles['confirmVote__button--primary'])}
          onClick={() => {
            dialogRef.current?.close()
            if (option) onConfirm?.(option.index)
          }}
        >
          Vote
        </button>
      </div>
    </NativeDialog>
  )
})

export default ConfirmVoteDialog
