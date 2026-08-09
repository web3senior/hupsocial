'use client'

import { forwardRef } from 'react'
import clsx from 'clsx'
import NativeDialog from './NativeDialog'
import styles from './DialogSheet.module.scss'

/**
 * The shared modal *layout*, one layer above NativeDialog: NativeDialog owns top-layer
 * behaviour (modality, focus trap, Esc, animation) and this owns the look — sheet shell,
 * centred header, grouped rows, footnote — so modals compose the same chrome instead of
 * each re-declaring width, radius and shadow in its own module.
 *
 * Everything not listed here forwards to NativeDialog, `lightDismiss` and the ref
 * (`open()` / `close()`) included.
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
const DialogSheet = forwardRef(function DialogSheet({ children, className, ...rest }, ref) {
  return (
    <NativeDialog ref={ref} className={clsx(styles.sheet, className)} {...rest}>
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
