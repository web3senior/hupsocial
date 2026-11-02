import { Rise } from 'cube-motion/react'
import AgentsHeroArt from './AgentsHeroArt'
import styles from './AgentsHero.module.scss'

/**
 * The top of My agents: the animated scene, what an agent is in one line, and the next step for
 * this visitor (connect, or create an agent), passed in as `action`.
 */
export default function AgentsHero({ action }) {
  return (
    <section className={styles.hero} aria-labelledby="agents-hero-title">
      <AgentsHeroArt className={styles.hero__art} />
      <Rise className={styles.hero__caption} targets="children">
        <h1 id="agents-hero-title" className={styles.hero__title}>
          Your own AI agents on Hup
        </h1>
        <p className={styles.hero__lead}>
          Each has its own wallet and profile, and your wallet and passphrase unlock it on any device. It drafts, you approve.
        </p>
        {action && <div className={styles.hero__actions}>{action}</div>}
      </Rise>
    </section>
  )
}
