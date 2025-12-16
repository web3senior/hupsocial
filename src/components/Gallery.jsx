import React, { useEffect, useRef, useState } from 'react'
import FsLightbox from 'fslightbox-react'
import styles from './Gallery.module.scss'

/**
 * ImageGallery Component
 * Renders a grid of images using FsLightbox for a lightbox experience.
 * Filters the input data to only show items where item.type is NOT 'video'.
 * @param {Array<Object>} data - The array of media items.
 */
export function ImageGallery({ data }) {
  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL

  // State for FsLightbox
  const [toggler, setToggler] = useState(false)
  const [sourceIndex, setSourceIndex] = useState(0)

  // Original useEffect is preserved
  useEffect(() => {
    // console.log('Received data for Image Gallery:', data);
  }, [data])

  // Filter data to only include images (maintaining original filter logic)
  const images = data ? data.filter((item) => item.type !== 'video') : []

  // Create the sources array for FsLightbox
  const sources = images.map((item) => `${GATEWAY_URL}${item.cid}`)

  // Create descriptions array for captions (replaces lightGallery's data-sub-html)
  const descriptions = images.map((item, i) => item.alt || `Image ${i + 1}`)

  return (
    <div className={`${styles.page}`}>
      {images.length > 0 ? (
        <>
          {/* Replaced LightGallery wrapper with a standard div */}
          <div className={styles.imageGrid}>
            {images.map((item, i) => (
              <div
                key={i}
                // Replaced <a> tag with div/button to trigger the lightbox
                className="gallery-item image"
                onClick={(e) => {
                  e.stopPropagation()
                  setSourceIndex(i) // Set the index of the clicked item
                  setToggler(!toggler) // Open the lightbox
                }}
                style={{ cursor: 'pointer' }} // Added style for visual cue
              >
                <img alt={item?.alt || `Gallery image ${i + 1}`} src={`${GATEWAY_URL}${item.cid}`} className="img-responsive" />
              </div>
            ))}
          </div>

          {/* FsLightbox Component */}
          <FsLightbox
            toggler={toggler}
            sources={sources}
            sourceIndex={sourceIndex} // Tells FsLightbox which slide to start on
            descriptions={descriptions} // Used for captions/sub-html
          />
        </>
      ) : (
        <></>
      )}
    </div>
  )
}

/**
 * VideoList Component
 * Renders a simple list of videos with their thumbnails and titles.
 * (No changes needed, as it did not use lightGallery)
 * @param {Array<Object>} data - The array of media items.
 */
export function VideoList({ data, fullHeight }) {
  const [volume, setVolume] = useState(1.0)
  const [isMuted, setIsMuted] = useState(false)

  // Reference to the actual DOM video element
  const videoRef = useRef(null)

  const GATEWAY_URL = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
  const VOLUME_STORAGE_KEY = 'videoVolumeLevel'
  const MUTED_STORAGE_KEY = 'videoMutedState'

  // 2. Load volume and muted state from Local Storage when component mounts
  useEffect(() => {
    // Retrieve volume, default to 1.0 if not found
    const savedVolume = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY))
    if (!isNaN(savedVolume)) {
      setVolume(savedVolume)
    }

    // Retrieve muted state, default to false if not found
    const savedMuted = localStorage.getItem(MUTED_STORAGE_KEY) === 'true'
    setIsMuted(savedMuted)
  }, []) // Empty dependency array ensures this runs once on mount

  // 3. Apply state to the DOM video element whenever state changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = isMuted
    }
  }, [volume, isMuted])

  // 4. Volume Change Handler (Saves the new volume to state and Local Storage)
  const volumechange = useCallback((e) => {
    // Get the new properties directly from the event target
    const newVolume = e.target.volume
    const newMutedState = e.target.muted

    // Update React state
    setVolume(newVolume)
    setIsMuted(newMutedState)

    // Save to Local Storage to persist across page refreshes
    localStorage.setItem(VOLUME_STORAGE_KEY, newVolume)
    localStorage.setItem(MUTED_STORAGE_KEY, newMutedState)

    // Optional: Log the change
    // console.log(`Saved Volume: ${newVolume}, Muted: ${newMutedState} to localStorage.`)
  }, [])

  // Filter data to only include videos
  const videos = data ? data.filter((item) => item.type === 'video') : []

  return (
    <div className={`${styles.page}`}>
      {videos.length > 0 ? (
        <div className={styles.videoGrid}>
          {videos.map((item, i) => (
            <div key={i} className={styles.videoItem} onClick={(e) => e.stopPropagation()}>
              <video
                ref={videoRef}
                className={fullHeight ? styles.fullHeight : ''}
                src={`${GATEWAY_URL}${item.cid}`}
                autoPlay={fullHeight}
                onVolumeChange={volumechange}
                controls
                loop
              />
            </div>
          ))}
        </div>
      ) : (
        <></>
      )}
    </div>
  )
}
