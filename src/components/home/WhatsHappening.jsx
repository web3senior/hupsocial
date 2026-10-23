'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import DOMPurify from 'dompurify'
import { getTrendingPosts } from '@/lib/api'
import { renderMarkdown } from '@/lib/markdown'
import { ContentSpinner } from '@/components/Loading'
import styles from './WhatsHappening.module.scss'

const preview = (post) => {
  const content = post.content
  if (content?.encrypted) return 'Community post'
  const text = typeof content === 'string'
    ? content
    : content?.article?.title || content?.elements?.[0]?.data?.text
  return typeof text === 'string' && text.trim()
    ? text.trim()
    : 'See what’s happening on Hup'
}

// The entire preview links to its post: keep formatting without nested anchors or media.
const renderPreview = (post) => DOMPurify.sanitize(renderMarkdown(preview(post)), {
  FORBID_TAGS: ['a', 'img'],
})

export default function WhatsHappening() {
  const [posts, setPosts] = useState([])
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [windowHours, setWindowHours] = useState(null)

  useEffect(() => {
    let cancelled = false

    getTrendingPosts(1, 4)
      .then((response) => {
        if (!response?.success || !Array.isArray(response.data)) throw new Error('Invalid trending response')
        if (cancelled) return
        setPosts(response.data.slice(0, 4))
        setWindowHours(response.meta?.trending_window_hours ?? null)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <section className={styles.happening} aria-label="What’s happening">
      <h2 className={styles.happening__title}>What’s happening</h2>
      {status === 'loading' && (
        <div className={styles.happening__status}>
          <ContentSpinner />
        </div>
      )}
      {status === 'error' && (
        <div className={styles.happening__status}>
          <p role="status">Couldn’t load trending posts.</p>
          <button type="button" className={styles.happening__action} onClick={() => {
            setStatus('loading')
            setAttempt((value) => value + 1)
          }}>Try again</button>
        </div>
      )}
      {status === 'ready' && posts.length === 0 && (
        <p className={styles.happening__status}>Nothing is trending yet. Check back soon.</p>
      )}
      {status === 'ready' && posts.length > 0 && (
        <ul className={styles.happening__list}>
          {posts.map((post) => (
            <li key={`${post.network_id}:${post.id}`}>
              <Link className={styles.happening__item} href={`/networks/${post.network_id}/${post.id}`}>
                <span className={styles.happening__meta}>
                  {post.network_name || 'Hup'} · {windowHours === 168 ? 'Trending this week' : 'Trending'}
                </span>
                <div className={styles.happening__preview} dangerouslySetInnerHTML={{ __html: renderPreview(post) }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
