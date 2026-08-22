'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChatCircleIcon, PlayIcon, SpeakerHighIcon, SpeakerSlashIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import Profile from '@/components/Profile'
import { Like } from '@/components/ui/Like'
import Bookmark from '@/components/ui/Bookmark'
import Share from '@/components/ui/Share'
import Counter from '@/components/ui/Counter'
import { resolveStorageUrl, resolveStorageImageUrl } from '@/lib/storageHelper'
import styles from './ShortsPlayer.module.scss'

/**
 * One slide of the shorts rail: a portrait video frame with the post's author, caption and
 * actions laid over it, so the frame is the only thing in flow and the video stays centred.
 *
 * Playback is driven from the outside — the rail owns a single IntersectionObserver and tells
 * exactly one slide it is active, rather than every slide running its own observer and racing
 * to grab the audio channel.
 */
export default function ShortsPlayer({ post, video, caption, isActive, isMuted, onToggleMute, onUpdate }) {
  const videoRef = useRef(null)

  /* Three states, not a boolean: 'idle' means nothing has been attempted yet, which is not the
     same as paused. Showing a play button over a video that is still loading would be a lie,
     and a boolean can't tell those apart. */
  const [status, setStatus] = useState('idle')

  const src = resolveStorageUrl(video.cid)
  const poster = video.poster ? resolveStorageImageUrl(video.poster, { width: 640 }) : undefined
  const commentCount = Number(post.total_comments) || 0

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    if (isActive) {
      /* Shorts is a surface you opened to watch video, so playback is not gated on the feed's
         autoplay preference. A browser can still refuse — that lands in the catch, which is the
         only path that puts a play button over a slide the reader expected to just start. */
      element.play().catch(() => setStatus('paused'))
      return
    }

    element.pause()
    /* Scrolling away ends the view — coming back should start the clip over rather than drop
       the reader into the middle of something they half-watched. */
    element.currentTime = 0
  }, [isActive])

  const togglePlayback = () => {
    const element = videoRef.current
    if (!element) return

    if (element.paused) element.play().catch(() => setStatus('paused'))
    else element.pause()
  }

  return (
    <div className={styles.shortsPlayer}>
      <div className={styles.shortsPlayer__frame}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          className={styles.shortsPlayer__video}
          loop
          muted={isMuted}
          playsInline
          /* Only the active slide is worth buffering; the rail renders its neighbours so they
             can be scrolled to, not so they can download in the background. */
          preload={isActive ? 'auto' : 'none'}
          onClick={togglePlayback}
          onPlay={() => setStatus('playing')}
          onPause={() => setStatus('paused')}
        />

        {/* Author and caption sit on whatever the video happens to be showing, which can be a
            white sky. The scrim darkens only the strip they occupy so they stay readable
            without dimming the picture itself. */}
        <div className={styles.shortsPlayer__scrim} aria-hidden="true" />

        {status === 'paused' && (
          <button type="button" className={styles.shortsPlayer__resume} onClick={togglePlayback} aria-label="Play video">
            <span className={styles.shortsPlayer__resumeIcon}>
              <PlayIcon size={34} weight="fill" />
            </span>
          </button>
        )}

        <button
          type="button"
          className={styles.shortsPlayer__sound}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <SpeakerSlashIcon size={20} /> : <SpeakerHighIcon size={20} />}
        </button>

        <div className={styles.shortsPlayer__info}>
          <Profile creator={post.wallet_address} createdAt={post.created_at} networkId={post.network_id} />
          {caption && <p className={styles.shortsPlayer__caption}>{caption}</p>}
        </div>

        {/* Inside the frame, over the picture. Beside it, this column took width from the same
            row as the video and pushed it off the page's centre line — and because the rail
            clips its own horizontal overflow, a tall viewport hid the column entirely. */}
        <div className={styles.shortsPlayer__actions}>
          <div className={styles.shortsPlayer__action}>
            <Like post={post} onUpdate={onUpdate} />
          </div>

          <div className={styles.shortsPlayer__action}>
            <Link
              href={`/networks/${post.network_id}/${post.id}`}
              className={styles.shortsPlayer__actionLink}
              aria-label="Comments"
            >
              <ChatCircleIcon size={24} />
              {commentCount > 0 && <Counter value={commentCount} />}
            </Link>
          </div>

          <div className={clsx(styles.shortsPlayer__action, styles.shortsPlayer__actionLabelled)}>
            <Share
              item={post}
              trigger={
                <button type="button" aria-label="Share post">
                  <UploadSimpleIcon size={24} />
                  <span className={styles.shortsPlayer__actionLabel}>Share</span>
                </button>
              }
            />
          </div>

          <div className={styles.shortsPlayer__action}>
            <Bookmark post={post} />
          </div>
        </div>
      </div>
    </div>
  )
}
