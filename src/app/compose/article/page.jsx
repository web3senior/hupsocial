import PageTitle from '@/components/PageTitle'
import ArticleEditor from './_components/ArticleEditor'
import styles from './page.module.scss'

export const metadata = {
  title: 'Write an article',
  description: 'Write a long-form article and publish it onchain as a post.',
  /* A private drafting surface — there is nothing here for a crawler, and an indexed empty
     editor would only compete with the articles themselves in search results. */
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <>
      {/* showInHeader off: the editor renders its own <h1> right below the header, and the two
          stacked reads as the title printed twice. The spacer PageTitle provides is still wanted. */}
      <PageTitle name="Write an article" showInHeader={false} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <ArticleEditor />
        </div>
      </div>
    </>
  )
}
