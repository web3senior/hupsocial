'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { XIcon } from '@phosphor-icons/react'
import Avatar from './Avatar'
import NativeDialog from './NativeDialog'
import styles from './AvatarViewer.module.scss'

/* The viewer's diameter in CSS px — the 768 rung of the avatar ladder at 2x */
const VIEWER_SIZE_PX = 384

/**
 * A profile picture at its large size, over the whole page. A click anywhere off the picture,
 * the X or Escape closes it. Opened through the ref: `viewerRef.current.open()`.
 * @param {{src: string|null, alt?: string}} props
 */
const AvatarViewer = forwardRef(function AvatarViewer({ src, alt = '' }, ref) {
  const dialogRef = useRef(null)
  // Mounted on the first open, so a profile visit never pulls the large encode
  const [mounted, setMounted] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setMounted(true)
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  const close = () => dialogRef.current?.close()

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.viewer}
      aria-label={alt || 'Profile picture'}
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
    >
      <div
        className={styles.viewer__stage}
        onClick={(event) => {
          if (!event.target.closest('img, button')) close()
        }}
      >
        {mounted && <Avatar src={src} size={VIEWER_SIZE_PX} alt={alt} loading="eager" className={styles.viewer__image} />}
      </div>
      <button type="button" className={styles.viewer__close} onClick={close} aria-label="Close" title="Close">
        <XIcon size={20} weight="bold" />
      </button>
    </NativeDialog>
  )
})

export default AvatarViewer
