'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { ArrowLeftIcon, ArrowRightIcon, CornersOutIcon, PauseIcon, PlayIcon, SparkleIcon, SpeakerHighIcon, SpeakerSlashIcon, XIcon } from '@phosphor-icons/react'
import styles from './Gallery.module.scss'
import useMediaZoom from '@/hooks/useMediaZoom'
import { primaryGateway } from '@/lib/ipfsGateways'
import { lockPageScroll, unlockPageScroll } from '@/lib/scrollLock'
import { resolveIPFSUrl, resolveIPFSImageUrl, resolveStorageStreamUrls } from '@/lib/storageHelper'
import { DEFAULT_SOUND_PREFS, loadSoundPrefs, saveSoundPrefs } from '@/lib/soundPrefs'
import { useAutoplayPreference } from '@/hooks/useAutoplayPreference'

// Reserve the media's natural ratio so the whole image is always visible
// (X-style, no cropping); max-height in CSS keeps very tall assets in check.
const getAspectRatio = (item) => {
  if (item?.width && item?.height) {
    return item.width / item.height
  }
  // Unknown dimensions: let the media size itself naturally after load
  return null
}

// GIFs are pinned like any other image, so the mime type is the only marker.
// Items stored before mimeType was recorded simply keep animating.
const isGif = (item) => item?.mimeType === 'image/gif'

// Only assets that go through a compression proxy can be served as a still first
// frame — a GIF hotlinked from an external URL has no paused rendition to show.
const supportsStill = (item) => Boolean(item?.cid) && !item.cid.startsWith('http')

export default function MediaGallery({ data = [] }) {
  // State for gallery behavior
  const autoplay = useAutoplayPreference()
  /* Keyed by index and fed by the elements' own play/pause events, so the play button reflects
     what each video is actually doing rather than what we last asked it to do. */
  const [playingVideos, setPlayingVideos] = useState({})
  /* Which inline players have rendered real frames — the still stays over the box until then.
     Keyed by index like playingVideos, and never unset: a paused player shows its own frame. */
  const [startedVideos, setStartedVideos] = useState({})
  /* Which stills have arrived (or failed), so the loading sweep stops with the download */
  const [loadedStills, setLoadedStills] = useState({})
  const [isMuted, setIsMuted] = useState(true)
  const volumeRef = useRef(DEFAULT_SOUND_PREFS.volume)
  const [revealedItems, setRevealedItems] = useState({})
  // GIFs open paused on their first frame; these track which ones the reader started
  const [playingGifs, setPlayingGifs] = useState({})
  const [loadingGifs, setLoadingGifs] = useState({})

  // State for Lightbox (Maximize)
  const [selectedIndex, setSelectedIndex] = useState(null)

  const videoRefs = useRef([])
  // The lightbox renders a second <video> per slide; these are kept apart from the inline
  // players so handing playback from one to the other is explicit rather than accidental.
  const lightboxVideoRefs = useRef([])
  const GATEWAY_URL = primaryGateway()

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
  const lightboxRef = useRef(null)
  const lightboxScrollRef = useRef(null)
  const lightboxSlideRefs = useRef([])

  // Pinch / wheel / double-tap zoom on the image currently filling the lightbox.
  // Videos keep their native controls, so they are left out of the gesture layer.
  const zoom = useMediaZoom({
    containerRef: lightboxRef,
    enabled: isLightboxOpen && visualData[selectedIndex]?.type !== 'video',
    resetKey: selectedIndex,
  })

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
      if (zoom.zoomedRef.current) return // a zoomed image pans instead of scrolling the strip
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
    zoom.reset(false) // release the frozen scroller before moving the strip
    scrollLightboxTo((selectedIndex - 1 + visualData.length) % visualData.length)
  }

  const handleNext = (e) => {
    e.stopPropagation()
    zoom.reset(false)
    scrollLightboxTo((selectedIndex + 1) % visualData.length)
  }

  // Video visibility observer. Scrolling a video out of view always pauses it — a player the
  // reader can no longer see should not keep running — but starting one is gated on the
  // autoplay preference, which is off unless they turned it on in Settings.
  useEffect(() => {
    const observerOptions = { threshold: 0.6 }
    const handleIntersection = (entries) => {
      entries.forEach((entry) => {
        const video = entry.target
        if (entry.isIntersecting) {
          if (autoplay) video.play().catch(() => {})
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
  }, [data, autoplay])

  const handleReveal = (index, e) => {
    e.stopPropagation()
    setRevealedItems((prev) => ({ ...prev, [index]: true }))
  }

  // Lock the page scroller while the lightbox is open. Shared with every modal through
  // lib/scrollLock.js — it is refcounted, so a lightbox opened from inside a dialog
  // doesn't unlock the page out from under the dialog on close.
  useEffect(() => {
    if (!isLightboxOpen) return
    lockPageScroll()
    return unlockPageScroll
  }, [isLightboxOpen])

  /* One player at a time. Opening the lightbox silences every inline card — otherwise the
     card keeps running (audibly, once unmuted) underneath the modal — and only the slide
     in view plays, picking up from wherever its inline twin had got to. */
  useEffect(() => {
    if (!isLightboxOpen) return
    videoRefs.current.forEach((video) => video && video.pause())
    lightboxVideoRefs.current.forEach((video, i) => {
      if (!video) return
      if (i !== selectedIndex) {
        video.pause()
        return
      }
      const inline = videoRefs.current[i]
      if (inline && Number.isFinite(inline.currentTime)) video.currentTime = inline.currentTime
      video.play().catch(() => {})
    })
  }, [isLightboxOpen, selectedIndex])

  const openLightbox = (index, e) => {
    /* Fired from inside the card, whose own click would otherwise open the post */
    e.stopPropagation()
    setSelectedIndex(index)
  }

  const closeLightbox = () => {
    /* Carry the position (and whether it was running) back to the inline card, so closing
       the modal continues the same video rather than restarting it or leaving two running. */
    if (selectedIndex !== null) {
      const fullscreen = lightboxVideoRefs.current[selectedIndex]
      const inline = videoRefs.current[selectedIndex]
      if (fullscreen && inline) {
        inline.currentTime = fullscreen.currentTime
        if (!fullscreen.paused) inline.play().catch(() => {})
      }
      lightboxVideoRefs.current.forEach((video) => video && video.pause())
    }
    setSelectedIndex(null)
  }

  const toggleInlinePlayback = (index, e) => {
    /* The post behind the gallery opens on click — starting a video should not */
    e.stopPropagation()
    const video = videoRefs.current[index]
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  if (!data.length) return null

  /* `still` asks the compression proxy for the first frame only — the paused
     rendition of an animated GIF, and a lighter download than the animated one */
  const resolveUrl = (item, still = false) => {
    const imageOptions = still ? { still: true } : {}
    if (item?.storage === 'IPFS') {
      /* Images go through the sharp compression proxy; video/audio keep native gateway streaming */
      if (item.type === 'video' || item.type === 'audio') return resolveIPFSUrl(item.cid)
      return resolveIPFSImageUrl(item.cid, imageOptions)
    }
    if (item.cid) {
      if (item.cid.startsWith('http')) return item.cid
      if (item.type === 'video' || item.type === 'audio') return `${GATEWAY_URL}${item.cid}`
      return resolveIPFSImageUrl(item.cid, imageOptions)
    }
    return ''
  }

  /* Videos pinned since posters shipped carry their own still CID. Older ones have none, and
     fall back to the browser's default behaviour of showing the first decoded frame. */
  const resolvePosterUrl = (item) => {
    if (item?.type !== 'video' || !item?.poster) return undefined
    if (item.poster.startsWith('http')) return item.poster
    return resolveIPFSImageUrl(item.poster, { width: 640 })
  }

  /* Gateway URLs for a video in the order the browser should try them — the range-capable one
     first (see resolveIPFSStreamUrls), the rest as fallbacks should it fail to load */
  const resolveVideoSources = (item) => {
    const cid = item?.cid || ''
    if (!cid) return []
    if (cid.startsWith('http')) return [cid]
    return resolveStorageStreamUrls(cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`)
  }

  /* The inline preview is a data URL the composer put in the post (see lib/videoPoster). Post
     content is authored by anyone, so only accept an embedded image — never a remote URL that
     would make every reader's browser call out to a host of the author's choosing. */
  const resolvePreview = (item) =>
    typeof item?.preview === 'string' && item.preview.startsWith('data:image/') && item.preview.length <= 8192
      ? item.preview
      : undefined

  const toggleGif = (index, item, e) => {
    e.stopPropagation()
    if (playingGifs[index]) {
      setPlayingGifs((prev) => ({ ...prev, [index]: false }))
      return
    }
    // Fetch the animated rendition before swapping the src, otherwise the tile
    // blanks out for as long as the (much heavier) animation takes to arrive
    setLoadingGifs((prev) => ({ ...prev, [index]: true }))
    const preload = new Image()
    const play = () => {
      setLoadingGifs((prev) => ({ ...prev, [index]: false }))
      setPlayingGifs((prev) => ({ ...prev, [index]: true }))
    }
    preload.onload = play
    preload.onerror = play // let the <img> surface the failure itself
    preload.src = resolveUrl(item)
  }

  // Helper to render visual media content (image / video only)
  const renderMedia = (item, i, isFullscreen = false) => {
    const isVideo = item.type === 'video'
    // Inline GIFs stay on their first frame until played; fullscreen always animates
    const isPaused = isGif(item) && supportsStill(item) && !isFullscreen && !playingGifs[i]
    const url = resolveUrl(item, isPaused)
    const isBlurred = item.spoiler && !revealedItems[i] && !isFullscreen
    // Only the image on the visible lightbox slide carries the zoom transform
    const isZoomTarget = isFullscreen && !isVideo && i === selectedIndex

    /* The lightbox has native controls; an inline card has none, so without this a reader
       whose autoplay is off would be looking at a still frame with no way to start it. */
    const showPlayButton = isVideo && !isFullscreen && !isBlurred && !playingVideos[i]
    const posterUrl = isVideo ? resolvePosterUrl(item) : undefined
    const preview = isVideo ? resolvePreview(item) : undefined
    /* The still is an <img> of our own over the inline player, not just the `poster` attribute.
       A <video> paints nothing until its poster has downloaded — a separate request through the
       gateway proxy — so the card was a blank box for that long (white, in light mode), and Safari
       drops the poster the moment loading starts. Our image is fetched at high priority, sits on
       the blurred inline preview while it travels, and stays until real frames render. */
    const showStill = isVideo && !isFullscreen && !startedVideos[i]
    const isAwaitingStill = showStill && Boolean(posterUrl) && !preview && !loadedStills[i]
    const blur = isBlurred ? 'blur(40px)' : 'none'
    const markStillLoaded = () => setLoadedStills((previous) => (previous[i] ? previous : { ...previous, [i]: true }))

    return (
      <div
        className={styles.mediaContainer}
        data-video={isVideo ? '' : undefined}
        data-fullscreen={isFullscreen ? '' : undefined}
        data-loading={isAwaitingStill ? '' : undefined}
      >
        {isVideo ? (
          <video
            ref={(el) => {
              if (isFullscreen) lightboxVideoRefs.current[i] = el
              else videoRefs.current[i] = el
              applyStoredVolume(el)
            }}
            poster={posterUrl}
            /* In-feed players are started by the visibility observer, so there is nothing to
               gain from buffering ahead of that — the poster is what the card shows until then.
               The lightbox starts its visible slide explicitly, which loads on demand. */
            preload="none"
            loop
            muted={isMuted}
            controls={isFullscreen}
            onVolumeChange={isFullscreen ? handleVideoVolumeChange : undefined}
            /* Only the inline element reports into the card's play button; the lightbox twin
               shares the index but not the state, so it must not overwrite it. */
            onPlay={isFullscreen ? undefined : () => setPlayingVideos((previous) => ({ ...previous, [i]: true }))}
            onPause={isFullscreen ? undefined : () => setPlayingVideos((previous) => ({ ...previous, [i]: false }))}
            /* `playing`, not `play`: the first fires once frames are actually being rendered,
               which is the moment the still can go without a blank in between */
            onPlaying={isFullscreen ? undefined : () => setStartedVideos((previous) => (previous[i] ? previous : { ...previous, [i]: true }))}
            playsInline
            className={isFullscreen ? styles.fullscreenVideo : styles.videoPlayer}
            style={{ filter: blur }}
          >
            {/* The browser moves on to the next <source> when one fails to load */}
            {resolveVideoSources(item).map((source) => (
              <source key={source} src={source} />
            ))}
          </video>
        ) : (
          <img
            ref={isZoomTarget ? zoom.targetRef : undefined}
            src={url}
            alt={item.alt || `Gallery item ${i}`}
            className={isFullscreen ? styles.fullscreenImage : styles.displayImage}
            style={{ filter: isBlurred ? 'blur(40px)' : 'none', ...(isZoomTarget ? zoom.style : null) }}
            draggable={false}
          />
        )}
        {showStill && (
          <div className={styles.videoStill} aria-hidden="true" style={{ filter: blur }}>
            {preview && <img className={styles.videoStill__preview} src={preview} alt="" draggable={false} />}
            {posterUrl && (
              <img
                className={styles.videoStill__poster}
                src={posterUrl}
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
                draggable={false}
                onLoad={markStillLoaded}
                onError={markStillLoaded}
              />
            )}
          </div>
        )}
        {showPlayButton && (
          <button
            type="button"
            className={styles.playOverlay}
            aria-label="Play video"
            onClick={(e) => toggleInlinePlayback(i, e)}
          >
            <span className={styles.playOverlay__icon}>
              <PlayIcon size={26} weight="fill" />
            </span>
          </button>
        )}
        {isBlurred && (
          <div className={styles.spoilerOverlay} onClick={(e) => handleReveal(i, e)}>
            <span>Spoiler</span>
          </div>
        )}
        {/* Set at upload from the file's own Content Credentials (see lib/aiProvenance) — this
            reports what the asset declared about itself, so it is never on a post that did not
            arrive carrying it, and never absent from one that did */}
        {item.aiGenerated && (
          <span className={styles.aiBadge}>
            <SparkleIcon size={12} weight="fill" />
            Made with AI
          </span>
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
                  style={!isCarousel && getAspectRatio(item) ? { '--media-ratio': getAspectRatio(item) } : undefined}
                  /* Lets the stylesheet size a video's box from the ratio alone, so it is the
                     same size before and after the still arrives */
                  data-ratio={!isCarousel && getAspectRatio(item) ? '' : undefined}
                  /* An image maximises on tap. A video plays or pauses instead — the control bar's
                     maximise button is the way into the lightbox for it. */
                  onClick={(e) => (item.type === 'video' ? toggleInlinePlayback(i, e) : openLightbox(i, e))}
                >
                  {renderMedia(item, i)}

                  {isGif(item) && supportsStill(item) && (
                    <button
                      className={styles.gifToggle}
                      data-loading={loadingGifs[i] ? '' : undefined}
                      onClick={(e) => toggleGif(i, item, e)}
                      aria-label={playingGifs[i] ? 'Pause GIF' : 'Play GIF'}
                      aria-pressed={Boolean(playingGifs[i])}
                    >
                      {playingGifs[i] ? <PauseIcon size={12} weight="fill" /> : <PlayIcon size={12} weight="fill" />}
                      <span>GIF</span>
                    </button>
                  )}

                  {item.type === 'video' && (
                    <div className={styles.controls}>
                      {/* A tap on the card plays or pauses it, so maximising needs a control of its own */}
                      <button
                        className={styles.iconButton}
                        onClick={(e) => openLightbox(i, e)}
                        aria-label="Maximize video"
                      >
                        <CornersOutIcon size={16} />
                      </button>
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
        <div className={styles.lightbox} ref={lightboxRef} onClick={(e) => { e.stopPropagation(); closeLightbox() }}>
          <button className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); closeLightbox() }} aria-label={`Close fullscreen view`}>
            <XIcon size={20} />
          </button>

          {visualData.length > 1 && (
            <button
              className={`${styles.navBtn} ${styles.prev}`}
              onClick={handlePrev}
              aria-label={`Previous media`}
            >
              <ArrowLeftIcon size={24} />
            </button>
          )}

          <div
            className={styles.lightboxScroll}
            ref={lightboxScrollRef}
            data-zoomed={zoom.isZoomed ? '' : undefined}
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
              aria-label={`Next media`}
            >
              <ArrowRightIcon size={24} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}