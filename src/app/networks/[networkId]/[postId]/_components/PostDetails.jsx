'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useConnection } from 'wagmi'
import { recordPostView } from '@/lib/api'
import { useClientMounted } from '@/hooks/useClientMount'
import Post from '@/components/Post'
import Comments from '@/components/Comments'
import { usePostStore } from '@/stores/usePostStore'
import styles from './PostDetails.module.scss'

export default function PostDetails({ networkId, postId }) {
  const params = useParams()
  const router = useRouter()
  const resolvedNetworkId = networkId || params.networkId
  const resolvedPostId = postId || params.postId

  const { currentPost, setCurrentPost } = usePostStore()
  const { address } = useConnection()
  const mounted = useClientMounted()

  // Show cached post from the feed immediately; background fetch keeps data fresh
  const [post, setPost] = useState(() => {
    const id = currentPost?.id
    return id === resolvedPostId || id === Number(resolvedPostId) ? currentPost : null
  })

  useEffect(() => {
    let cancelled = false
    // In-page navigation (comment → parent) keeps this component mounted, so drop
    // the stale post before fetching; the store snapshot avoids a currentPost dep
    // that would refetch on every setCurrentPost.
    setPost((prev) => {
      if (prev && (prev.id === resolvedPostId || prev.id === Number(resolvedPostId))) return prev
      const cached = usePostStore.getState().currentPost
      const cachedId = cached?.id
      return cachedId === resolvedPostId || cachedId === Number(resolvedPostId) ? cached : null
    })
    fetch(`/api/v1/networks/${resolvedNetworkId}/${resolvedPostId}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body?.data) setPost(body.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, resolvedPostId])

  // A comment carries its parent's id — parent_id on current rows, is_comment on
  // legacy rows. Zero means "not a comment" onchain, so it must not count.
  const parentId = Number(post?.parent_id) || Number(post?.is_comment) || null
  const [parentPost, setParentPost] = useState(null)

  useEffect(() => {
    if (!parentId) {
      setParentPost(null)
      return
    }
    let cancelled = false
    fetch(`/api/v1/networks/${resolvedNetworkId}/${parentId}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled && body?.data) setParentPost(body.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [resolvedNetworkId, parentId])

  useEffect(() => {
    if (mounted) recordPostView(resolvedNetworkId, resolvedPostId, address)
  }, [resolvedPostId, resolvedNetworkId, address, mounted])

  return (
    <div className={`${styles.post}`}>
      <div className={`__container ${styles.page__container}`} data-width={`small`}>
        {!post && <div className={`shimmer ${styles.pollShimmer}`} />}

        {post && (
          <div className={`${styles.grid} flex flex-column`}>
            {parentPost && (
              <article
                className={`${styles.post} ${styles.post__parent} animate fade`}
                onClick={() => {
                  setCurrentPost(parentPost)
                  router.push(`/networks/${resolvedNetworkId}/${parentPost.id}`)
                }}
                onMouseEnter={() => router.prefetch(`/networks/${resolvedNetworkId}/${parentPost.id}`)}
              >
                <Post
                  item={parentPost}
                  chainId={resolvedNetworkId}
                  actions={['like', 'comment', 'repost', 'view', 'share', 'bookmark']}
                  hasCommentBelow={true}
                />
              </article>
            )}
            <article className={`${styles.post} animate fade`}>
              <Post
                item={post}
                showContent={true}
                chainId={resolvedNetworkId}
                actions={['like', 'comment', 'repost', 'view', 'share', 'bookmark']}
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
