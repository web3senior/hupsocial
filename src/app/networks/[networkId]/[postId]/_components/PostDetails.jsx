'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useConnection } from 'wagmi'
import { recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import Comments from '@/components/Comments'
import { usePostStore } from '@/stores/usePostStore'
import styles from './PostDetails.module.scss'

export default function PostDetails({ networkId, postId }) {
  const params = useParams()
  const resolvedNetworkId = networkId || params.networkId
  const resolvedPostId = postId || params.postId

  const { currentPost } = usePostStore()
  const { address } = useConnection()
  const mounted = useClientMounted()

  // Show cached post from the feed immediately; background fetch keeps data fresh
  const [post, setPost] = useState(() => {
    const id = currentPost?.id
    return id === resolvedPostId || id === Number(resolvedPostId) ? currentPost : null
  })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/networks/${resolvedNetworkId}/${resolvedPostId}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body?.data) setPost(body.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, resolvedPostId])

  useEffect(() => {
    if (mounted) recordPostView(resolvedNetworkId, resolvedPostId, address)
  }, [resolvedPostId, resolvedNetworkId, address, mounted])

  return (
    <div className={`${styles.post}`}>
      <div className={`__container ${styles.page__container}`} data-width={`small`}>
        {!post && <div className={`shimmer ${styles.pollShimmer}`} />}

        {post && (
          <div className={`${styles.grid} flex flex-column`}>
            <article className={`${styles.post} animate fade`}>
              <Post
                item={post}
                showContent={true}
                chainId={resolvedNetworkId}
                actions={['like', 'comment', 'hash', 'repost', 'view', 'share']}
              />
              <hr />
            </article>
          </div>
        )}

        {post && (
          <Comments
            networkId={resolvedNetworkId}
            postId={post.is_repost > 0 ? post.is_repost : resolvedPostId}
            viewerAddress={address}
          />
        )}
      </div>
    </div>
  )
}
