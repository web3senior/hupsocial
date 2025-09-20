'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Web3 from 'web3'
import Icon from '../helper/MaterialIcon'
import Shimmer from '../helper/Shimmer'
import styles from './CartButton.module.scss'

export default function CartButton() {
  const [cart, setCart] = useState(0)
  const [visibleSearch, setVisibleSearch] = useState(false)
  const [userSignedIn, setUserSignedIn] = useState('/sign-in')
  /**
   * Get cart from Localstorage
   * @returns
   */
  const getCart = async () => await JSON.parse(localStorage.getItem(`cart`))

  useEffect(() => {
    getCart().then((res) => {
      if (res !== null) setCart(res.length)
    })

    if (localStorage.getItem('token') !== null) {
      getIsValidToken().then((result) => {
        if (result) setUserSignedIn('/user/dashboard')
      })
    }
  }, [])

  return (
    <div className={`${styles.cart} d-flex align-items-center justify-content-end`}>
      <span id={`cartCount`}>{cart}</span>
      {/* {auth.status === `loading` && <Shimmer style={{ width: `250px`, height: `45px` }} />}
      
      {!auth.wallet && <button onClick={auth.connect}>Connect</button>} */}
      <Image src="/cart.svg" alt={`Cart Icon`} width={18} height={18} priority />
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

  if (!data)
    return (
      <>
        <figure className={`${styles.pfp} d-f-c flex-column grid--gap-050`}>

          <figcaption>@username</figcaption>
        </figure>
      </>
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
