'use client'

import clsx from 'clsx'
import styles from './EmptyState.module.scss'

const ICON_SIZE = { sm: 14, md: 16, lg: 22 }

/**
 * Empty State
 * The one way a surface says it has nothing to show, so every "Nothing here yet" on a page
 * reads at the same weight, colour and rhythm instead of each section inventing its own.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children The sentence itself.
 * @param {'sm'|'md'|'lg'} [props.size='md'] Type size — sm inside a card or chart, lg for a
 *   whole section that came back empty.
 * @param {'start'|'center'} [props.align='start'] Centered stacks the icon above the text.
 * @param {React.ElementType} [props.icon] A Phosphor icon component, drawn muted beside the text.
 * @param {React.ReactNode} [props.action] A trailing button or link, when there is a way out.
 * @param {'p'|'div'} [props.as='p']
 * @param {string} [props.className] Layout class from the consumer's module.
 */
export default function EmptyState({ children, size = 'md', align = 'start', icon: Icon, action, as: Tag = 'p', className }) {
  return (
    <Tag className={clsx(styles.empty, styles[`empty--${size}`], styles[`empty--${align}`], className)} role="status">
      {Icon && <Icon size={ICON_SIZE[size] ?? ICON_SIZE.md} aria-hidden="true" />}
      <span className={styles.empty__text}>{children}</span>
      {action && <span className={styles.empty__action}>{action}</span>}
    </Tag>
  )
}
