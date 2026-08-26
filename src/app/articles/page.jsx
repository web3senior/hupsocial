import PageTitle from '@/components/PageTitle'
import ArticlesDirectory from './_components/ArticlesDirectory'
import styles from './page.module.scss'

export const metadata = {
  title: 'Articles',
  description: 'Long-form writing on Hup — published onchain, readable by anyone.',
  alternates: { canonical: '/articles' },
  openGraph: {
    type: 'website',
    url: '/articles',
    siteName: process.env.NEXT_PUBLIC_NAME,
    locale: 'en_US',
    title: 'Articles',
    description: 'Long-form writing on Hup — published onchain, readable by anyone.',
  },
}

export default function Page() {
  return (
    <>
      <PageTitle name="Articles" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <ArticlesDirectory />
        </div>
      </div>
    </>
  )
}
