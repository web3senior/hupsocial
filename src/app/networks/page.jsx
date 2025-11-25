'use client'

import { useEffect, useState } from 'react'
import { toast } from '@/components/NextToast'
import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import Web3 from 'web3'
import styles from './page.module.scss'

export default function Page() {
  const [isLoading, setIsLoading] = useState(false)
  const [chains, setChains] = useState()

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

  useEffect(() => {
    setChains(config.chains)
  }, [])

  return (
    <>
      <PageTitle name={`networks (${config.chains.length})`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container`} data-width={`medium`}>
          <div className={`flex flex-column gap-1`}>
            {chains &&
              chains.map((item, i) => {
                return (
                  <div key={i} className={`${styles.network}`}>
                    <div className={`${styles.network__body}`}>
                      <ul className={`flex flex-column align-items-center justify-content-between gap-050`}>
                        <li className={``}>
                          <span>Network name</span>
                          <code>{item.name}</code>
                        </li>
                        <li className={``}>
                          <span> Default RPC URL</span>
                          <code>{item.rpcUrls.default.http[0]}</code>
                        </li>
                        <li className={``}>
                          <span> Chain ID</span>
                          <code>{item.id}</code>
                        </li>
                        <li className={``}>
                          <span> Currency symbol</span>
                          <code>{item.nativeCurrency.symbol}</code>
                        </li>
                        <li className={``}>
                          <span>Block explorer URL</span>
                          <code title={item.blockExplorers.default.name}>{item.blockExplorers.default.url}</code>
                        </li>
                        {item.faucetUrl && (
                          <li className={``}>
                            <span>Faucet URL</span>
                            <a href={item.faucetUrl} target={`_blank`}>
                              <code>{item.faucetUrl}</code>
                            </a>
                          </li>
                        )}
                        <li>
                          <button className={styles.button} onClick={(e) => addNetwork(item)}>
                            🦊 Add {item.name} network
                          </button>
                        </li>
                      </ul>
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
