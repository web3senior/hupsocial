import clsx from 'clsx'
import styles from './NavBadge.module.scss'

/**
 * Small inline status pill (BETA, NEW, …) that sits after a label.
 * Owns the shape only — every color comes in through props so a caller can
 * point it at any theme token without this file knowing which.
 * @param {Object} props
 * @param {string} props.label Uppercase text to render, e.g. 'NEW'.
 * @param {string} props.background Any CSS color value, normally `var(--…-badge-background)`.
 * @param {string} props.color Any CSS color value, normally `var(--…-badge-color)`.
 * @param {string} [props.className] Extra classes from the consumer's module.
 */
export const NavBadge = ({ label, background, color, className }) => (
  <span className={clsx(styles.badge, className)} style={{ '--nav-badge-background': background, '--nav-badge-color': color }}>
    {label}
  </span>
)

export default NavBadge
