'use client'

import styles from './DialogHeader.module.scss'

/**
 * The one modal header: centered title, plain-text dismiss button on the left — the NewPost
 * composer's pattern, extracted so every NativeDialog modal shares identical placement,
 * typography, and behavior instead of each one drifting on its own.
 * `actions` (optional) renders into the right-hand grid cell.
 */
export default function DialogHeader({ title, onCancel, cancelLabel = 'Cancel', actions = null }) {
  return (
    <header className={styles.header}>
      <button type="button" className={styles.header__cancel} onClick={onCancel}>
        {cancelLabel}
      </button>
      <h2 className={styles.header__title}>{title}</h2>
      {actions && <div className={styles.header__actions}>{actions}</div>}
    </header>
  )
}
