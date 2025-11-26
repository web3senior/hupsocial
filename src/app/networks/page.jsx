'use client'

import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import PageTitle from '@/components/PageTitle'
import Web3 from 'web3'
import styles from './page.module.scss'

export default function Page() {
  /**
   * Add network
   * @param {json} network
   * @returns
   */
  const addNetwork = async (network) => {
    const ethereum = window.ethereum

    if (!ethereum) {
      toast('No extension detected.')
      return
    }

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: Web3.utils.toHex(network.id) }],
      })
      toast('Your extension is now connected to LUKSO network.', `success`)
    } catch (switchError) {
      // This error code indicates that the chain has not been added to MetaMask.
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: Web3.utils.toHex(network.id), //'0x2A',
                chainName: network.name,
                nativeCurrency: {
                  name: network.nativeCurrency.name,
                  symbol: network.nativeCurrency.symbol,
                  decimals: network.nativeCurrency.decimals,
                },
                rpcUrls: network.rpcUrls.default.http,
                blockExplorerUrls: network.blockExplorers.default.url,
              },
            ],
          })
        } catch (addError) {
          toast(addError.message)
        }
      } else {
        toast(switchError.message)
      }
    }
  }

  return (
    <>
      <PageTitle name={`networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container`} data-width={`medium`}>
          <div className={`grid grid--fill gap-1`} style={{ '--data-width': `400px` }}>
            {config.chains &&
              config.chains.map((item, i) => {
                return (
                  <div key={i} className={`${styles.network}`} title={item.rpcUrls.default.http[0]}>
                    <div className={`${styles.network__body} d-f-c flex-row justify-content-between gap-025`}>
                      <div className={`flex flex-row align-items-center justify-content-start gap-1 flex-1`}>
                        <div className={`rounded ${styles.network__icon}`} dangerouslySetInnerHTML={{ __html: item.icon }} />
                       <span>{item.name}</span>
                      </div>

                      <button className={styles.button} onClick={(e) => addNetwork(item)}>
                        Add network
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </>
  )
}
