'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './DeleteFolderDialog.module.scss'

/**
 * Confirmation for deleting a bookmark folder. Deleting the folder never deletes what is inside
 * it — the posts fall back to All — and that is exactly the part a bare "Are you sure?" leaves
 * people guessing about, so the dialog says it outright.
 */
const DeleteFolderDialog = forwardRef(function DeleteFolderDialog({ folder, isDeleting = false, onConfirm, onClosed }, ref) {
  const dialogRef = useRef(null)

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const postCount = Number(folder?.post_count) || 0

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.deleteFolder}
      aria-label={`Delete folder ${folder?.name || ''}`}
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClosed?.()
      }}
      onCancel={(e) => {
        e.stopPropagation()
        if (isDeleting) e.preventDefault()
      }}
    >
      <div className={styles.deleteFolder__body}>
        <header className={styles.deleteFolder__header}>
          <h3>Delete this folder?</h3>
          <button
            type="button"
            className={styles.deleteFolder__close}
            onClick={() => dialogRef.current?.close()}
            disabled={isDeleting}
            aria-label="Close"
          >
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.deleteFolder__target}>
          <strong>{folder?.name}</strong>
        </p>

        <p className={styles.deleteFolder__note}>
          <WarningIcon size={14} />
          <span>
            {postCount > 0
              ? `The ${postCount === 1 ? 'post' : `${postCount} posts`} filed here stay saved and move back to All. Only the folder goes away.`
              : 'The folder is empty, so nothing else changes.'}
          </span>
        </p>

        <div className={styles.deleteFolder__actions}>
          <button type="button" className={styles.deleteFolder__cancel} onClick={() => dialogRef.current?.close()} disabled={isDeleting}>
            Keep folder
          </button>
          <button type="button" className={styles.deleteFolder__confirm} onClick={() => onConfirm?.()} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete folder'}
          </button>
        </div>
      </div>
    </NativeDialog>
  )
})

export default DeleteFolderDialog
