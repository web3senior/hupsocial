'use client'

import { PlayCircleIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { setAutoplayPreference, useAutoplayPreference } from '@/hooks/useAutoplayPreference'
import styles from './PlaybackPreference.module.scss'

/**
 * Whether feed videos start on their own. Off by default — autoplay spends the reader's data
 * without asking and pulls their eye away from whatever they were reading — so this is where
 * someone who wants the scrolling-video behaviour turns it on.
 *
 * Shorts is exempt: that page is a video surface the reader navigated to deliberately, so it
 * always plays.
 */
export default function PlaybackPreference() {
  const autoplay = useAutoplayPreference()

  return (
    <div className={styles.playback}>
      <header className={styles.playback__header}>
        <span className={styles.playback__icon}>
          <PlayCircleIcon size={22} />
        </span>
        <div>
          <h4 className={styles.playback__title}>Playback</h4>
          <p className={styles.playback__subtitle}>Control how videos behave in your feed.</p>
        </div>
      </header>

      <div className={styles.playback__panel}>
        <label className={styles.playback__row}>
          <span className={styles.playback__copy}>
            <span className={styles.playback__label}>Autoplay videos</span>
            <span className={styles.playback__hint}>
              {autoplay
                ? 'Videos start as soon as they scroll into view.'
                : 'Videos wait on their thumbnail until you press play.'}
            </span>
          </span>

          <input
            type="checkbox"
            className={styles.playback__input}
            checked={autoplay}
            onChange={(event) => setAutoplayPreference(event.target.checked)}
          />
          <span className={clsx(styles.playback__switch, autoplay && styles.playback__switchOn)} aria-hidden="true">
            <span className={styles.playback__knob} />
          </span>
        </label>
      </div>
    </div>
  )
}
