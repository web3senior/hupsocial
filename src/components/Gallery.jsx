'use client'

import React, { useState, useMemo } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
  const [isMuted, setIsMuted] = useState(true)

  const isCarousel = data?.length > 1

  // We only hook into Embla if we have multiple items
  const [emblaRef] = useEmblaCarousel({
    active: isCarousel, // Embla won't run if this is false
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  if (!data || data.length === 0) return null

  return (
    <div className={styles.galleryWrapper} onClick={(e) => e.stopPropagation()}>
      {/* We conditionally apply the embla class. 
         If only 1 item, we use a simple 'singleView' class to avoid overflow hidden 
      */}
      <div
        className={isCarousel ? styles.embla : styles.singleView}
        ref={isCarousel ? emblaRef : null}
      >
        <div className={isCarousel ? styles.embla__container : styles.singleContainer}>
          {data.map((item, i) => {
            const isVideo = item.type === 'video'
            const url = `${GATEWAY_URL}${item.cid}`

            return (
              <div key={i} className={isCarousel ? styles.embla__slide : styles.singleSlide}>
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
