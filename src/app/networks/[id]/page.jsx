import React from 'react'
import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'


export default async function Page({ params }) {
  const id = (await params).id
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
                    <span>{item.name}</span>
                    <span className={`lable lable-dark`}>{item.nativeCurrency.symbol}</span>
                    <code>{item.rpcUrls.default.http[0]}</code>
                    <a href={item.blockExplorers.default.url} target="_blank" rel="noopener noreferrer">
                      {item.blockExplorers.default.url}↗️
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
    </>
  )
}