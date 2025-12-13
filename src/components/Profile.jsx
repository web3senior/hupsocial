'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getProfile, getUniversalProfile } from '@/lib/api'
import { config } from '@/config/wagmi'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import {BlueCheckMarkIcon} from "@/components/Icons"
import web3 from 'web3'
import moment from 'moment'
import { toSvg } from 'jdenticon'
import { getActiveChain } from '@/lib/communication'
import styles from './Profile.module.scss'

moment.defineLocale('en-short', {
  relativeTime: {
    future: 'in %s',
    past: '%s', //'%s ago'
    s: '1s',
    ss: '%ds',
    m: '1m',
    mm: '%dm',
    h: '1h',
    hh: '%dh',
    d: '1d',
    dd: '%dd',
    M: '1mo',
    MM: '%dmo',
    y: '1y',
    yy: '%dy',
  },
})

/**
 * Profile
 * @param {String} creator
 * @returns
 */
export default function Profile({ creator, createdAt }) {
  const [profile, setProfile] = useState()
  const [isItUp, setIsItUp] = useState()
  const activeChain = getActiveChain()
  const defaultUsername = `hup-user`
  //   const { web3, contract } = initPostContract()
  const router = useRouter()

  useEffect(() => {
    getUniversalProfile(creator).then((res) => {
      // console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0&& res.data.Profile[0].isContract) {
        setIsItUp(true)
        setProfile({
          wallet: res.data.id,
          name: res.data.Profile[0].name,
          description: res.data.description,
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.tags),
          links: JSON.stringify(res.data.links_),
          lastUpdate: '',
        })
      } else {
        getProfile(creator).then((res) => {
          //  console.log(res)
          if (res.wallet) {
            const profileImage = res.profileImage !== '' ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}` : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
            res.profileImage = profileImage
            setProfile(res)
          }
        })
      }
    })
    //${toSvg(`${creator}`, 36)}
  }, [])

  if (!profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        <div className={`flex flex-column justify-content-between gap-025`}>
          <span className={`shimmer rounded`} style={{ width: `60px`, height: `10px` }} />
          <span className={`shimmer rounded`} style={{ width: `40px`, height: `10px` }} />
        </div>
      </div>
    )

  return (
    <figure
      className={`${styles.profile} flex align-items-center`}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/u/${creator}`)
      }}
    >
      {/* profile.profileImages[0]?.isSVG */}
      {/* <div dangerouslySetInnerHTML={{ __html: profile.profileImages[0].src }}></div> */}

      <img alt={profile.name || `Default PFP`} src={`${profile.profileImage}`} className={`rounded`} />

      <figcaption className={`flex flex-column`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.name ?? defaultUsername}</b>
          <img alt={`checkmark icon`} src={blueCheckMarkIcon.src} />
          <div className={`${styles.badge}`} title={activeChain && activeChain[0].name} 
          dangerouslySetInnerHTML={{ __html: `${activeChain && activeChain[0].icon}` }}></div>
          <small className={`text-secondary`}>{moment.unix(web3.utils.toNumber(createdAt)).utc().fromNow()}</small>
        </div>
        <code className={`text-secondary`}>{`${creator.slice(0, 4)}…${creator.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}

export function ProfileImage({ addr }) {
  const [profile, setProfile] = useState()
  const [isItUp, setIsItUp] = useState()
  const defaultUsername = `hup-user`
  //   const { web3, contract } = initPostContract()
  const router = useRouter()

  useEffect(() => {
    getUniversalProfile(addr).then((res) => {
     console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setIsItUp(true)
        setProfile({
          wallet: res.data.id,
          name: res.data.Profile[0].name,
          description: res.data.description,
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.tags),
          links: JSON.stringify(res.data.links_),
          lastUpdate: '',
        })
      } else {
        getProfile(creator).then((res) => {
       console.log(res)
          if (res.wallet) {
            const profileImage = res.profileImage !== '' ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}` : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
            res.profileImage = profileImage
            setProfile(res)
          }
        })
      }
    })
  }, [])

  if (!profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        <div className={`flex flex-column justify-content-between gap-025`}>
          <span className={`shimmer rounded`} style={{ width: `60px`, height: `10px` }} />
          <span className={`shimmer rounded`} style={{ width: `40px`, height: `10px` }} />
        </div>
      </div>
    )

  return (
    <figure
      className={`${styles.profile} flex align-items-center`}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/u/${creator}`)
      }}
    >
      <img alt={profile.name || `Default PFP`} src={`${profile.profileImage}`} className={`rounded`} />
      {/* {!profile.profileImages[0]?.isSVG ? (
        <img
          alt={profile.name || `Default PFP`}
          src={`${profile.profileImages.length > 0 ? profile.profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: profile.profileImages[0].src }}></div>
      )} */}
    </figure>
  )
}
