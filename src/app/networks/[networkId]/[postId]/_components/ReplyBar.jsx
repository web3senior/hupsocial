'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { ArrowsOutSimpleIcon, GifIcon, ImageIcon } from '@phosphor-icons/react'
import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useProfile } from '@/hooks/useProfile'
import { getPostById } from '@/lib/api'
import { openConnect } from '@/lib/connectDialog'
import { toast } from '@/components/NextToast'
import Avatar from '@/components/ui/Avatar'
import NewPost from '@/components/NewPost'
import styles from './ReplyBar.module.scss'

/**
 * Threads-style reply bar between the post and its replies. It is only a set of doors into the
 * real reply composer (NewPost), never a second one: the field and the expand button open it
 * empty, the image button opens it with the picked files attached, the GIF button in its picker.
 * @param {Object} props
 * @param {Object} props.post The row the page shows. A repost row is replied to through its
 *   original, the same target the card's own comment button uses.
 * @param {string} props.networkId
 */
export default function ReplyBar({ post, networkId }) {
  const { address, isConnected } = useActiveWallet()
  const { profile } = useProfile(isConnected && address ? address : null)
  const fileInputRef = useRef(null)
  const [composer, setComposer] = useState(null)

  // NewPost reads the target's content, community and author, so a repost needs its original row
  const originalId = Number(post?.is_repost) > 0 ? post.is_repost : null
  const { data: original } = useSWR(originalId ? ['reply-target', networkId, originalId] : null, () =>
    getPostById(networkId, originalId).then((body) => body?.data ?? null),
  )
  const target = originalId ? original : post
  // "Reply to anoqiex…", named the way the byline above names them
  const { profile: author } = useProfile(target?.wallet_address)
  const authorName = author?.username || author?.name || target?.display_name

  if (!target?.allow_comment) return null

  // Same gate as the card's comment button: no wallet, no composer
  const ensureWallet = () => {
    if (isConnected) return true
    if (!openConnect()) toast('Please connect wallet', 'error')
    return false
  }

  const openComposer = (options = {}) => {
    if (ensureWallet()) setComposer(options)
  }

  const pickMedia = () => {
    if (ensureWallet()) fileInputRef.current?.click()
  }

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length) setComposer({ seedFiles: files })
  }

  return (
    <>
      <div className={styles['reply-bar']} data-reply-dock>
        <div className={styles['reply-bar__inner']}>
          <Avatar className={styles['reply-bar__avatar']} src={isConnected ? profile?.profileImage : null} size={32} />

          <button type="button" className={styles['reply-bar__field']} onClick={() => openComposer()}>
            {authorName ? `Reply to ${authorName}…` : 'Post your reply'}
          </button>

          <div className={styles['reply-bar__tools']}>
            <button type="button" className={styles['reply-bar__tool']} aria-label="Add photos or video" title="Media" onClick={pickMedia}>
              <ImageIcon size={20} />
            </button>
            <button type="button" className={styles['reply-bar__tool']} aria-label="Add a GIF" title="GIF" onClick={() => openComposer({ startWithGif: true })}>
              <GifIcon size={20} />
            </button>
            <button
              type="button"
              className={clsx(styles['reply-bar__tool'], styles['reply-bar__tool--expand'])}
              aria-label="Open the full reply composer"
              title="Expand"
              onClick={() => openComposer()}
            >
              <ArrowsOutSimpleIcon size={20} />
            </button>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={handleFiles} />
        </div>
      </div>

      {composer && (
        <NewPost
          actionType="comment"
          replyTarget={target}
          seedFiles={composer.seedFiles ?? null}
          startWithGif={Boolean(composer.startWithGif)}
          onClose={() => setComposer(null)}
        />
      )}
    </>
  )
}
