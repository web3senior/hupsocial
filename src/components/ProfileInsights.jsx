'use client'

import { useState } from 'react'
import loading from '@/../public/loading.svg'
import styles from './ProfileInsights.module.scss'
import { SparkleIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useProfile } from '@/hooks/useProfile'

export default function ProfileInsights({ addr, posts, poaps }) {
  const { profile, isLoading: isProfileLoading } = useProfile(addr)
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  // Extract just the human-written text from a post's content, ignoring media/structure
  const extractPostText = (content) => {
    if (!content || !Array.isArray(content.elements)) return null
    return content.elements
      .filter((el) => el.type === 'text')
      .map((el) => el.data?.text)
      .filter(Boolean)
      .join(' ')
  }

  const generateInsights = async () => {
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
      setError('Could not generate insights. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (dismissed) return null

  if (isProfileLoading) {
    return (
      <section className={styles.insights}>
        <div className={clsx(styles.insights__container, 'd-f-c flex-column')}>
          <img src={loading.src} alt="Loading" className={styles.insights__loading} />
        </div>
      </section>
    )
  }

  if (!profile) return null

  const scores = data?.scores || {}

  return (
    <section className={styles.insights}>
      <div className={styles.insights__container}>
        <button
          type="button"
          className={styles.insights__close}
          onClick={() => setDismissed(true)}
          aria-label="Dismiss profile insights"
        >
          <XIcon size={16} />
        </button>

        <header className={styles.insights__header}>
          <div className={styles['insights__title-row']}>
            <h4 className={styles.insights__title}>Profile Insights</h4>
            <span className={styles.insights__badge}>Beta</span>
          </div>
          <p className={styles.insights__subtitle}>
            An AI-powered read of this profile&apos;s posts, bio, and POAPs — their Web3 personality at a glance.
          </p>
        </header>

        {isLoading && <img src={loading.src} alt="Loading Indicator" className={styles.insights__loading} />}

        <div className={clsx(styles.insights__body, 'w-100')}>
          {error ? (
            <p className={styles.insights__error}>{error}</p>
          ) : data ? (
            <output className={styles.insights__summary}>
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
          ) : (
            <button
              type="button"
              onClick={generateInsights}
              className={clsx(styles.insights__action, isLoading && styles['insights__action--loading'])}
              disabled={isLoading}
            >
              <span className="d-f-c">
                <SparkleIcon className="mr-2" size={16} /> Generate insights
              </span>
            </button>
          )}
        </div>

        {data && (
          <button
            type="button"
            onClick={generateInsights}
            className={clsx(styles.insights__regenerate, 'rounded')}
            disabled={isLoading}
          >
            Regenerate insights
          </button>
        )}
      </div>
    </section>
  )
}
