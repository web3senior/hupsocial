'use client'

import { useEffect, useState } from 'react'
import { networks } from '@/config/wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { useAccount, useDisconnect, Connector, useConnect } from 'wagmi'
import Shimmer from '@/helper/Shimmer'
import styles from './ConnectWallet.module.scss'

export const ConnectWallet = () => {
  const [showModal, setShowModal] = useState(false)
  const { disconnect } = useDisconnect()
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()

  // const handleDisconnect = async () => {
  //   try {
  //     await disconnect()
  //   } catch (error) {
  //     console.error('Failed to disconnect:', error)
  //   }
  // }

  return !mounted ? null : (
    <div>
      {!isConnected ? (
        <>
          <button className={`flex align-items-center gap-025 `} onClick={() => setShowModal(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
              <path d="M224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38V-680H544.62q-47.93 0-76.27 28.35Q440-623.31 440-575.38v190.76q0 47.93 28.35 76.27Q496.69-280 544.62-280H800v55.38q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm320-160q-27.62 0-46.12-18.5Q480-357 480-384.62v-190.76q0-27.62 18.5-46.12Q517-640 544.62-640h230.76q27.62 0 46.12 18.5Q840-603 840-575.38v190.76q0 27.62-18.5 46.12Q803-320 775.38-320H544.62ZM640-420q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z" />
            </svg>
            Connect
          </button>
        </>
      ) : (
        <div className={`flex gap-050`}>
          <Profile addr={address} />
          <button onClick={() => disconnect()}>Disconnect</button>
        </div>
      )}
      {showModal && <WalletConnectModal setShowModal={setShowModal} />}
    </div>
  )
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
    <div className={`__container`} data-width={`small`}>
      <figure className={`${styles.pfp} d-f-c flex-column grid--gap-050`}>
        <img
          alt={data.data.search_profiles[0].fullName}
          src={`${data.data.search_profiles[0].profileImages.length > 0 ? data.data.search_profiles[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
        {/* <figcaption>@{data.data.search_profiles[0].name}</figcaption> */}
      </figure>
      {/* <div className={`text-center text-dark`}>
        <div className={`card__body`} style={{ padding: `0rem` }}>
          <small>{data.data.search_profiles[0].description}</small>
        </div>
      </div> */}
    </div>
  )
}
