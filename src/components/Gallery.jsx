'use client'

import React, { useState, useMemo } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
  const [isMuted, setIsMuted] = useState(true)

  // Initialize Embla with options
  // 'align: start' keeps the first item flush to the left
  const [emblaRef] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true, // Smooth dragging like a native scroll
  })

  const hasVideos = useMemo(() => data?.some((item) => item.type === 'video'), [data])

  if (!data || data.length === 0) return null

  return (
    <div className={styles.galleryWrapper} onClick={(e) => e.stopPropagation()}>
      <div className={styles.embla} ref={emblaRef} onClick={(e) => e.stopPropagation()}>
        <div className={styles.embla__container}>
          {data.map((item, i) => {
            const isVideo = item.type === 'video'
            const url = `${GATEWAY_URL}${item.cid}`

            return (
              <div key={i} className={styles.embla__slide}>
                <div className={styles.mediaItem}>
                  {isVideo ? (
                    <div className={styles.videoWrapper}>
                      <video
                        src={url}
                        autoPlay
                        loop
                        muted={isMuted}
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
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
