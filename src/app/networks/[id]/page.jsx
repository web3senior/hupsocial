import Link from 'next/link'
import { useParams } from 'next/navigation'
import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'

export default function Page() {
  const params = useParams()
  const id = params.id

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
            return (
              <div key={i} className={`${styles.network}`} title={item.rpcUrls.default.http[0]}>
                <div className={`${styles.network__body} d-f-c flex-row justify-content-between gap-025`} style={{ '--bg-color': `${item.primaryColor}` }}>
                  <div className={`flex flex-column align-items-center justify-content-start gap-050 flex-1`}>
                    <div className={`${styles.network__icon}`} dangerouslySetInnerHTML={{ __html: item.icon }} />
                    <h3>{item.name}</h3>
                    <table>
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
                          <td>{item.nativeCurrency.symbol}</td>
                        </tr>
                        <tr>
                          <td>RPC</td>
                          <td>
                            <code>{item.rpcUrls.default.http[0]}</code>
                          </td>
                        </tr>
                        <tr>
                          <td>Block Eplorer</td>
                          <td>
                            <a href={item.blockExplorers.default.url} target="_blank" rel="noopener noreferrer">
                              {item.blockExplorers.default.url} ↗
                            </a>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <Link href={`/networks`}>&larr; Back to all networks</Link>
                  </div>
                </div>
              </div>
            )
          })}
    </>
  )
}
