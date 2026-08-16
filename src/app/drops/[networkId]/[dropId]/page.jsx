import PageTitle from '@/components/PageTitle'
import DropDetails from './_components/DropDetails'
import styles from './page.module.scss'

// Unlike the listing page there is no indexed API to ask for a title — drop state lives
// onchain only, and the client component reads it there. The static title is enough for
// the tab; DropDetails re-titles once the collection name resolves.
export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { dropId } = await params

  return {
    title: `NFT drop #${dropId}`,
    description: parentMetadata.description || 'Mint NFT drops inside posts on Hup.',
  }
}

export default async function Page({ params }) {
  const { networkId, dropId } = await params

  return (
    <>
      {/* Header clearance + initial title, like the NFT listing page — the spacer must sit
          outside the rounded container. DropDetails re-titles with the drop's name once
          the collection resolves, spacerless so the gap never doubles. */}
      <PageTitle name={`NFT drop #${dropId}`} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <DropDetails networkId={networkId} dropId={dropId} />
        </div>
      </div>
    </>
  )
}
