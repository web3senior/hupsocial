'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import clsx from 'clsx'
import styles from './NativeDialog.module.scss'

/**
 * Modal counterpart to NativePopover, built on <dialog>.showModal():
 * top-layer rendering plus real modality — click-blocking ::backdrop,
 * inert document, focus trap, and native Esc via the cancel event.
 * The dialog element itself is the content root: pass chrome (size,
 * background, radius) through className, and wire onCancel/onClose
 * through the usual React <dialog> props. `lightDismiss` closes the
 * dialog when the backdrop is clicked.
 */
const NativeDialog = forwardRef(function NativeDialog({ children, className, lightDismiss = false, onClick, ...rest }, ref) {
  const dialogRef = useRef(null)

  // Backdrop clicks dispatch to the dialog element itself; a click whose coordinates
  // fall outside the dialog's box can only have come from the ::backdrop
  const handleClick = (event) => {
    onClick?.(event)
    if (!lightDismiss || event.defaultPrevented) return
    const el = dialogRef.current
    if (!el || event.target !== el) return
    const rect = el.getBoundingClientRect()
    const insideDialog =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    if (!insideDialog) el.close()
  }

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        const el = dialogRef.current
        if (el && !el.open) el.showModal()
      },
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  return (
    <dialog ref={dialogRef} className={clsx(styles.dialog, className)} onClick={handleClick} {...rest}>
      {children}
    </dialog>
  )
})

export default NativeDialog
