import Link from 'next/link'
import clsx from 'clsx'
import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import CopyButton from '@/components/ui/CopyButton'
import { coreRows, featureRows, getDeployment, swapRows } from '../_components/contractCatalog'
import styles from './page.module.scss'

export default async function Page({ params }) {
  const { networkId } = await params
  const chain = (config.chains || []).find((item) => item.id.toString() === networkId.toString())

  return (
    <>
      <PageTitle name={chain ? chain.name : `Networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={clsx('__container', styles.page__container)} data-width={`medium`}>
          {chain ? <NetworkDetails chain={chain} /> : <NetworkNotFound />}
        </div>
      </div>
    </>
  )
}

const NetworkNotFound = () => (
  <div className={styles.empty}>
    <p>This network is not part of Hup.</p>
    <Link href={`/networks`}>&larr; Back to all networks</Link>
  </div>
)

const NetworkDetails = ({ chain }) => {
  const deployment = getDeployment(chain.id)
  // Base explorer URL every address row links against
  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
  const rpcUrl = chain.rpcUrls?.default?.http?.[0]

  const groups = [
    { title: `Core`, description: `The social engine and the plumbing every feature relies on`, rows: coreRows(deployment) },
    { title: `Features`, description: `Extensions deployed on this network`, rows: featureRows(deployment) },
    { title: `Swap venues`, description: `Third-party contracts the swap page routes through`, rows: swapRows(deployment) },
  ].filter((group) => group.rows.length > 0)

  return (
    <div className={styles.network}>
      <header className={styles.network__header} style={{ '--bg-color': chain.primaryColor }}>
        <div className={styles.network__icon}>
          <img src={chain.iconUrl} alt="" />
        </div>
        <h3 className={styles.network__name}>
          {chain.name}
          {chain.testnet && <span className={`lable lable-warning`}>TESTNET</span>}
        </h3>
        <span className={styles.network__meta}>
          Chain {chain.id} · {chain.nativeCurrency?.symbol}
        </span>
      </header>

      <section className={styles.network__section}>
        <h4 className={styles['network__section-title']}>Network</h4>
        <div className={styles.rows}>
          <InfoRow label={`Chain ID`} value={chain.id} copyValue={`${chain.id}`} />
          <InfoRow label={`Currency`} value={`${chain.nativeCurrency?.name} (${chain.nativeCurrency?.symbol})`} />
          <InfoRow label={`RPC`} value={<code>{rpcUrl}</code>} copyValue={rpcUrl} />
          <InfoRow
            label={`Block explorer`}
            value={
              explorerUrl ? (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  {explorerUrl} ↗
                </a>
              ) : (
                `N/A`
              )
            }
          />
          {/* Mainnet chain objects also carry faucetUrl (pointing at their testnet's faucet), so gate on testnet */}
          {chain.testnet && chain.faucetUrl && (
            <InfoRow
              label={`Faucet`}
              value={
                <a href={chain.faucetUrl} target="_blank" rel="noopener noreferrer">
                  {chain.faucetUrl} ↗
                </a>
              }
            />
          )}
          {deployment?.nativeIsErc20 && (
            <InfoRow label={`Note`} value={`The native coin is itself an ERC20 — swaps approve it instead of sending value.`} />
          )}
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.title} className={styles.network__section}>
          <h4 className={styles['network__section-title']}>
            {group.title}
            <span className={styles['network__section-count']}>{group.rows.length}</span>
          </h4>
          <p className={styles['network__section-description']}>{group.description}</p>
          <div className={styles.rows}>
            {group.rows.map((row) => (
              <AddressRow key={row.key} row={row} explorerUrl={explorerUrl} />
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 && <p className={styles.empty}>No Hup contracts are deployed on this network yet.</p>}

      <Link href={`/networks`} className={styles.network__back}>
        &larr; Back to all networks
      </Link>
    </div>
  )
}

const InfoRow = ({ label, value, copyValue }) => (
  <div className={styles.row}>
    <div className={styles.row__info}>
      <span className={styles.row__label}>{label}</span>
    </div>
    <div className={styles.row__value}>
      {value}
      {copyValue && <CopyButton value={copyValue} title={`Copy ${label.toLowerCase()}`} className={styles.row__copy} />}
    </div>
  </div>
)

const AddressRow = ({ row, explorerUrl }) => (
  <div className={styles.row}>
    <div className={styles.row__info}>
      <span className={styles.row__label}>{row.label}</span>
      {row.description && <span className={styles.row__description}>{row.description}</span>}
    </div>
    <div className={styles.row__value}>
      {explorerUrl ? (
        <a href={`${explorerUrl}/address/${row.address}`} target="_blank" rel="noopener noreferrer" title={`View on explorer`}>
          <code>{row.address}</code> ↗
        </a>
      ) : (
        <code>{row.address}</code>
      )}
      <CopyButton value={row.address} title={`Copy address`} className={styles.row__copy} />
    </div>
  </div>
)
