import MarketDetail from './_components/MarketDetail'
import styles from './page.module.scss'

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  return {
    title: 'Prediction market',
    description: parentMetadata.description || 'Bet on outcomes with friends on Hup.',
  }
}

export default async function Page({ params }) {
  const { networkId, marketId } = await params

  return (
    <div className={styles.page}>
      <div className={`__container ${styles.page__container}`} data-width="small">
        <MarketDetail networkId={networkId} marketId={marketId} />
      </div>
    </div>
  )
}
