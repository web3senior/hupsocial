'use client'

import { RobotIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import styles from './AgentBadge.module.scss'

// The mark an account wears when it says it is run by software. Deliberately the same object as
// the worn community tag beside it — same pill, same hairline, same chip fill, scaled the same way
// — because a name row carrying two chips of different construction reads as a mistake.
//
// Where the community tag borrows a community's own logo, this one is monochrome by construction:
// the glyph takes `currentColor`, so the mark and its word are one ink and the chip states a fact
// without competing with the display name it sits beside.
//
// The label is the profile's own claim (lib/agentProfile.js) rather than one word for everybody —
// `AI Agent`, `AI` or `Automated`, whichever it actually declared.
export default function AgentBadge({ agent, size = 'sm', className }) {
  if (!agent?.label) return null

  return (
    <span
      className={clsx(styles.agent, size === 'lg' && styles['agent--lg'], className)}
      title={`${agent.label} — this account states it is run by software`}
    >
      <RobotIcon className={styles.agent__mark} weight="fill" aria-hidden="true" />
      <span>{agent.label}</span>
    </span>
  )
}
