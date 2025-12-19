'use client'

import React, { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
  const [isMuted, setIsMuted] = useState(true) // Must start true for autoplay to work

  if (!data || data.length === 0) return null

  return (
    <div className={styles.galleryWrapper} onClick={(e) => e.stopPropagation()}>
      <div className={styles.scrollContainer}>
        {data.map((item, i) => {
          const isVideo = item.type === 'video'
          const url = `${GATEWAY_URL}${item.cid}`

          return (
            <div key={i} className={styles.mediaItem}>
              {isVideo ? (
                <div className={styles.mediaItem__videoWrapper}>
                  <video
                    src={url}
                    autoPlay
                    loop
                    muted={isMuted} // Global sync
                    playsInline
                    className={styles.videoPlayer}
                  />
                  <button
                    className={styles.muteButton}
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsMuted(!isMuted)
                    }}
                    aria-label={isMuted ? 'Unmute all' : 'Mute all'}
                  >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>
              ) : (
                <img
                  src={url}
                  alt={item.alt || `Gallery item ${i}`}
                  className={styles.displayImage}
                  loading="lazy"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
