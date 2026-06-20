import PageTitle from '@/components/PageTitle'
import LikedPosts from './_components/LikedPosts'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`Liked`} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <LikedPosts />
        </div>
      </div>
    </>
  )
}
