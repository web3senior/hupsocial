import PageTitle from '@/components/PageTitle'
import LikedPosts from './_components/ShortsFeed'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Shorts`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <LikedPosts />
        </div>
      </div>
    </>
  )
}
