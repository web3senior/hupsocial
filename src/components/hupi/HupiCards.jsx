import Link from 'next/link'
import { Rise } from 'cube-motion/react'
import { BriefcaseIcon, CalendarDotsIcon, ChartBarIcon, ChatCircleIcon, EyeIcon, HeartIcon, TrendUpIcon } from '@phosphor-icons/react'
import Avatar from '@/components/ui/Avatar'
import styles from './HupiCards.module.scss'

/**
 * @file components/hupi/HupiCards.jsx
 * @description The posts, profiles and open items a Hupi reply links to, drawn as small cards
 * under the bubble. The route sends only cards for links the reply actually contains, so the
 * strip always matches the words above it.
 */

const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const ITEM_KINDS = {
  poll: { label: 'Poll', icon: ChartBarIcon },
  prediction: { label: 'Prediction', icon: TrendUpIcon },
  event: { label: 'Event', icon: CalendarDotsIcon },
  task: { label: 'Task', icon: BriefcaseIcon },
}

const STATS = [
  ['likes', HeartIcon, 'likes'],
  ['comments', ChatCircleIcon, 'comments'],
  ['views', EyeIcon, 'views'],
]

function PostCard({ card }) {
  return (
    <>
      <span className={styles.cards__head}>
        <Avatar src={card.image} size={20} className={styles.cards__avatar} />
        <strong className={styles.cards__title}>{card.title}</strong>
      </span>
      {card.text && <span className={styles.cards__text}>{card.text}</span>}
      <span className={styles.cards__stats}>
        {STATS.filter(([key]) => Number.isFinite(card.stats?.[key])).map(([key, Icon, label]) => (
          <span key={key} className={styles.cards__stat} aria-label={`${card.stats[key]} ${label}`}>
            <Icon aria-hidden="true" />
            {COMPACT.format(card.stats[key])}
          </span>
        ))}
      </span>
    </>
  )
}

function ProfileCard({ card }) {
  return (
    <span className={styles.cards__head}>
      <Avatar src={card.image} size={36} className={styles.cards__avatar} />
      <span className={styles.cards__lines}>
        <strong className={styles.cards__title}>{card.title}</strong>
        {card.subtitle && <span className={styles.cards__subtitle}>{card.subtitle}</span>}
      </span>
    </span>
  )
}

function ItemCard({ card }) {
  const { label, icon: Icon } = ITEM_KINDS[card.kind]
  return (
    <span className={styles.cards__head}>
      <span className={styles.cards__icon} aria-hidden="true">
        <Icon weight="bold" />
      </span>
      <span className={styles.cards__lines}>
        <span className={styles.cards__kind}>{label}</span>
        <strong className={styles.cards__title}>{card.title}</strong>
        {card.subtitle && <span className={styles.cards__subtitle}>{card.subtitle}</span>}
      </span>
    </span>
  )
}

/**
 * @param {Object} props
 * @param {Array<{kind: string, link: string}>} props.cards
 * @param {() => void} props.onNavigate Closes the panel once a card is followed.
 */
export default function HupiCards({ cards, onNavigate }) {
  const known = cards.filter((card) => card.kind === 'post' || card.kind === 'profile' || ITEM_KINDS[card.kind])
  if (known.length === 0) return null

  return (
    <Rise targets="children" className={styles.cards}>
      {known.map((card) => (
        <Link key={card.link} href={card.link} onClick={onNavigate} className={styles.cards__card}>
          {card.kind === 'post' ? <PostCard card={card} /> : card.kind === 'profile' ? <ProfileCard card={card} /> : <ItemCard card={card} />}
        </Link>
      ))}
    </Rise>
  )
}
