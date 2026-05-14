'use client'

import React, { useState, useEffect, useRef } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data = [] }) {
  const [isMuted, setIsMuted] = useState(true)
  const [revealedItems, setRevealedItems] = useState({})
  // New state to store resolved Blob URLs for 0G storage
  const [resolvedUrls, setResolvedUrls] = useState({})
  
  const videoRefs = useRef([])
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'
  const isCarousel = data.length > 1

  const [emblaRef] = useEmblaCarousel({
    active: isCarousel,
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  // Resolve 0G Hashes
  useEffect(() => {
    const urlsToRevoke = []

    const load0GAssets = async () => {
      const newResolved = { ...resolvedUrls }
      
      for (const item of data) {
        // Only fetch if it's 0G, has a CID, and hasn't been resolved yet
        if (item?.storage === '0G' && item.cid && !resolvedUrls[item.cid]) {
          try {
            const res = await fetch(`/api/0g/download?hash=${item.cid}`)
            if (!res.ok) throw new Error('Download failed')
            
            const blob = await res.blob()
            const activeUrl = URL.createObjectURL(blob)
            
            newResolved[item.cid] = activeUrl
            urlsToRevoke.push(activeUrl)
          } catch (err) {
            console.error('0G_RESOLVE_ERROR:', err)
          }
        }
      }
      setResolvedUrls(newResolved)
    }

    load0GAssets()

    // Cleanup: Revoke object URLs to prevent memory leaks
    return () => {
      urlsToRevoke.forEach(url => URL.revokeObjectURL(url))
    }
  }, [data])

  // Intersection Observer for video autoplay
  useEffect(() => {
    const observerOptions = { threshold: 0.6 }
    const handleIntersection = (entries) => {
      entries.forEach((entry) => {
        const video = entry.target
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      })
    }

    const observer = new IntersectionObserver(handleIntersection, observerOptions)
    videoRefs.current.forEach((video) => {
      if (video) observer.observe(video)
    })

    return () => observer.disconnect()
  }, [data, resolvedUrls]) // Re-run when URLs resolve so observer attaches to new src

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
            let url = ''

            // Logic to determine source URL
            if (item?.storage === '0G') {
              url = resolvedUrls[item.cid] || '' // Use the blob URL from state
            } else if (item.cid) {
              url = item.cid.startsWith('http') ? item.cid : `${GATEWAY_URL}${item.cid}`
            }

            const isBlurred = item.spoiler && !revealedItems[i]

            // Don't render until we have a URL for 0G items to prevent broken src
            if (item?.storage === '0G' && !url) {
                return <div key={i} className={styles.loadingPlaceholder} /> 
            }

            return (
              <div
                key={`${item.cid}-${i}`}
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
                        ref={(el) => (videoRefs.current[i] = el)}
                        src={url}
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
                  {isBlurred && <span className={styles.spolier}>Spoiler</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}