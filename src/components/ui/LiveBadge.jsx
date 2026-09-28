import clsx from 'clsx'
import styles from './LiveBadge.module.scss'

export default function LiveBadge({ className }) {
  return <span className={clsx(styles.liveBadge, className)}>Live</span>
}
