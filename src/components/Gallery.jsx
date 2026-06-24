'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX, Maximize2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Gallery.module.scss'
import { resolveIPFSUrl } from '@/lib/storageHelper'

export default function MediaGallery({ data = [] }) {
  // State for gallery behavior
  const [isMuted, setIsMuted] = useState(true)
  const [revealedItems, setRevealedItems] = useState({})
  const [resolvedUrls, setResolvedUrls] = useState({})

  // State for Lightbox (Maximize)
  const [selectedIndex, setSelectedIndex] = useState(null)

  const videoRefs = useRef([])
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'

  const visualData = data.filter((item) => item.type !== 'audio')
  const audioData = data.filter((item) => item.type === 'audio')
  const isCarousel = visualData.length > 1

  // Main Gallery Carousel
  const [emblaRef, emblaApi] = useEmblaCarousel({
    active: isCarousel,
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  // Lightbox Carousel
  const [lightboxRef, lightboxApi] = useEmblaCarousel({
    startIndex: selectedIndex || 0,
    loop: true
  })

  // Synchronize lightbox index
  useEffect(() => {
    if (lightboxApi && selectedIndex !== null) {
      lightboxApi.scrollTo(selectedIndex, true)
    }
  }, [lightboxApi, selectedIndex])

  // Video Autoplay Observer
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
  }, [data, resolvedUrls])

  const handleReveal = (index, e) => {
    e.stopPropagation()
    setRevealedItems((prev) => ({ ...prev, [index]: true }))
  }

  const openLightbox = (index) => {
    setSelectedIndex(index)
    document.body.style.overflow = 'hidden' // Prevent scroll
  }

  const closeLightbox = () => {
    setSelectedIndex(null)
    document.body.style.overflow = ''
  }

  if (!data.length) return null

  const resolveUrl = (item) => {
    if (item?.storage === '0G') return `/api/0g/file?hash=${item.cid}`
    if (item?.storage === 'IPFS') return resolveIPFSUrl(item.cid)
    if (item.cid) return item.cid.startsWith('http') ? item.cid : `${GATEWAY_URL}${item.cid}`
    return ''
  }

  // Helper to render visual media content (image / video only)
  const renderMedia = (item, i, isFullscreen = false) => {
    const isVideo = item.type === 'video'
    const url = resolveUrl(item)
    const isBlurred = item.spoiler && !revealedItems[i] && !isFullscreen

    if (item?.storage === '0G' && !url) {
      return <div className={styles.loadingPlaceholder} />
    }

    return (
      <div className={styles.mediaContainer}>
        {isVideo ? (
          <video
            ref={isFullscreen ? null : (el) => (videoRefs.current[i] = el)}
            src={url}
            loop
            muted={isMuted}
            autoPlay={isFullscreen}
            controls={isFullscreen}
            playsInline
            className={isFullscreen ? styles.fullscreenVideo : styles.videoPlayer}
            style={{ filter: isBlurred ? 'blur(40px)' : 'none' }}
          />
        ) : (
          <img
            src={url}
            alt={item.alt || `Gallery item ${i}`}
            className={isFullscreen ? styles.fullscreenImage : styles.displayImage}
            style={{ filter: isBlurred ? 'blur(40px)' : 'none' }}
          />
        )}
        {isBlurred && (
          <div className={styles.spoilerOverlay} onClick={(e) => handleReveal(i, e)}>
            <span>Spoiler</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.galleryWrapper} onClick={(e) => e.stopPropagation()}>
      {visualData.length > 0 && (
        <div
          className={isCarousel ? styles.embla : styles.singleView}
          ref={isCarousel ? emblaRef : null}
        >
          <div className={isCarousel ? styles.embla__container : styles.singleContainer}>
            {visualData.map((item, i) => (
              <div
                key={`${item.cid}-${i}`}
                className={isCarousel ? styles.embla__slide : styles.singleSlide}
              >
                <div className={styles.mediaItem}>
                  {renderMedia(item, i)}

                  <div className={styles.controls}>
                    {item.type === 'video' && (
                      <button
                        className={styles.iconButton}
                        onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted) }}
                      >
                        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    )}
                    <button
                      className={styles.iconButton}
                      onClick={() => openLightbox(i)}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audioData.length > 0 && (
        <div className={styles.audioTrackList}>
          {audioData.map((item, i) => (
            <div key={`audio-${item.cid}-${i}`} className={styles.audioTrack}>
              <audio src={resolveUrl(item)} controls />
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Overlay */}
      {selectedIndex !== null && (
        <div className={styles.lightbox} onClick={closeLightbox}>
          <button className={styles.closeBtn} onClick={closeLightbox}>
            <X size={32} />
          </button>

          <button
            className={`${styles.navBtn} ${styles.prev}`}
            onClick={(e) => { e.stopPropagation(); lightboxApi?.scrollPrev() }}
          >
            <ChevronLeft size={40} />
          </button>

          <div className={styles.lightboxEmbla} ref={lightboxRef} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxContainer}>
              {visualData.map((item, i) => (
                <div className={styles.lightboxSlide} key={`full-${i}`}>
                  {renderMedia(item, i, true)}
                </div>
              ))}
            </div>
          </div>

          <button
            className={`${styles.navBtn} ${styles.next}`}
            onClick={(e) => { e.stopPropagation(); lightboxApi?.scrollNext() }}
          >
            <ChevronRight size={40} />
          </button>
        </div>
      )}
    </div>
  )
}