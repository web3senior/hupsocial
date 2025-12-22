import PageTitle from '@/components/PageTitle'
import PostForm from '@/components/PostForm'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`New post`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <PostForm />
        </div>
      </div>
    </>
  )
}