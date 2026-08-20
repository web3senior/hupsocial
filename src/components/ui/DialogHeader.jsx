'use client'

import clsx from 'clsx'
import styles from './DialogHeader.module.scss'

/**
 * The one modal header: centered title, plain-text dismiss button on the left — the NewPost
 * composer's pattern, extracted so every NativeDialog modal shares identical placement,
 * typography, and behavior instead of each one drifting on its own.
 * `actions` (optional) renders into the right-hand grid cell. `compact` trims the height and
 * title size for form dialogs (community create/modify, member management) where the header is
 * a label over a long form rather than the composer's headline.
 */
export default function DialogHeader({ title, onCancel, cancelLabel = 'Cancel', actions = null, compact = false }) {
  return (
    <header className={clsx(styles.header, compact && styles['header--compact'])}>
      <button type="button" className={styles.header__cancel} onClick={onCancel}>
        {cancelLabel}
      </button>
      <h2 className={styles.header__title}>{title}</h2>
      {actions && <div className={styles.header__actions}>{actions}</div>}
    </header>
  )
}
