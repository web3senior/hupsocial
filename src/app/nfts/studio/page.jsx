import PageTitle from '@/components/PageTitle'
import CollectionStudio from './_components/CollectionStudio'
import styles from './page.module.scss'

export const metadata = {
  title: 'Studio',
  description: 'Edit the metadata of any NFT collection you own, wherever it was launched.',
}

export default function CollectionStudioPage() {
  return (
    <>
      <PageTitle name="Studio" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <CollectionStudio />
        </div>
      </div>
    </>
  )
}
