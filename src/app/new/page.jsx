import PageTitle from '@/components/PageTitle'
import PostForm from '@/components/PostForm'
import styles from './page.module.scss'

export default async function Page({ params, searchParams }) {
  const filter = await searchParams
  const text = filter.text || ''
  const url = filter.url || ''

  return (
    <>
      <PageTitle name={`New post`} />
      <div className={`${styles.page} motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <PostForm text={text} url={url} />
        </div>
      </div>
    </>
  )
}
