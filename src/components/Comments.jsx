'use client'

import { useState, useEffect } from 'react'
import Post from '@/components/Post'
import styles from './comments.module.scss'
import { getActiveChain } from '@/lib/communication'
import { useRouter } from 'next/navigation'

export default function Comments({ networkId, postId, viewerAddress }) {
  const [comments, setComments] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const activeChain = getActiveChain()
    const router = useRouter()

  useEffect(() => {
    async function loadComments() {
      try {
        let url = `/api/v1/networks/${networkId}/${postId}/comments?page=1&limit=30`
        if (viewerAddress) {
          url += `&viewer_address=${encodeURIComponent(viewerAddress)}`
        }

        const res = await fetch(url)
        const json = await res.json()
        if (json.success) {
          setComments(json.data)
        }
      } catch (err) {
        console.error('Failed to load comments', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadComments()
  }, [networkId, postId, viewerAddress])

  if (isLoading) return <div>Loading discussion thread...</div>

  return (
    <div className={styles.commentsList}>
      {comments.length === 0 ? (
        <p className={styles.commentsList__empty}>No comments yet. Start the conversation!</p>
      ) : (
        comments.map((comment, i) => (
          <section key={comment.id} className={styles.commentsList__item}
           onClick={() => router.push(`/networks/${networkId}/${comment.id}`)}
          >
            <Post
              item={comment}
              networkName={comment.network_name}
              actions={[
                'like',
                comment.allow_comment ? 'comment' : null,
                'repost',
                'view',
                'share',
                'tip',
              ]} // Simplified actions matrix for reply nodes
            />
            {i < comments.length - 1 && <hr className={styles.commentsList__divider} />}
          </section>
        ))
      )}
    </div>
  )
}
