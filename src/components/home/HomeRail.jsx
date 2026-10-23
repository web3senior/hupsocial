'use client'

import WhatsHappening from './WhatsHappening'
import DropsRail from '@/components/DropsRail'
import styles from './HomeRail.module.scss'

/**
 * Trending posts beside the home feed on wide screens.
 * "Who to follow" lives in the feed itself (WhoToFollow), between posts.
 */
export default function HomeRail() {
  return (
    <div className={styles.rail}>
      <WhatsHappening />
      <DropsRail variant="sidebar" />
    </div>
  )
}
