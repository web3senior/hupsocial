'use client'

import { useEffect, useState } from 'react'
import { networks } from '@/config/wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import { useAccount, useDisconnect, Connector, useConnect } from 'wagmi'
import Shimmer from '@/helper/Shimmer'
import Link from 'next/link'
import styles from './ConnectWallet.module.scss'

export const ConnectWallet = () => {
  const [showModal, setShowModal] = useState(false)
  const [showNetworks, setShowNetworks] = useState(false)
  const { disconnect } = useDisconnect()
  const [chains, setChains] = useState()
  const [defaultChain, setDefaultChain] = useState()
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()

  // const handleDisconnect = async () => {
  //   try {
  //     await disconnect()
  //   } catch (error) {
  //     console.error('Failed to disconnect:', error)
  //   }
  // }

  useEffect(() => {
    setChains(config.chains)
    setDefaultChain(config.chains.filter((filterItem) => filterItem.name === `LUKSO Testnet`)[0])
  }, [])

  return !mounted ? null : (
    <>
      {!isConnected && (
        <button className={`flex align-items-center gap-025 `} onClick={() => setShowModal(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
            <path d="M224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38V-680H544.62q-47.93 0-76.27 28.35Q440-623.31 440-575.38v190.76q0 47.93 28.35 76.27Q496.69-280 544.62-280H800v55.38q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm320-160q-27.62 0-46.12-18.5Q480-357 480-384.62v-190.76q0-27.62 18.5-46.12Q517-640 544.62-640h230.76q27.62 0 46.12 18.5Q840-603 840-575.38v190.76q0 27.62-18.5 46.12Q803-320 775.38-320H544.62ZM640-420q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z" />
          </svg>
          Connect
        </button>
      )}

    
        {isConnected && chains && defaultChain && (
          <div className={`${styles.networks}`}>
            <button onClick={(e) => setShowNetworks(!showNetworks)} title={`${defaultChain.name}`}>
              <span className={`rounded`} dangerouslySetInnerHTML={{ __html: defaultChain.icon }} />
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {showNetworks && (
              <div className={`${styles.dropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}>
                <ul>
                  {chains.map((item, i) => (
                    <li key={i} onClick={() => setShowNetworks(false)}
                    disabled={item.name !== `LUKSO Testnet`} className={`flex flex-row align-items-center justify-content-start gap-050`} disabled={item.name !== `LUKSO Testnet`}>
                      <figure className={`rounded`}  dangerouslySetInnerHTML={{ __html: item.icon }} />
                      <small>{item.name}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <Profile addr={address} />


      {showModal && <WalletConnectModal setShowModal={setShowModal} />}
    </>
  )
}
{
  /* <Link href={`/networks`} title={`Networks`}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M8.4375 12.5625H9.5625V8.25H8.4375V12.5625ZM9 6.96637C9.17163 6.96637 9.3155 6.90831 9.43163 6.79219C9.54775 6.67606 9.60581 6.53219 9.60581 6.36056C9.60581 6.18894 9.54775 6.04506 9.43163 5.92894C9.3155 5.81294 9.17163 5.75494 9 5.75494C8.82838 5.75494 8.6845 5.81294 8.56838 5.92894C8.45225 6.04506 8.39419 6.18894 8.39419 6.36056C8.39419 6.53219 8.45225 6.67606 8.56838 6.79219C8.6845 6.90831 8.82838 6.96637 9 6.96637ZM9.00131 16.125C8.01581 16.125 7.0895 15.938 6.22237 15.564C5.35525 15.19 4.601 14.6824 3.95962 14.0413C3.31825 13.4002 2.81044 12.6463 2.43619 11.7795C2.06206 10.9128 1.875 9.98669 1.875 9.00131C1.875 8.01581 2.062 7.0895 2.436 6.22237C2.81 5.35525 3.31756 4.601 3.95869 3.95962C4.59981 3.31825 5.35375 2.81044 6.2205 2.43619C7.08725 2.06206 8.01331 1.875 8.99869 1.875C9.98419 1.875 10.9105 2.062 11.7776 2.436C12.6448 2.81 13.399 3.31756 14.0404 3.95869C14.6818 4.59981 15.1896 5.35375 15.5638 6.2205C15.9379 7.08725 16.125 8.01331 16.125 8.99869C16.125 9.98419 15.938 10.9105 15.564 11.7776C15.19 12.6448 14.6824 13.399 14.0413 14.0404C13.4002 14.6818 12.6463 15.1896 11.7795 15.5638C10.9128 15.9379 9.98669 16.125 9.00131 16.125ZM9 15C10.675 15 12.0938 14.4188 13.2563 13.2563C14.4188 12.0938 15 10.675 15 9C15 7.325 14.4188 5.90625 13.2563 4.74375C12.0938 3.58125 10.675 3 9 3C7.325 3 5.90625 3.58125 4.74375 4.74375C3.58125 5.90625 3 7.325 3 9C3 10.675 3.58125 12.0938 4.74375 13.2563C5.90625 14.4188 7.325 15 9 15Z"
                      fill="#1F1F1F"
                    />
                  </svg>
                </Link> */
}
export function WalletConnectModal({ setShowModal }) {
  return (
    <div className={`${styles.walletConnectModal}`} onClick={() => setShowModal(false)}>
      <WalletOptions />
    </div>
  )
}

export function WalletOptions() {
  const { connectors, connect } = useConnect()

  return connectors.map((connector) => (
    <button className={`${styles['wallet']}`} key={connector.uid} onClick={() => connect({ connector })}>
      {connector.name}
    </button>
  ))
}

/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Profile = ({ addr }) => {
  const [data, setData] = useState()

  const getProfile = async (addr) => {
    const myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify({
        query: `query MyQuery {
  search_profiles(
    args: {search: "${addr}"}
    limit: 1
  ) {
    fullName
    name
    description
    id
    profileImages {
      src
    }
  }
}`,
      }),
    }
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}`, requestOptions)
    if (!response.ok) {
      throw new Response('Failed to ', { status: 500 })
    }
    const data = await response.json()
    setData(data)
    return data
  }

  useEffect(() => {
    getProfile(addr).then(console.log)
  }, [])

  if (!data || data.data?.search_profiles.length === 0) return <Shimmer style={{ width: `32px`, height: `32px`, borderRadius: `999px` }} />

  return (
    <Link href={`/u/${addr}`}>
      <figure className={`${styles.pfp} d-f-c flex-column grid--gap-050 rounded`} title={data.data.search_profiles[0].name}>
        <img
          alt={data.data.search_profiles[0].fullName}
          src={`${data.data.search_profiles[0].profileImages.length > 0 ? data.data.search_profiles[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
      </figure>
    </Link>
  )
}
