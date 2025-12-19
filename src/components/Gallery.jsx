'use client'

import React, { useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data = [] }) {
  const [isMuted, setIsMuted] = useState(true)
  
  // Use a fallback for the gateway to prevent URL construction errors
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'

  const isCarousel = data.length > 1

  const [emblaRef] = useEmblaCarousel({
    active: isCarousel,
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  if (!data.length) return null

  return (
    <div className={styles.galleryWrapper} onClick={(e) => e.stopPropagation()}>
      <div
        className={isCarousel ? styles.embla : styles.singleView}
        ref={isCarousel ? emblaRef : null}
      >
        <div className={isCarousel ? styles.embla__container : styles.singleContainer}>
          {data.map((item, i) => {
            const isVideo = item.type === 'video'
            const url = item.cid.startsWith('http') ? item.cid : `${GATEWAY_URL}${item.cid}`

            return (
              <div key={item.cid || i} className={isCarousel ? styles.embla__slide : styles.singleSlide}>
                <div className={styles.mediaItem}>
                  {isVideo ? (
                    <>
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
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </button>
                    </>
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