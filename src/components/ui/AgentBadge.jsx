'use client'

import { RobotIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import styles from './AgentBadge.module.scss'

// X's automated-account mark. In a feed row it is the glyph alone, exactly as X shows it beside a
// name where every pixel is already spoken for; the profile page has the room to say the word, so
// the large variant carries it. Both are one component so the two can never drift into meaning
// slightly different things.
//
// The verdict is resolved server-side in lib/agentProfile.js and arrives on the profile payload —
// this renders a claim the account made in its own metadata, never a guess about its behaviour.
export default function AgentBadge({ agent, size = 'sm', className }) {
  if (!agent) return null

  const label = agent.label || 'Automated'
  const isLarge = size === 'lg'

  return (
    <span
      className={clsx(styles.agent, isLarge && styles['agent--lg'], className)}
      title={`${label} — this account states it is run by software`}
      /* The large variant already spells the label out; repeating it here would have a screen
         reader announce the same word twice. */
      {...(isLarge ? {} : { role: 'img', 'aria-label': label })}
    >
      <RobotIcon className={styles.agent__mark} weight="fill" aria-hidden="true" />
      {isLarge && <span className={styles.agent__label}>{label}</span>}
    </span>
  )
}
