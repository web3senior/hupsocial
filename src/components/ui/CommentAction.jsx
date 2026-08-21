'use client'

import { ChatCircleIcon } from '@phosphor-icons/react'
import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { usePostStats } from '@/hooks/usePostStats'
import { toast } from '@/components/NextToast'
import Counter from './Counter'
import Tooltip from './Tooltip'

/**
 * Comment Interaction Component
 * Named CommentAction to stay distinct from the comment-thread component in `components/Comment.jsx`.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and comment metrics.
 * @param {Function} props.onComment Opens the comment composer for this post.
 */
export const CommentAction = ({ post, onComment }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()
  const { stats } = usePostStats(post)

  const commentCount = Number(stats?.total_comments) || 0

  const handleComment = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }

    onComment?.(post)
  }

  if (!isMounted) return null
  if (!post.allow_comment) return null

  return (
    <Tooltip content="Reply" placement="bottom" size="compact" hoverOnly>
      <button data-action="comment" aria-label="Comment on post" onClick={handleComment}>
        <ChatCircleIcon width={17} height={17} />
        {commentCount > 0 && <Counter value={commentCount} />}
      </button>
    </Tooltip>
  )
}

export default CommentAction
