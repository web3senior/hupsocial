'use client'

import { useState, useEffect } from 'react'
import { getProfile, getUniversalProfile } from '@/lib/api'
import searchAI from '@/../public/search-ai.svg'
import loading from '@/../public/loading.svg'
import { getIPFS } from '@/lib/ipfs'
import styles from './AISummary.module.scss'
import { Sparkles } from 'lucide-react'
import clsx from 'clsx'
const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

export default function AISummary({ addr, posts, poaps }) {
  // Initialize state hooks for managing component UI data
  const [profileData, setProfileData] = useState(null)
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)


  // Fetcher logic extracted for better testability and SWR compatibility
  const profileFetcher = async (address) => {
    if (!address) return null

    try {
      // Attempt Universal Profile (LUKSO) first
      const res = await getUniversalProfile(address)
      if (res?.data?.Profile?.[0]?.isContract) {
        const p = res.data.Profile[0]
        return {
          wallet: res.data.id,
          name: p.name || DEFAULT_USERNAME,
          profileImage: p.profileImages?.[0]?.src || DEFAULT_PFP,
        }
      }

      // Fallback to local database
      const localRes = await getProfile(address)
      if (localRes?.wallet_address) {
        return {
          ...localRes,
          name: localRes.name || DEFAULT_USERNAME,
          profileImage: localRes.profileImage
            ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${localRes.profileImage}`
            : DEFAULT_PFP,
        }
      }
    } catch (e) {
      console.error('Profile fetch error:', e)
    }

    return { wallet: address, name: DEFAULT_USERNAME, profileImage: DEFAULT_PFP }
  }

  // Handle the text aggregation and proxy payload delivery to API
  const generateSummary = async () => {
    if (!profileData || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      // Safely aggregate posts list arrays prior to parallel execution
      const postsList = posts?.list || []

      // Resolve content hashes from storage asynchronously
      const resolvedPosts = await Promise.all(
        postsList.map(async (post) => {
          if (post.metadata) {
            try {
              const ipfsContent = await getIPFS(post.metadata)

              // Handle instances where IPFS yields string variants vs object keys
              return typeof ipfsContent === 'object'
                ? ipfsContent?.elements?.[0]?.data?.text
                : JSON.stringify(ipfsContent)
            } catch (e) {
              return post.content
            }
          }
          return post.content
        }),
      )

      const postText = resolvedPosts.filter(Boolean).join(' | ')

      // Request insights breakdown from Next endpoint
      const response = await fetch('/api/ai/token-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileData,
          posts: postText,
          poaps: poaps,
        }),
      })

      const json = await response.json()
      const responseData = json.json

      if (responseData?.error) throw new Error(responseData.error)

      setData(responseData)
    } catch (err) {
      console.error('AI Error:', err)
      setError('Could not generate summary.')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle updates to incoming target address configurations
  useEffect(() => {
    profileFetcher(addr).then((profileData) => setProfileData(profileData))
  }, [addr])

  if (!profileData) return null

  // Safely extract scores to minimize repetitive template code chains
  const scores = data?.scores || {}

  return (
    <div className={styles.ai}>
      <div className={`${styles.ai__container} d-f-c flex-column`}>
        {!data && (
          <header className="d-f-c flex-column align-items-center">
            <figure>
              <img alt="AI Graphic Representation" src={searchAI.src} />
            </figure>
            <h4 className={styles.title}>AI Profile Insights</h4>
            <p className={`text-center ${styles.subtitle}`}>
              AI analysis of on-chain activity and bio. Tap analyze to reveal this user's Web3
              personality.
            </p>
          </header>
        )}

        {isLoading && <img src={loading.src} alt="Loading Indicators" className={styles.loading} />}

        <div className={clsx(styles.content, 'w-100')}>
          {error ? (
            <p className={styles.error}>{error}</p>
          ) : data ? (
            <output className={clsx(styles.summary)}>
              <h3>{data?.web3_vibe}</h3>
              <p>{data?.summary}</p>
              <b>STATS</b>
              <ul className="flex flex-column w-100">
                <li>
                  <div>
                    <label>Degen</label>
                    <b>{scores.degen || 0}%</b>
                  </div>
                  <progress min={0} max={100} value={scores.degen || 0}></progress>
                </li>
                <li>
                  <div>
                    <label>Builder</label>
                    <b>{scores.builder || 0}%</b>
                  </div>
                  <progress min={0} max={100} value={scores.builder || 0}></progress>
                </li>
                <li>
                  <div>
                    <label>Researcher</label>
                    <b>{scores.researcher || 0}%</b>
                  </div>
                  <progress min={0} max={100} value={scores.researcher || 0}></progress>
                </li>
              </ul>
            </output>
          ) : null}
        </div>

        <button
          onClick={generateSummary}
          className={`${styles.generateButton} rounded ${isLoading ? styles.buttonLoading : ''}`}
          disabled={isLoading}
        >
          {data ? (
            'Regenerate Insight'
          ) : (
            <span className="d-f-c">
              <Sparkles className="mr-2" size={16} /> Generate Insight
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
