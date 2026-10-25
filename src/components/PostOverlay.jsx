'use client'

import { useEffect } from 'react'
import PostDetails from '@/app/networks/[networkId]/[postId]/_components/PostDetails'
import pageStyles from '@/app/networks/[networkId]/[postId]/page.module.scss'

/**
 * The post page's body, rendered client-side for a post opened in place (PostOverlayHost).
 * Mirrors app/networks/[networkId]/[postId]/page.jsx — same wrapper and PostDetails —
 * so an in-place open and a direct visit to the URL look identical.
 * @param {{ entry: { path: string, networkId: string, postId: string, post: Object } }} props
 */
export default function PostOverlay({ entry }) {
  // Set here rather than through PageTitle, whose cleanup resets to the bare site name: the page
  // underneath never remounted, so it would not set its own title back on close
  useEffect(() => {
    const previous = document.title
    document.title = `${process.env.NEXT_PUBLIC_NAME} | Post`
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <>
      <div className={pageStyles.page}>
        <PostDetails key={entry.path} networkId={entry.networkId} postId={entry.postId} initialPost={entry.post} />
      </div>
    </>
  )
}
