'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { CaretLeftIcon, CaretRightIcon, SpeakerHighIcon, SpeakerSlashIcon, XIcon } from '@phosphor-icons/react'
import styles from './Gallery.module.scss'
import { resolveIPFSUrl } from '@/lib/storageHelper'

// Clamp to Twitter/Instagram-style bounds so a single very tall or very wide
// asset can't blow out the feed layout while still reserving accurate space.
const MIN_ASPECT_RATIO = 0.56 // 9:16 portrait
const MAX_ASPECT_RATIO = 1.91 // widescreen landscape

const getAspectRatio = (item) => {
  if (item?.width && item?.height) {
    return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, item.width / item.height))
  }
  return 1
}

// Persisted sound preferences shared by every gallery instance
const SOUND_PREFS_KEY = 'hup_media_sound'
const DEFAULT_SOUND_PREFS = { volume: 1, muted: true }

const loadSoundPrefs = () => {
  if (typeof window === 'undefined') return DEFAULT_SOUND_PREFS
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_PREFS_KEY))
    return {
      volume: typeof stored?.volume === 'number' ? Math.min(1, Math.max(0, stored.volume)) : DEFAULT_SOUND_PREFS.volume,
      muted: typeof stored?.muted === 'boolean' ? stored.muted : DEFAULT_SOUND_PREFS.muted,
    }
  } catch {
    return DEFAULT_SOUND_PREFS
  }
}

const saveSoundPrefs = (prefs) => {
  try {
    localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage may be unavailable (private mode / quota) — preference just won't persist
  }
}

export default function MediaGallery({ data = [] }) {
  // State for gallery behavior
  const [isMuted, setIsMuted] = useState(true)
  const volumeRef = useRef(DEFAULT_SOUND_PREFS.volume)
  const [revealedItems, setRevealedItems] = useState({})
  const [resolvedUrls, setResolvedUrls] = useState({})

  // State for Lightbox (Maximize)
  const [selectedIndex, setSelectedIndex] = useState(null)

  const videoRefs = useRef([])
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/'

  const visualData = data.filter((item) => item.type !== 'audio')
  const audioData = data.filter((item) => item.type === 'audio')
  const isCarousel = visualData.length > 1
  const isLightboxOpen = selectedIndex !== null

  // Main inline carousel (embla)
  const [emblaRef, emblaApi] = useEmblaCarousel({
    active: isCarousel,
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  })

  // Restore persisted sound prefs after mount (post-hydration, so SSR markup stays in sync)
  useEffect(() => {
    const prefs = loadSoundPrefs()
    volumeRef.current = prefs.volume
    setIsMuted(prefs.muted)
    videoRefs.current.forEach((video) => {
      if (video) video.volume = prefs.volume
    })
  }, [])

  // Apply the remembered volume to media elements as they mount
  const applyStoredVolume = (el) => {
    if (el) el.volume = volumeRef.current
  }

  const persistSoundPrefs = (muted) => saveSoundPrefs({ volume: volumeRef.current, muted })

  const toggleMute = (e) => {
    e.stopPropagation()
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    persistSoundPrefs(nextMuted)
  }

  // Fired by the lightbox video's native controls — keep every player in sync
  const handleVideoVolumeChange = (e) => {
    const video = e.currentTarget
    volumeRef.current = video.volume
    setIsMuted(video.muted)
    saveSoundPrefs({ volume: video.volume, muted: video.muted })
  }

  // Audio tracks share the volume preference but not the global video mute
  const handleAudioVolumeChange = (e) => {
    volumeRef.current = e.currentTarget.volume
    persistSoundPrefs(isMuted)
  }

  // Lightbox Carousel (native scroll-snap)
  const lightboxScrollRef = useRef(null)
  const lightboxSlideRefs = useRef([])

  const scrollLightboxTo = (index, behavior = 'smooth') => {
    const container = lightboxScrollRef.current
    const slide = lightboxSlideRefs.current[index]
    if (container && slide) {
      container.scrollTo({ left: slide.offsetLeft, behavior })
    }
  }

  // Mouse-drag-to-scroll for the lightbox (touch scrolls natively). Uses
  // window-level listeners while dragging so a click that follows a real
  // drag can be swallowed without disturbing normal tap-to-close/tap-to-nav.
  const attachDragScroll = (el) => {
    if (!el) return () => {}
    let isDown = false
    let dragged = false
    let startX = 0
    let startScroll = 0

    const onMove = (e) => {
      if (!isDown) return
      const dx = e.clientX - startX
      if (Math.abs(dx) > 5) dragged = true
      el.scrollLeft = startScroll - dx
    }
    const onUp = () => {
      if (!isDown) return
      isDown = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (dragged) {
        const suppressClick = (ev) => {
          ev.stopPropagation()
          ev.preventDefault()
          el.removeEventListener('click', suppressClick, true)
        }
        el.addEventListener('click', suppressClick, true)
      }
    }
    const onDown = (e) => {
      if (e.pointerType === 'touch') return // let native touch scrolling handle this
      isDown = true
      dragged = false
      startX = e.clientX
      startScroll = el.scrollLeft
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }

  // Jump to the opened slide instantly, then track index as the user swipes
  useEffect(() => {
    if (!isLightboxOpen) return
    scrollLightboxTo(selectedIndex, 'auto')

    const container = lightboxScrollRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setSelectedIndex(Number(entry.target.dataset.index))
          }
        })
      },
      { root: container, threshold: 0.6 }
    )
    lightboxSlideRefs.current.forEach((slide) => slide && observer.observe(slide))
    const detachDrag = attachDragScroll(container)
    return () => {
      observer.disconnect()
      detachDrag()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLightboxOpen])

  const handlePrev = (e) => {
    e.stopPropagation()
    scrollLightboxTo((selectedIndex - 1 + visualData.length) % visualData.length)
  }

  const handleNext = (e) => {
    e.stopPropagation()
    scrollLightboxTo((selectedIndex + 1) % visualData.length)
  }

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

  // Lock the page scroller while the lightbox is open. The page scrolls on
  // <html> (Globals.scss sets `overflow: hidden scroll`), so body overflow has
  // no effect. Padding compensates for the hidden scrollbar to avoid layout
  // shift, and restore uses behavior:'instant' to bypass the global
  // scroll-behavior:smooth so the position snaps back exactly where it was.
  useEffect(() => {
    if (!isLightboxOpen) return
    const html = document.documentElement
    const scrollY = window.scrollY
    const scrollbarWidth = window.innerWidth - html.clientWidth
    html.style.overflowY = 'hidden'
    html.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      html.style.overflowY = ''
      html.style.paddingRight = ''
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' })
    }
  }, [isLightboxOpen])

  const openLightbox = (index) => {
    setSelectedIndex(index)
  }

  const closeLightbox = () => {
    setSelectedIndex(null)
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
            ref={
              isFullscreen
                ? applyStoredVolume
                : (el) => {
                    videoRefs.current[i] = el
                    applyStoredVolume(el)
                  }
            }
            src={url}
            loop
            muted={isMuted}
            autoPlay={isFullscreen}
            controls={isFullscreen}
            onVolumeChange={isFullscreen ? handleVideoVolumeChange : undefined}
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
            draggable={false}
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
    <div className={styles.galleryWrapper}>
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
                <div
                  className={styles.mediaItem}
                  style={!isCarousel ? { '--media-ratio': getAspectRatio(item) } : undefined}
                  onClick={(e) => { e.stopPropagation(); openLightbox(i) }}
                >
                  {renderMedia(item, i)}

                  {item.type === 'video' && (
                    <div className={styles.controls}>
                      <button
                        className={styles.iconButton}
                        onClick={toggleMute}
                        aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                      >
                        {isMuted ? <SpeakerSlashIcon size={16} /> : <SpeakerHighIcon size={16} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audioData.length > 0 && (
        <div className={styles.audioTrackList} onClick={(e) => e.stopPropagation()}>
          {audioData.map((item, i) => (
            <div key={`audio-${item.cid}-${i}`} className={styles.audioTrack}>
              <audio
                src={resolveUrl(item)}
                controls
                ref={applyStoredVolume}
                onVolumeChange={handleAudioVolumeChange}
              />
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Overlay */}
      {selectedIndex !== null && (
        <div className={styles.lightbox} onClick={(e) => { e.stopPropagation(); closeLightbox() }}>
          <button className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); closeLightbox() }}>
            <XIcon size={32} />
          </button>

          {visualData.length > 1 && (
            <button
              className={`${styles.navBtn} ${styles.prev}`}
              onClick={handlePrev}
            >
              <CaretLeftIcon size={40} />
            </button>
          )}

          <div
            className={styles.lightboxScroll}
            ref={lightboxScrollRef}
            onClick={(e) => {
              e.stopPropagation()
              // Close on backdrop clicks; the slides fill the viewport, so
              // anything that isn't the media itself counts as backdrop.
              const tag = e.target.tagName
              if (tag !== 'IMG' && tag !== 'VIDEO') closeLightbox()
            }}
          >
            {visualData.map((item, i) => (
              <div
                className={styles.lightboxSlide}
                key={`full-${i}`}
                data-index={i}
                ref={(el) => (lightboxSlideRefs.current[i] = el)}
              >
                {renderMedia(item, i, true)}
              </div>
            ))}
          </div>

          {visualData.length > 1 && (
            <button
              className={`${styles.navBtn} ${styles.next}`}
              onClick={handleNext}
            >
              <CaretRightIcon size={40} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}