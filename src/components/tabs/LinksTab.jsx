import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { getUniversalProfile, getProfile } from '@/lib/api'
import styles from './LinksTab.module.scss'
import NoData from '../NoData'

/**
 * LinksTab Component
 * Renders a list of external links associated with a user's wallet profile.
 */
export default function LinksTab() {
  const [data, setData] = useState(null)
  const [links, setLinks] = useState([])
  const params = useParams()

  useEffect(() => {
    // Return early if no wallet address is provided in the parameters
    if (!params?.wallet) return

    getUniversalProfile(params.wallet).then((res) => {
      console.log('Universal profile response:', res)
      
      if (res?.Profile?.length > 0 && res.Profile[0].isContract) {

        const profile = res.Profile[0]
        let parsedLinks = []
        
        try {
          parsedLinks = typeof profile.links === 'string' ? JSON.parse(profile.links) : (profile.links || [])
        } catch (error) {
          console.error('Failed to parse universal profile links:', error)
        }

        setLinks(parsedLinks)
        setData({
          wallet: profile.id,
          name: profile.name,
          description: profile.description,
          profileImage: profile.profileImages?.length > 0 ? profile.profileImages[0].src : '',
          profileHeader: '',
          tags: profile.tags || [],
          lastUpdate: '',
        })
      } else {
        getProfile(params.wallet).then((fallbackRes) => {
          console.log('Standard profile response:', fallbackRes)
          
          if (fallbackRes?.wallet_address) {
            let parsedLinks = []
            try {
              parsedLinks = typeof fallbackRes.links === 'string' ? JSON.parse(fallbackRes.links) : (fallbackRes.links || [])
            } catch (error) {
              console.error('Failed to parse standard profile links:', error)
            }

            fallbackRes.profileImageName = fallbackRes.profileImage
            fallbackRes.profileImage = `${process.env.NEXT_PUBLIC_UPLOAD_URL}${fallbackRes.profileImage}`
            
            setLinks(parsedLinks)
            setData(fallbackRes)
          }
        })
      }
    })
  }, [params?.wallet])

  // Display skeleton shimmers while loading data
  if (!data) {
    return (
      <div className="flex flex-column gap-1">
        <div className={`shimmer ${styles.linkShimmer}`} />
        <div className={`shimmer ${styles.linkShimmer}`} />
        <div className={`shimmer ${styles.linkShimmer}`} />
      </div>
    )
  }

  // Display empty state if no links exist
  if (links.length === 0) {
    return <NoData name="links" />
  }

  return (
    <div className={styles.links}>
      {links.map((link, index) => {
        const targetUrl = link.url.startsWith('http') ? link.url : `//${link.url}`
        
        return (
          <a
            key={index}
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-row align-items-center justify-content-between"
          >
            <div className="flex flex-column">
              <p>{link.title || link.name}</p>
              <code>{link.url}</code>
            </div>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.16531 14.625L3.375 13.8347L11.9597 5.25H6.75V4.125H13.875V11.25H12.75V6.04031L4.16531 14.625Z" fill="#424242" />
            </svg>
          </a>
        )
      })}
    </div>
  )
}