'use client'

import PageTitle from '@/components/PageTitle'
import { POLLS_ENABLED } from '@/config/features'
import PollsDirectory from './_components/PollsDirectory'
import styles from './page.module.scss'

export default function PollsPage() {
  return (
    <>
      <PageTitle name="Polls" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {POLLS_ENABLED ? (
            <PollsDirectory />
          ) : (
            // The route stays reachable rather than 404ing: the nav link is hidden, so anyone
            // who lands here typed the URL or followed an old one, and "not yet" is a better
            // answer for them than "never existed"
            <div className={styles.page__soon}>
              <h1>Polls are coming soon</h1>
              <p>Ask a question, count the answers onchain. Not quite ready — check back shortly.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
