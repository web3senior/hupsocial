import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile' // Adjust the import path as needed for your project structure
import styles from './LinksTab.module.scss'
import NoData from '../NoData'

/**
 * LinksTab Component
 * Renders a list of external links associated with a user's wallet profile.
 */
export default function LinksTab() {
  const [links, setLinks] = useState([])
  const params = useParams()

  // Extract the wallet address directly from url parameters
  const walletAddress = params?.wallet || ''

  // Fetch profile state directly using the custom hook
  const { profile, isLoading } = useProfile(walletAddress)

  useEffect(() => {
    // Return early if no profile structure or links are available
    if (!profile?.links) {
      setLinks([])
      return
    }

    let parsedLinks = []
    try {
      // Parse the links if they arrive formatted as a stringified JSON matrix
      parsedLinks = typeof profile.links === 'string' ? JSON.parse(profile.links) : profile.links || []
    } catch (error) {
      console.error('Failed to parse profile links structure:', error)
    }

    setLinks(parsedLinks)
  }, [profile?.links])

  // Display skeleton shimmers while hook loads data
  if (isLoading) {
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
        // Enforce fallback structure to ensure valid routing schemas
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
