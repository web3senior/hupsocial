'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import clsx from 'clsx'
import NativeDialog from './NativeDialog'
import styles from './DialogSheet.module.scss'

// Keep in sync with the sm breakpoint in styles/components/_responsive.scss — the drag
// gesture only exists where that stylesheet docks the sheet to the bottom edge.
const DOCKED_SHEET_QUERY = '(max-width: 639px)'
// Release past this fraction of the sheet's height — or fling downward faster than
// FLING_VELOCITY px/ms — dismisses; anything less snaps back.
const DISMISS_FRACTION = 0.33
const FLING_VELOCITY = 0.5
const SETTLE_EASING = 'transform 0.26s cubic-bezier(0.33, 1, 0.68, 1)'

// Runs `done` once the transform transition finishes, with a timer fallback for the cases
// where transitionend never fires (transition dropped, or zero-distance settle).
function afterTransform(el, done) {
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    el.removeEventListener('transitionend', onEnd)
    clearTimeout(timer)
    done()
  }
  const onEnd = (event) => {
    if (event.target === el && event.propertyName === 'transform') settle()
  }
  el.addEventListener('transitionend', onEnd)
  const timer = setTimeout(settle, 400)
}

// A touch that starts inside a scrolled container must keep scrolling it back toward the
// top — only containers already at rest cede their downward pans to the sheet drag.
function hasScrolledAncestor(node, stopEl) {
  for (let el = node; el && el !== stopEl; el = el.parentElement) {
    if (el.scrollTop > 0) return true
  }
  return false
}

/**
 * The native-sheet drag, one instance per mounted sheet. Entered through React's
 * onTouchStart; move/end listeners are attached natively and non-passively for the
 * gesture's duration, because React delivers touchmove passively and a passive listener
 * can never preventDefault the body scroll away from the drag.
 */
function createSheetGesture() {
  let el = null
  let touchId = null
  let startTarget = null
  let startX = 0
  let startY = 0
  let lastY = 0
  let lastT = 0
  let velocity = 0
  let decided = false
  let dragging = false
  let dismissing = false

  const teardown = () => {
    touchId = null
    decided = false
    dragging = false
    if (!el) return
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onCancel)
  }

  const settle = (dismiss) => {
    const sheet = el
    if (dismiss) dismissing = true
    sheet.style.transition = SETTLE_EASING
    sheet.style.transform = dismiss ? 'translateY(100%)' : ''
    afterTransform(sheet, () => {
      if (!dismiss) {
        sheet.style.transition = ''
        return
      }
      // reset() intervened (the sheet was reopened mid-slide) — leave its state alone
      if (!dismissing) return
      dismissing = false
      // Restore the class transition first so close() still fades the backdrop out; the
      // inline transform keeps the now-offscreen sheet parked until the next open().
      sheet.style.transition = ''
      sheet.close()
    })
  }

  const findTouch = (list) => {
    for (const touch of list) if (touch.identifier === touchId) return touch
    return null
  }

  const onMove = (event) => {
    const touch = findTouch(event.touches)
    if (!touch) return
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    if (!decided) {
      if (dx === 0 && dy === 0) return
      decided = true
      // Only a mostly-vertical downward pan that no inner scroller claims becomes a
      // sheet drag; everything else is the content's own gesture.
      if (dy <= 0 || Math.abs(dx) > dy || hasScrolledAncestor(startTarget, el)) {
        teardown()
        return
      }
      dragging = true
      el.style.transition = 'none'
    }
    if (!dragging) return
    event.preventDefault()
    el.style.transform = `translateY(${Math.max(0, dy)}px)`
    const dt = event.timeStamp - lastT
    // Lightly smoothed so one hesitant frame in an otherwise committed fling can't zero it
    if (dt > 0) velocity = ((touch.clientY - lastY) / dt) * 0.6 + velocity * 0.4
    lastY = touch.clientY
    lastT = event.timeStamp
  }

  const onEnd = (event) => {
    if (!findTouch(event.changedTouches)) return
    const wasDragging = dragging
    // A finger that paused before lifting has no fling left, whatever its last move said
    const flingVelocity = event.timeStamp - lastT > 100 ? 0 : velocity
    teardown()
    if (!wasDragging) return
    const dy = Math.max(0, lastY - startY)
    // An upward fling always recovers the sheet, however far it was pulled
    const dismiss =
      flingVelocity >= -0.15 && (dy > el.offsetHeight * DISMISS_FRACTION || (flingVelocity > FLING_VELOCITY && dy > 24))
    settle(dismiss)
  }

  const onCancel = (event) => {
    if (!findTouch(event.changedTouches)) return
    const wasDragging = dragging
    teardown()
    if (wasDragging) settle(false)
  }

  const onTouchStart = (event) => {
    if (touchId !== null || dismissing) return
    if (event.touches.length !== 1) return
    if (!window.matchMedia(DOCKED_SHEET_QUERY).matches) return
    const sheet = event.currentTarget
    const touch = event.touches[0]
    // Backdrop touches dispatch to the dialog element too — only a touch inside the box
    // grabs the sheet; taps above it stay lightDismiss's business.
    const rect = sheet.getBoundingClientRect()
    if (touch.clientY < rect.top || touch.clientX < rect.left || touch.clientX > rect.right) return

    el = sheet
    touchId = touch.identifier
    startTarget = event.target
    startX = touch.clientX
    startY = touch.clientY
    lastY = touch.clientY
    lastT = event.timeStamp
    velocity = 0
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
  }

  // Clears every trace of the last gesture — pending listeners, the slide-out flag and
  // the inline styles a dismissal parks on the element — so the sheet always opens from
  // its rest state.
  const reset = () => {
    teardown()
    dismissing = false
    if (!el) return
    el.style.transform = ''
    el.style.transition = ''
  }

  return { onTouchStart, reset }
}

/**
 * The shared modal *layout*, one layer above NativeDialog: NativeDialog owns top-layer
 * behaviour (modality, focus trap, Esc, animation) and this owns the look — sheet shell,
 * centred header, grouped rows, footnote — so modals compose the same chrome instead of
 * each re-declaring width, radius and shadow in its own module.
 *
 * Everything not listed here forwards to NativeDialog, `lightDismiss` and the ref
 * (`open()` / `close()`) included.
 *
 * Below the sm breakpoint the sheet docks to the bottom edge and behaves like a native
 * bottom sheet: dragging it down follows the finger, releasing past a third of its height
 * (or flinging) dismisses, anything less snaps back. Touches inside a scrolled Body keep
 * scrolling it — only a Body at rest cedes downward pans to the drag. `swipeDismiss={false}`
 * turns the gesture off for sheets that must not close casually.
 *
 * <DialogSheet ref={dialogRef} lightDismiss aria-label="Connect wallet">
 *   <DialogSheet.Header title="Connect wallet" onClose={close} />
 *   <DialogSheet.Body>
 *     <DialogSheet.Group>
 *       <DialogSheet.Row icon={<img src={…} alt="" />} name="MetaMask" meta="Detected" onClick={…} />
 *     </DialogSheet.Group>
 *   </DialogSheet.Body>
 *   <DialogSheet.Footer>Fine print</DialogSheet.Footer>
 * </DialogSheet>
 */
const DialogSheet = forwardRef(function DialogSheet({ children, className, swipeDismiss = true, onTouchStart, ...rest }, ref) {
  const innerRef = useRef(null)
  const gestureRef = useRef(null)
  if (gestureRef.current === null) gestureRef.current = createSheetGesture()

  // NativeDialog's handle, re-exposed with one addition: opening always rewinds the
  // inline transform a previous drag-dismissal parked on the element.
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        gestureRef.current.reset()
        innerRef.current?.open()
      },
      close: () => innerRef.current?.close(),
    }),
    []
  )

  useEffect(() => () => gestureRef.current.reset(), [])

  const handleTouchStart = (event) => {
    onTouchStart?.(event)
    if (swipeDismiss) gestureRef.current.onTouchStart(event)
  }

  return (
    <NativeDialog ref={innerRef} className={clsx(styles.sheet, className)} onTouchStart={handleTouchStart} {...rest}>
      {children}
    </NativeDialog>
  )
})

/**
 * Centred title with optional supporting line, an optional left-hand slot (a Cancel button,
 * a back arrow) and an optional close button. `bordered` adds the rule that scrolling
 * form modals want between header and body.
 */
function Header({ title, description, lead, onClose, closeLabel = 'Close', bordered = false, className }) {
  return (
    <header className={clsx(styles.header, bordered && styles['header--bordered'], className)}>
      {lead && <div className={styles.header__lead}>{lead}</div>}

      <h2 className={styles.header__title}>{title}</h2>

      {onClose && (
        <button type="button" className={styles.header__close} onClick={onClose} aria-label={closeLabel}>
          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
          </svg>
        </button>
      )}

      {description && <p className={styles.header__description}>{description}</p>}
    </header>
  )
}

/** The scrolling region between header and footer. */
function Body({ children, className }) {
  return <div className={clsx(styles.body, className)}>{children}</div>
}

/** A card of rows under one rounded outline, divided by hairlines. */
function Group({ children, className }) {
  return <div className={clsx(styles.group, className)}>{children}</div>
}

/**
 * One row: leading icon, name (plus optional description), trailing meta. Renders a
 * <button> when it is actionable and a plain <div> otherwise, so non-interactive rows
 * stay out of the tab order.
 *
 * `icon` takes a node (an <img>, an <svg>) or a string, which renders as an initial in a
 * tinted tile — the fallback for connectors and tokens that ship no artwork.
 */
function Row({ icon, name, description, meta, onClick, disabled, active = false, className, children, ...rest }) {
  const interactive = Boolean(onClick)
  const Element = interactive ? 'button' : 'div'

  return (
    <Element
      className={clsx(styles.row, interactive && styles['row--interactive'], active && styles['row--active'], className)}
      onClick={onClick}
      disabled={interactive ? disabled : undefined}
      type={interactive ? 'button' : undefined}
      {...rest}
    >
      {icon && <span className={clsx(styles.row__icon, typeof icon === 'string' && styles['row__icon--fallback'])}>{typeof icon === 'string' ? icon.charAt(0) : icon}</span>}

      {children || (
        <span className={styles.row__label}>
          <span className={styles.row__name}>{name}</span>
          {description && <span className={styles.row__description}>{description}</span>}
        </span>
      )}

      {meta && <span className={styles.row__meta}>{meta}</span>}
    </Element>
  )
}

/** Muted fine print below the body — legal copy, hints, a link out. */
function Footer({ children, className }) {
  return <footer className={clsx(styles.footer, className)}>{children}</footer>
}

DialogSheet.Header = Header
DialogSheet.Body = Body
DialogSheet.Group = Group
DialogSheet.Row = Row
DialogSheet.Footer = Footer

export default DialogSheet
