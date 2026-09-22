'use client'

import PageTitle from '@/components/PageTitle'
import TasksDirectory from './_components/TasksDirectory'
import styles from './page.module.scss'

export default function TasksPage() {
  return (
    <>
      <PageTitle name="Tasks" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <TasksDirectory />
        </div>
      </div>
    </>
  )
}
