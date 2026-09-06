'use client'

import { ArrowsClockwiseIcon, ImagesIcon, LightningIcon } from '@phosphor-icons/react'
import HupMark from '@/components/ui/HupMark'
import styles from './StudioSplash.module.scss'

const POINTS = [
  { icon: ImagesIcon, text: 'Swap the artwork for a whole set in one upload' },
  { icon: ArrowsClockwiseIcon, text: 'Rewrite the name, story and cover any time' },
  { icon: LightningIcon, text: 'LSP7, LSP8 and ERC-721, on every chain Hup speaks' },
]

/**
 * The studio's opening band: what this page is for, in one row above the search — gone the
 * moment an address is being read. Deliberately monochrome and chain-free — the studio edits
 * collections on every chain.
 */
export default function StudioSplash() {
  return (
    <header className={styles.splash}>
      <div className={styles.splash__lead}>
        <div className={styles.splash__brand}>
          <HupMark size={20} />
          <span>Studio</span>
        </div>
        <h1 className={styles.splash__title}>A collection is never finished at launch</h1>
        <p className={styles.splash__copy}>
          Point any collection your wallet owns at new metadata — fresh artwork, a rewritten story, a new cover — including
          the ones you launched somewhere else.
        </p>
      </div>

      <ul className={styles.splash__points}>
        {POINTS.map(({ icon: Icon, text }) => (
          <li key={text}>
            <Icon size={16} weight="bold" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </header>
  )
}
