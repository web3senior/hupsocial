'use client'

import { useMemo, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

export default function LeaderboardPage() {

  return (
    <>
      <PageTitle name="Events" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          {/* {renderContent()} */}
        </div>
      </div>
    </>
  )
}