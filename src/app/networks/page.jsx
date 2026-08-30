import Link from 'next/link'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { config } from '@/config/wagmi'
import { getDeployment, hupContractCount } from './_components/contractCatalog'
import styles from './page.module.scss'

export default function Page() {
  const chains = config.chains || []
  const mainnets = chains.filter((chain) => !chain.testnet)
  const testnets = chains.filter((chain) => chain.testnet)

  return (
    <>
      <PageTitle name={`Networks`} />
      <div className={styles.page}>
        <div className={clsx('__container', styles.page__container)} data-width={`medium`}>
          <NetworkSection title={`Mainnets`} chains={mainnets} />
          <NetworkSection title={`Testnets`} chains={testnets} />
        </div>
      </div>
    </>
  )
}

const NetworkSection = ({ title, chains }) => {
  if (!chains.length) return null

  return (
    <section className={styles.page__section}>
      <h2 className={styles['page__section-title']}>
        {title}
        <span className={styles['page__section-count']}>{chains.length}</span>
      </h2>
      <div className={`grid grid--fill gap-1`} style={{ '--data-width': `220px` }}>
        {chains.map((chain) => (
          <NetworkCard key={chain.id} chain={chain} />
        ))}
      </div>
    </section>
  )
}

const NetworkCard = ({ chain }) => {
  const count = hupContractCount(getDeployment(chain.id))

  return (
    <Link href={`/networks/${chain.id}`} className={styles.card} style={{ '--network-accent': chain.primaryColor }} title={`View details`}>
      <div className={styles.card__top}>
        <div className={styles.card__icon}>
          <img src={chain.iconUrl} alt="" />
        </div>
        <span className={clsx(styles.card__count, count === 0 && styles['card__count--empty'])}>
          {count > 0 ? `${count} contract${count === 1 ? '' : 's'}` : `No contracts`}
        </span>
      </div>
      <span className={styles.card__name}>
        {chain.name}
        {chain.testnet && <span className={`lable lable-warning`}>TESTNET</span>}
      </span>
      <span className={styles.card__meta}>
        Chain {chain.id} · {chain.nativeCurrency?.symbol}
      </span>
    </Link>
  )
}
