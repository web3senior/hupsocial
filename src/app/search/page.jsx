'use client'

import PageTitle from '@/components/PageTitle'
import SearchPanel from './_components/SearchPanel'
import styles from './page.module.scss'

export default function SearchPage() {
  return (
    <>
      <PageTitle name="Search" />
      <div className={`${styles.page} animate fade`}>
        <SearchPanel />
      </div>
    </>
  )
}
