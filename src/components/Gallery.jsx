'use client'

import React, { useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data = [] }) {
  const [isMuted, setIsMuted] = useState(true)
  // Track which spoilers have been clicked/revealed locally
  const [revealedItems, setRevealedItems] = useState({})

  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'
  const isCarousel = data.length > 1

  const [emblaRef] = useEmblaCarousel({
    active: isCarousel,
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  if (!data.length) return null

  const handleReveal = (index) => {
    setRevealedItems((prev) => ({ ...prev, [index]: true }))
  }

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
            
            // Item is blurred if it is marked as a spoiler AND hasn't been revealed yet
            const isBlurred = item.spoiler && !revealedItems[i]

            return (
              <div
                key={item.cid || i}
                className={isCarousel ? styles.embla__slide : styles.singleSlide}
              >
                <div 
                  className={styles.mediaItem} 
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isBlurred) handleReveal(i)
                  }}
                >
                  {isVideo ? (
                    <>
                      <video
                        src={url}
                        autoPlay
                        loop
                        muted={isMuted}
                        playsInline
                        className={styles.videoPlayer}
                        style={{ filter: isBlurred ? 'blur(20px)' : 'none' }}
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
                      style={{ filter: isBlurred ? 'blur(20px)' : 'none' }}
                    />
                  )}

                  {/* Only show the Spoiler overlay if it is currently blurred */}
                  {isBlurred && (
                    <span className={styles.spolier}>Spoiler</span>
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