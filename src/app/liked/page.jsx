import { Suspense } from 'react'
import PageTitle from '@/components/PageTitle'
import LikedPosts from './_components/LikedPosts'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Liked`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <Suspense fallback={<div>Loading activity system...</div>}>
            <LikedPosts />
          </Suspense>
        </div>
      </div>
    </>
  )
}
