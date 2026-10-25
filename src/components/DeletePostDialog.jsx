'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './DeletePostDialog.module.scss'

/**
 * Confirmation before a post is deleted onchain. The delete can't be undone, so the menu row only
 * opens this dialog — the post goes away on the confirm button, never on the first tap.
 */
const DeletePostDialog = forwardRef(function DeletePostDialog({ onConfirm }, ref) {
  const dialogRef = useRef(null)

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.deletePost}
      aria-labelledby="delete-post-title"
      appear="zoom"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <div className={styles.deletePost__body}>
        <h3 id="delete-post-title" className={styles.deletePost__title}>
          Delete post?
        </h3>
        <p className={styles.deletePost__message}>If you delete this post, you won&apos;t be able to restore it.</p>
      </div>

      <div className={styles.deletePost__actions}>
        <button type="button" className={styles.deletePost__button} onClick={() => dialogRef.current?.close()} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className={clsx(styles.deletePost__button, styles['deletePost__button--danger'])}
          onClick={(e) => {
            dialogRef.current?.close()
            onConfirm?.(e)
          }}
        >
          Delete
        </button>
      </div>
    </NativeDialog>
  )
})

export default DeletePostDialog
