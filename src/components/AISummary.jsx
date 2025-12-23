'use client'

import { useState, useEffect } from 'react'
import { getProfile, getUniversalProfile } from '@/lib/api'
import searchAI from '@/../public/search-ai.svg'
import loading from '@/../public/loading.svg'
import { getIPFS } from '@/lib/ipfs'
import styles from './AISummary.module.scss'
import { Sparkles } from 'lucide-react'

export default function AISummary({ addr, posts, poaps }) {
  const [profileData, setProfileData] = useState(null)
  const [data, setData] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const getProfileData = async () => {
    try {
      const res = await getUniversalProfile(addr)
      if (res.data?.Profile?.[0]?.isContract) {
        setProfileData({
          wallet: res.data.Profile[0].id,
          name: res.data.Profile[0].name,
          description: res.data.Profile[0].description,
          profileImage: res.data.Profile[0].profileImages?.[0]?.src || '',
          tags: JSON.stringify(res.data.Profile[0].tags),
          links: JSON.stringify(res.data.Profile[0].links_),
        })
      } else {
        const localRes = await getProfile(addr)
        if (localRes.wallet) {
          localRes.profileImage = `${process.env.NEXT_PUBLIC_UPLOAD_URL}${localRes.profileImage}`
          setProfileData(localRes)
        }
      }
    } catch (err) {
      console.error('Profile fetch error:', err)
    }
  }

  const generateSummary = async () => {
    if (!profileData || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      // 1. Resolve IPFS metadata for the first 5 posts

      const resolvedPosts = await Promise.all(
        posts.list.map(async (post) => {
          if (post.metadata) {
            try {
              const ipfsContent = await getIPFS(post.metadata)
              // console.log('IPFS Content:', ipfsContent)

              // Handle if IPFS returns an object or a string
              return typeof ipfsContent === 'object'
                ? ipfsContent?.elements[0]?.data.text
                : JSON.stringify(ipfsContent)
            } catch (e) {
              return post.content // fallback to contract content
            }
          }
          return post.content
        })
      )

      console.log(poaps)

      const postText = resolvedPosts.join(' | ')

      // 3. Call your Next.js API route
      const response = await fetch('/api/ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileData,
          posts: postText,
          poaps: poaps,
        }),
      })

      const data = await response.json()
      if (data.error) throw new Error(data.error)

      setData(data)
    } catch (err) {
      console.error('AI Error:', err)
      setError('Could not generate summary.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    getProfileData()
  }, [addr])

  if (!profileData) return null

  return (
    <div className={`${styles.ai}`}>
      <div className={`${styles.ai__container}  d-f-c flex-column`}>
        {!data && (
          <header className={`d-f-c flex-column align-items-center`}>
            <figure>
              <img alt={`AI`} src={searchAI.src} />
            </figure>

            <h4 className={`${styles.title}`}>AI Profile Insights</h4>
            <p className={`text-center ${styles.subtitle}`}>
              AI analysis of on-chain activity and bio. Tap analyze to reveal this user's Web3
              personality.
            </p>
          </header>
        )}

        {isLoading && <img src={loading.src} alt="Loading" className={styles.loading} />}

        <div className={styles.content}>
          {error ? (
            <p className={`${styles.error}`}>{error}</p>
          ) : data ? (
            <output className={styles.summary}>
              <h3>{data?.web3_vibe}</h3>
              <p> {data?.summary}</p>
              <b>STATS</b>
              <ul className={`flex flex-column`}>
                <li>
                  <div className={``}>
                    <label>Degen</label>
                    <b>{data['scores']?.degen}%</b>
                  </div>
                  <progress min={0} max={100} value={data['scores']?.degen}></progress>
                </li>
                <li>
                 <div className={``}>
                  <label>Builder</label>
                    <b>{data['scores']?.builder}%</b>
                  </div>
                  <progress min={0} max={100} value={data['scores']?.builder}></progress>
                </li>
                <li>
             <div className={``}>
             <label>Researcher</label>
                    <b>{data['scores']?.researcher}%</b>
                  </div>
                  <progress min={0} max={100} value={data['scores']?.researcher}></progress>
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
          {data ? 'Regenerate Insight' : <span className="d-f-c">Generate Insight</span>}
        </button>
      </div>
    </div>
  )
}
