'use client'

import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getProfile } from '@/util/api'
import { config } from '@/config/wagmi'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import web3 from 'web3'
import moment from 'moment'
import { toSvg } from 'jdenticon'
import {BlueCheckMarkIcon} from '@/components/Icons'
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
 * @param {String} addr
 * @returns
 */
export default function Profile({ creator, createdAt, chainId = 4201 }) {
  const [profile, setProfile] = useState()
  const [chain, setChain] = useState()
  const defaultUsername = `hup-user`
  //   const { web3, contract } = initPostContract()
  const router = useRouter()

  useEffect(() => {
    getProfile(creator).then((res) => {
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      } else {
        setProfile({
          data: {
            Profile: [
              {
                fullName: 'annonymous',
                name: 'annonymous',
                tags: ['profile'],
                profileImages: [
                  {
                    isSVG: true,
                    src: `${toSvg(`${creator}`, 36)}`,
                    url: 'ipfs://',
                  },
                ],
              },
            ],
          },
        })
      }
    })

    setChain(config.chains.filter((filterItem) => filterItem.id === chainId)[0])
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
      {!profile.data.Profile[0].profileImages[0]?.isSVG ? (
        <img
          alt={profile.data.Profile[0].name || `Default PFP`}
          src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: profile.data.Profile[0].profileImages[0].src }}></div>
      )}
      <figcaption className={`flex flex-column`}>
        <div className={`flex align-items-center gap-025`}>
          <b>{profile.data.Profile[0].name ?? defaultUsername}</b>
          <img alt={`blue checkmark icon`} src={blueCheckMarkIcon.src} />
          <div className={`${styles.badge}`} title={chain && chain.name} 
          dangerouslySetInnerHTML={{ __html: `${chain && chain.icon}` }}></div>
          <small className={`text-secondary`}>{moment.unix(web3.utils.toNumber(createdAt)).utc().fromNow()}</small>
        </div>
        <code className={`text-secondary`}>{`${creator.slice(0, 4)}…${creator.slice(38)}`}</code>
      </figcaption>
    </figure>
  )
}

export function ProfileImage({ addr }) {
  const [profile, setProfile] = useState()
  const [chain, setChain] = useState()
  const defaultUsername = `hup-user`
  //   const { web3, contract } = initPostContract()
  const router = useRouter()

  useEffect(() => {
    getProfile(addr).then((res) => {
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      } else {
        setProfile({
          data: {
            Profile: [
              {
                fullName: 'annonymous',
                name: 'annonymous',
                tags: ['profile'],
                profileImages: [
                  {
                    isSVG: true,
                    src: `${toSvg(`${addr}`, 36)}`,
                    url: 'ipfs://',
                  },
                ],
              },
            ],
          },
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
      {!profile.data.Profile[0].profileImages[0]?.isSVG ? (
        <img
          alt={profile.data.Profile[0].name || `Default PFP`}
          src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
          className={`rounded`}
        />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: profile.data.Profile[0].profileImages[0].src }}></div>
      )}
    </figure>
  )
}
