'use client'

import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import MyAgents from './_components/MyAgents'
import styles from './page.module.scss'

export default function MyAgentsPage() {
  return (
    <>
      <PageTitle name="My agents" />
      <div className={clsx(styles.page, 'animate fade')}>
        <div className={clsx('__container', styles.page__container)} data-width="small">
          <MyAgents />
        </div>
      </div>
    </>
  )
}
