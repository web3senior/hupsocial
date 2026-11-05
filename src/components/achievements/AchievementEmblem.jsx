import clsx from 'clsx'
import { ACHIEVEMENT_ICONS, DEFAULT_ACHIEVEMENT_ICON } from './achievementIcons'
import styles from './AchievementEmblem.module.scss'

// Below this the framed emblem's ring and pale face turn to mush, so it draws solid instead
const MINI_BELOW = 40

/**
 * Achievement Emblem
 * An achievement's mark: its icon on a face cut to its rarity's shape. The one drawing of an
 * achievement every surface uses — the cards (AchievementCard), standings rows, the mark beside a
 * name and the details dialog — so an achievement looks the same wherever it appears.
 *
 * Framed at card sizes; solid below 40px, where only the silhouette and icon still read. A card
 * hovered around it, or the emblem itself, plays a sheen across the face.
 *
 * @param {Object} props.item A live catalog entry (useAchievementCatalog), for icon and rarity.
 * @param {number} [props.size=120] Rendered width in px.
 * @param {boolean} [props.locked=false] Not earned by the viewer: drawn desaturated.
 * @param {string} [props.label] Accessible name and tooltip; without one the emblem is decorative.
 * @param {string} [props.className]
 */
export default function AchievementEmblem({ item, size = 120, locked = false, label, className }) {
  const Icon = ACHIEVEMENT_ICONS[item.icon] ?? DEFAULT_ACHIEVEMENT_ICON
  const mini = size < MINI_BELOW

  return (
    <span
      className={clsx(styles.emblem, styles[`emblem--${item.rarity}`], mini && styles['emblem--mini'], locked && styles['emblem--locked'], className)}
      style={{ '--achievement-emblem-size': `${size}px` }}
      data-achievement-emblem=""
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      <span className={styles.emblem__face}>
        <Icon className={styles.emblem__icon} weight="fill" aria-hidden="true" />
      </span>
    </span>
  )
}
