/**
 * Grabs a still from a video File so a post can render a thumbnail without fetching the video.
 *
 * Without one, every feed card that shows a video has to download enough of it to decode the
 * first frame — over an IPFS gateway that is slow, and it happens for each card on screen. The
 * still is uploaded as its own CID and referenced from the media item, so the video itself is
 * only ever fetched when somebody plays it.
 */

/* Wide enough to stay sharp on a full-width card, small enough that the still costs a fraction
   of what a video frame's worth of gateway traffic would. */
const MAX_POSTER_WIDTH = 640

/* A frame at exactly 0 is often a black fade-in, so nudge into the video — but stay near the
   start, since seeking further means decoding more of the file. */
const SEEK_RATIO = 0.05
const MAX_SEEK_SECONDS = 0.1

/* Decoding happens in the browser's media stack, which can stall on an exotic container. The
   poster is an optimisation, so give up rather than hold the post composer hostage. */
const TIMEOUT_MS = 8000

/**
 * @param {File|Blob} file A video file selected in the composer.
 * @returns {Promise<File|null>} A WebP still, or null when one can't be produced.
 */
export function captureVideoPoster(file) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !file) return resolve(null)

    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
      resolve(result)
    }

    const timer = setTimeout(() => finish(null), TIMEOUT_MS)

    video.preload = 'metadata'
    video.muted = true
    /* Required for the frame to decode on iOS, which otherwise refuses to render video
       outside a user-initiated fullscreen playback */
    video.playsInline = true

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      video.currentTime = Math.min(MAX_SEEK_SECONDS, duration * SEEK_RATIO)
    }

    video.onseeked = () => {
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) return finish(null)

        const scale = Math.min(1, MAX_POSTER_WIDTH / width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)

        const context = canvas.getContext('2d')
        if (!context) return finish(null)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(
          (blob) => {
            if (!blob) return finish(null)
            const base = (file.name || 'video').replace(/\.[^.]+$/, '')
            finish(new File([blob], `${base}-poster.webp`, { type: 'image/webp' }))
          },
          'image/webp',
          0.8
        )
      } catch {
        /* A cross-origin or DRM-protected source taints the canvas — no poster, no problem */
        finish(null)
      }
    }

    video.onerror = () => finish(null)
    video.src = objectUrl
  })
}
