import clsx from 'clsx'
import { botAvatarDataUri, DEFAULT_BOT } from '@/lib/botAvatar'
import styles from './AgentsHeroArt.module.scss'

const WIDTH = 1000
const HEIGHT = 460
const CENTER_X = 500
const CENTER_Y = 230
const CARD_WIDTH = 250
const CARD_HEIGHT = 56
const ROWS = [110, 230, 350]

// What an agent does on the left, what it owns on the right, each in a robot colour
const CAPABILITIES = [
  { side: 'left', title: 'Chats with you', detail: 'Its own personality', hue: 262 },
  { side: 'left', title: 'Drafts posts', detail: 'You approve each one', hue: 192 },
  { side: 'left', title: 'Runs tasks', detail: 'On demand or on a schedule', hue: 34 },
  { side: 'right', title: 'Own wallet', detail: 'Its key never leaves you', hue: 152 },
  { side: 'right', title: 'Picks its model', detail: 'Pays from its own credits', hue: 350 },
  { side: 'right', title: 'Workspace onchain', detail: 'Memory, skills and tasks', hue: 222 },
].map((capability, index) => {
  const y = ROWS[index % 3]
  const left = capability.side === 'left'
  const cardX = left ? 40 : WIDTH - 40 - CARD_WIDTH
  // Out of the robot's side, curving to the card's inner edge
  const fromX = left ? CENTER_X - 112 : CENTER_X + 112
  const toX = left ? cardX + CARD_WIDTH : cardX
  const bend = left ? fromX - 60 : fromX + 60
  return { ...capability, y, cardX, color: `hsl(${capability.hue} 80% 62%)`, path: `M${fromX} ${CENTER_Y} C${bend} ${CENTER_Y} ${bend} ${y} ${toX} ${y}` }
})

const HERO_BOT = botAvatarDataUri(DEFAULT_BOT, { background: false })
const SIDEKICKS = [
  { x: 330, y: 22, size: 78, delay: -1.2, uri: botAvatarDataUri({ ...DEFAULT_BOT, color: 'mint', dome: 'antenna', eyes: 'happy', mouth: 'smile', chest: 'heart' }, { background: false }) },
  { x: 596, y: 362, size: 72, delay: -3.4, uri: botAvatarDataUri({ ...DEFAULT_BOT, color: 'sunset', dome: 'bolt', ears: 'headset', eyes: 'visor', chest: 'bolt' }, { background: false }) },
]

/**
 * The My agents hero: a robot at the centre, signals running out to what an agent does and owns.
 * Decorative motion only — every capability is also stated in the caption beside it — and still
 * under prefers-reduced-motion.
 */
export default function AgentsHeroArt({ className }) {
  return (
    <svg
      className={clsx(styles.art, className)}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`An AI agent that ${CAPABILITIES.map((capability) => capability.title.toLowerCase()).join(', ')}.`}
    >
      <defs>
        <radialGradient id="agents-hero-glow">
          <stop offset="0" stopColor="hsl(262 100% 80%)" stopOpacity="0.55" />
          <stop offset="1" stopColor="hsl(262 100% 80%)" stopOpacity="0" />
        </radialGradient>
        {CAPABILITIES.map((capability, index) => (
          <linearGradient
            key={capability.title}
            id={`agents-hero-line-${index}`}
            gradientUnits="userSpaceOnUse"
            x1={capability.side === 'left' ? CENTER_X - 112 : CENTER_X + 112}
            y1={CENTER_Y}
            x2={capability.side === 'left' ? capability.cardX + CARD_WIDTH : capability.cardX}
            y2={capability.y}
          >
            <stop offset="0" stopColor={capability.color} stopOpacity="0" />
            <stop offset="1" stopColor={capability.color} stopOpacity="1" />
          </linearGradient>
        ))}
      </defs>

      {CAPABILITIES.map((capability, index) => (
        <g key={capability.title} fill="none">
          <path className={styles.art__line} d={capability.path} stroke={`url(#agents-hero-line-${index})`} />
          <path className={styles.art__signal} d={capability.path} stroke={capability.color} style={{ animationDelay: `${-index * 0.7}s` }} />
        </g>
      ))}

      <circle className={styles.art__glow} cx={CENTER_X} cy={CENTER_Y} r="150" fill="url(#agents-hero-glow)" />
      <g className={styles.art__orbit} style={{ transformOrigin: `${CENTER_X}px ${CENTER_Y}px` }}>
        <circle cx={CENTER_X} cy={CENTER_Y} r="128" fill="none" className={styles.art__ring} />
        <circle cx={CENTER_X + 128} cy={CENTER_Y} r="6" fill="hsl(192 80% 62%)" />
        <circle cx={CENTER_X - 64} cy={CENTER_Y - 111} r="5" fill="hsl(34 85% 62%)" />
        <circle cx={CENTER_X - 64} cy={CENTER_Y + 111} r="4" fill="hsl(350 80% 66%)" />
      </g>

      <g className={styles.art__float}>
        <image href={HERO_BOT} x={CENTER_X - 105} y={CENTER_Y - 115} width="210" height="210" />
      </g>

      {SIDEKICKS.map((bot) => (
        <g key={bot.x} className={styles.art__float} style={{ animationDelay: `${bot.delay}s` }}>
          <image href={bot.uri} x={bot.x} y={bot.y} width={bot.size} height={bot.size} />
        </g>
      ))}

      {CAPABILITIES.map((capability) => (
        <g key={capability.title} transform={`translate(${capability.cardX} ${capability.y - CARD_HEIGHT / 2})`}>
          <rect className={styles.art__card} width={CARD_WIDTH} height={CARD_HEIGHT} rx="14" />
          <circle cx="28" cy={CARD_HEIGHT / 2} r="11" fill={capability.color} opacity="0.18" />
          <circle cx="28" cy={CARD_HEIGHT / 2} r="5" fill={capability.color} />
          <text className={styles.art__title} x="50" y="24">
            {capability.title}
          </text>
          <text className={styles.art__detail} x="50" y="42">
            {capability.detail}
          </text>
        </g>
      ))}
    </svg>
  )
}
