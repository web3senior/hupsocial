'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Web3 from 'web3'
import Icon from '../helper/MaterialIcon'
import { useAuth } from '@/contexts/AuthContext'
import Shimmer from '../helper/Shimmer'
import styles from './ConnectWallet.module.scss'


export default function ConnectWallet() {
  const auth = useAuth()

  return (
    <div className={`${styles.connect} d-flex align-items-center justify-content-end`}>
      {/* {!auth.walletConnected && <Shimmer style={{ width: `32px`, height: `32px`, borderRadius: `999px` }} />} */}

      {!auth.walletConnected && <button onClick={auth.connect}>Connect</button>}

      {auth.walletConnected && (
        <Link href={`/u/profile`}>
          <Profile addr={auth.accounts[0]} />
          {/* <ul className={`${styles['wallet']} d-flex flex-row align-items-center justify-content-end`}>
            <li className={`d-flex flex-row align-items-center justify-content-center`}>
              {auth.balance}
              <div style={{ color: `var(--LUKSO)` }}>
                <span>⏣</span>
                <small style={{ fontSize: `12px`, position: `relative`, top: `-1px` }}>LYX</small>
              </div>
            </li>
            <li className={`d-flex flex-row align-items-center justify-content-end`}>
              <Image
                className={`rounded`}
                alt={auth.profile && auth.profile.LSP3Profile?.name}
                title={auth.wallet && `${auth.wallet.slice(0, 4)}...${auth.wallet.slice(38)}`}
                width={40}
                height={40}
                priority
                src={`https://ipfs.io/ipfs/${auth.profile.LSP3Profile?.profileImage.length > 0 && auth.profile.LSP3Profile.profileImage[0].url.replace('ipfs://', '').replace('://', '')}`}
              />
              <span>{`${auth.wallet.slice(0, 4)}...${auth.wallet.slice(38)}`}</span>
              <Icon name={'keyboard_arrow_down'} />
            </li>
          </ul> */}
        </Link>
      )}
    </div>
  )
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
      <figure className={`${styles.pfp} d-f-c flex-column grid--gap-050`}>
        <img alt={`Default PFP`} src={`https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`} className={`rounded`} />
      </figure>
    )

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
