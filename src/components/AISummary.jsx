'use client'

import { useState } from 'react'
import searchAI from '@/../public/search-ai.svg'
import loading from '@/../public/loading.svg'
import styles from './AISummary.module.scss'
import { Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { useProfile } from '@/hooks/useProfile'

export default function AISummary({ addr, posts, poaps }) {
  const { profile, isLoading: isProfileLoading } = useProfile(addr)
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Extract just the human-written text from a post's content, ignoring media/structure
  const extractPostText = (content) => {
    if (!content || !Array.isArray(content.elements)) return null
    return content.elements
      .filter((el) => el.type === 'text')
      .map((el) => el.data?.text)
      .filter(Boolean)
      .join(' ')
  }

  const generateSummary = async () => {
    if (!profile || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      const postsList = posts?.list || []

      const postText = postsList
        .map((post) => extractPostText(post.content))
        .filter(Boolean)
        .join(' | ')

      const response = await fetch('/api/ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          posts: postText,
          poaps,
        }),
      })

      const json = await response.json()

      if (json?.error) throw new Error(json.error)

      setData(json)
    } catch (err) {
      console.error('AI Error:', err)
      setError('Could not generate summary.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isProfileLoading) {
    return (
      <div className={styles.ai}>
        <div className={`${styles.ai__container} d-f-c flex-column`}>
          <img src={loading.src} alt="Loading" className={styles.loading} />
        </div>
      </div>
    )
  }

  if (!profile) return null

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
              AI analysis of onchain activity and bio. Tap analyze to reveal this user's Web3 personality.
            </p>
          </header>
        )}

        {isLoading && <img src={loading.src} alt="Loading Indicator" className={styles.loading} />}

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
