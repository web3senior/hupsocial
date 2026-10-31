// Shimmer.jsx
import clsx from 'clsx'
import styles from './Shimmer.module.scss'

export default function Shimmer({ children, style, className, as: Component = 'div' }) {
  return (
    <Component className={clsx(styles.shimmer, className)} style={style} aria-live="polite" aria-busy="true">
      {children}
    </Component>
  )
}
