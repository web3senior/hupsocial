'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import clsx from 'clsx'
import { lockPageScroll, unlockPageScroll } from '@/lib/scrollLock'
import styles from './NativeDialog.module.scss'

/**
 * Modal counterpart to NativePopover, built on <dialog>.showModal():
 * top-layer rendering plus real modality — click-blocking ::backdrop,
 * inert document, focus trap, and native Esc via the cancel event.
 * The dialog element itself is the content root: pass chrome (size,
 * background, radius) through className, and wire onCancel/onClose
 * through the usual React <dialog> props. `lightDismiss` closes the
 * dialog when the backdrop is clicked. Opening also locks the page
 * scroller — showModal() makes the document inert but leaves it free
 * to scroll behind the backdrop.
 */
const NativeDialog = forwardRef(function NativeDialog({ children, className, lightDismiss = false, onClick, ...rest }, ref) {
  const dialogRef = useRef(null)

  // This instance's claim on the page-scroll lock. Acquire/release are idempotent per
  // instance, so it never matters which of the release paths below wins the race — the
  // global refcount in scrollLock moves exactly once per open, whatever the close path.
  const lockedRef = useRef(false)
  const acquireLock = () => {
    if (lockedRef.current) return
    lockedRef.current = true
    lockPageScroll()
  }
  const releaseLock = () => {
    if (!lockedRef.current) return
    lockedRef.current = false
    unlockPageScroll()
  }

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
        if (!el || el.open) return
        el.showModal()
        acquireLock()
      },
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  // Released on the *native* close event, not React's onClose: React re-dispatches close
  // up the component tree, so a nested dialog closing would otherwise release the parent's
  // lock too. Native close doesn't bubble, so one close releases exactly one lock.
  //
  // The cleanup releases unconditionally (not gated on el.open): a consumer that unmounts
  // the dialog from its onClose handler (the composer's mount = open / unmount = close
  // contract) unmounts DURING the close dispatch — React's directly-attached onClose runs
  // first, its sync flush runs this cleanup, and removeEventListener pulls our listener out
  // of the in-flight dispatch before it ever fires, with el.open already false. Only the
  // per-instance flag in releaseLock knows whether this instance still owes an unlock.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    // StrictMode's simulated unmount runs the cleanup below while the dialog stays open,
    // and the replayed open() early-returns on el.open — re-acquire here or a dialog that
    // mounts open (the composer) sits open with the page scroller unlocked in dev.
    if (el.open) acquireLock()
    el.addEventListener('close', releaseLock)
    return () => {
      el.removeEventListener('close', releaseLock)
      releaseLock()
    }
  }, [])

  return (
    <dialog ref={dialogRef} className={clsx(styles.dialog, className)} onClick={handleClick} {...rest}>
      {children}
    </dialog>
  )
})

export default NativeDialog
