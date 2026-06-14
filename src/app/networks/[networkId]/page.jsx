import Link from 'next/link'
import { config, CONTRACTS } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import { slugify } from '@/lib/utils'
import styles from './page.module.scss'

export default async function Page({ params }) {
  const id = (await params).networkId

  return (
    <>
      <PageTitle name={`networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <NetworkDetails id={id} />
        </div>
      </div>
    </>
  )
}

const NetworkDetails = ({ id }) => {
  return (
    <>
      {config.chains &&
        config.chains
          .filter((filterItem) => filterItem.id.toString() === id.toString())
          .map((item, i) => {
            // Find specific contract set for this matching chain ID
            const contractKey = `chain${item.id}`
            const deployment = CONTRACTS[contractKey]

            // Extract base block explorer URL for target formatting link setups
            const explorerUrl = item.blockExplorers?.default?.url?.replace(/\/$/, '')

            return (
              <div key={i} className={`${styles.network}`} title={item.rpcUrls.default.http[0]}>
                <div
                  className={`${styles.network__body} d-f-c flex-row justify-content-between gap-025`}
                  style={{ '--bg-color': `${item.primaryColor}` }}
                >
                  <div className={`flex flex-column align-items-center justify-content-start gap-050 flex-1`}>
                    <div className={`${styles.network__icon}`} dangerouslySetInnerHTML={{ __html: item.icon }} />
                    <h3>{item.name}</h3>

                    <table className={`mt-10 mb-10`}>
                      <thead>
                        <tr>
                          <th width="30%">Setting</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Name</td>
                          <td>
                            {item.name}
                            {item.testnet && <span className={`lable lable-warning ml-10`}>TESTNET</span>}
                          </td>
                        </tr>
                        <tr>
                          <td>Chain Id</td>
                          <td>{item.id}</td>
                        </tr>
                        <tr>
                          <td>Currency Symbol</td>
                          <td>{item.nativeCurrency?.symbol}</td>
                        </tr>
                        <tr>
                          <td>RPC</td>
                          <td>
                            <code>{item.rpcUrls.default.http[0]}</code>
                          </td>
                        </tr>
                        <tr>
                          <td>Block Explorer</td>
                          <td>
                            {explorerUrl ? (
                              <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                                {explorerUrl} ↗
                              </a>
                            ) : (
                              'N/A'
                            )}
                          </td>
                        </tr>

                        {/* Dynamic contract links mapped straight to the active network explorer base URL */}
                        {deployment && (
                          <>
                            <tr>
                              <td>Forwarder Contract</td>
                              <td>
                                {explorerUrl ? (
                                  <a href={`${explorerUrl}/address/${deployment.forwarder}`} target="_blank" rel="noopener noreferrer">
                                    <code>{deployment.forwarder}</code> ↗
                                  </a>
                                ) : (
                                  <code>{deployment.forwarder}</code>
                                )}
                              </td>
                            </tr>
                            <tr>
                              <td>Hub Contract</td>
                              <td>
                                {explorerUrl ? (
                                  <a href={`${explorerUrl}/address/${deployment.hup}`} target="_blank" rel="noopener noreferrer">
                                    <code>{deployment.hup}</code> ↗
                                  </a>
                                ) : (
                                  <code>{deployment.hup}</code>
                                )}
                              </td>
                            </tr>
                            <tr>
                              <td>Status Contract</td>
                              <td>
                                {explorerUrl ? (
                                  <a href={`${explorerUrl}/address/${deployment.status}`} target="_blank" rel="noopener noreferrer">
                                    <code>{deployment.status}</code> ↗
                                  </a>
                                ) : (
                                  <code>{deployment.status}</code>
                                )}
                              </td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>

                    <Link href={`/chains`}>&larr; Back to all networks</Link>
                  </div>
                </div>
              </div>
            )
          })}
    </>
  )
}
