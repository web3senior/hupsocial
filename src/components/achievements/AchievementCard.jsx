'use client'

import clsx from 'clsx'
import { RARITY_LABELS } from '@/config/achievements'
import AchievementEmblem from './AchievementEmblem'
import styles from './AchievementCard.module.scss'

const EMBLEM_SIZE = { md: 56, lg: 112 }

/**
 * Achievement Card
 * The one card an achievement is shown on: the catalog (`lg`, with its description) and a
 * profile's rail (`md`, emblem, name and rarity only). Built on AchievementEmblem, the mark
 * standings rows and bylines use, so every surface draws an achievement the same way.
 *
 * A soft spotlight follows the pointer across the card and the emblem plays its sheen on hover;
 * reduced-motion readers keep the light but lose the movement.
 *
 * @param {Object} props.item A live catalog entry (useAchievementCatalog).
 * @param {'md'|'lg'} [props.size='lg']
 * @param {string} [props.as='div'] Element to render — 'li' in a list, 'button' when it opens something.
 * @param {boolean} [props.locked=false] Known not to be earned by the viewer.
 * @param {string} [props.scope] Season id for a per-season award.
 * @param {React.ReactNode} [props.tags] Pills beside the rarity (an airdrop bonus, say).
 * @param {React.ReactNode} [props.children] Anything below the description, such as earned state.
 */
export default function AchievementCard({ item, size = 'lg', as: Tag = 'div', locked = false, scope, tags, children, className, onPointerMove, ...rest }) {
  const Name = size === 'lg' ? 'h3' : 'strong'

  // The spotlight sits where the pointer is; CSS fades it in on hover
  const follow = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--light-x', `${event.clientX - box.left}px`)
    event.currentTarget.style.setProperty('--light-y', `${event.clientY - box.top}px`)
    onPointerMove?.(event)
  }

  return (
    <Tag
      className={clsx(styles.card, styles[`card--${item.rarity}`], styles[`card--${size}`], locked && styles['card--locked'], className)}
      onPointerMove={follow}
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
    >
      <span className={styles.card__light} aria-hidden="true" />
      <AchievementEmblem item={item} size={EMBLEM_SIZE[size]} locked={locked} className={styles.card__emblem} />
      <span className={styles.card__heading}>
        <Name className={styles.card__name}>{item.name}</Name>
        <span className={styles.card__tags}>
          <span className={styles.card__rarity}>
            {RARITY_LABELS[item.rarity]}
            {scope ? ` · Season ${scope}` : ''}
          </span>
          {tags}
        </span>
      </span>
      {size === 'lg' && <p className={styles.card__description}>{item.description}</p>}
      {children}
    </Tag>
  )
}
