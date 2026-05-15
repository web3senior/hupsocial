'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { Volume2, VolumeX, Maximize2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Gallery.module.scss'

export default function MediaGallery({ data = [] }) {
  // State for gallery behavior
  const [isMuted, setIsMuted] = useState(true)
  const [revealedItems, setRevealedItems] = useState({})
  const [resolvedUrls, setResolvedUrls] = useState({})
  
  // State for Lightbox (Maximize)
  const [selectedIndex, setSelectedIndex] = useState(null)
  
  const videoRefs = useRef([])
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'
  const isCarousel = data.length > 1

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

  // Resolve 0G Hashes
  useEffect(() => {
    const urlsToRevoke = []
    const load0GAssets = async () => {
      const newResolved = { ...resolvedUrls }
      for (const item of data) {
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
    return () => {
      urlsToRevoke.forEach(url => URL.revokeObjectURL(url))
    }
  }, [data])

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

  // Helper to render media content
  const renderMedia = (item, i, isFullscreen = false) => {
    const isVideo = item.type === 'video'
    let url = ''
    if (item?.storage === '0G') {
      url = resolvedUrls[item.cid] || ''
    } else if (item.cid) {
      url = item.cid.startsWith('http') ? item.cid : `${GATEWAY_URL}${item.cid}`
    }

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
      <div
        className={isCarousel ? styles.embla : styles.singleView}
        ref={isCarousel ? emblaRef : null}
      >
        <div className={isCarousel ? styles.embla__container : styles.singleContainer}>
          {data.map((item, i) => (
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
                      onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
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

      {/* Lightbox Overlay */}
      {selectedIndex !== null && (
        <div className={styles.lightbox} onClick={closeLightbox}>
          <button className={styles.closeBtn} onClick={closeLightbox}>
            <X size={32} />
          </button>
          
          <button 
            className={`${styles.navBtn} ${styles.prev}`} 
            onClick={(e) => { e.stopPropagation(); lightboxApi?.scrollPrev(); }}
          >
            <ChevronLeft size={40} />
          </button>

          <div className={styles.lightboxEmbla} ref={lightboxRef} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxContainer}>
              {data.map((item, i) => (
                <div className={styles.lightboxSlide} key={`full-${i}`}>
                  {renderMedia(item, i, true)}
                </div>
              ))}
            </div>
          </div>

          <button 
            className={`${styles.navBtn} ${styles.next}`} 
            onClick={(e) => { e.stopPropagation(); lightboxApi?.scrollNext(); }}
          >
            <ChevronRight size={40} />
          </button>
        </div>
      )}
    </div>
  )
}