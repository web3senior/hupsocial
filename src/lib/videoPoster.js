/**
 * Grabs a still from a video File so a post can render a thumbnail without fetching the video.
 *
 * Without one, every feed card that shows a video has to download enough of it to decode the
 * first frame — over an IPFS gateway that is slow, and it happens for each card on screen. The
 * still is uploaded as its own CID and referenced from the media item, so the video itself is
 * only ever fetched when somebody plays it.
 *
 * The same frame also yields an inline preview: a 16px-wide copy encoded as a data URL and stored
 * in the media item itself, so a card has a (blurred) picture on its very first paint — before
 * the still's own request has even left the browser. The still used to be the first thing that
 * could paint, and until it arrived a video card was a blank box.
 */

/* Wide enough to stay sharp on a full-width card, small enough that the still costs a fraction
   of what a video frame's worth of gateway traffic would. */
const MAX_POSTER_WIDTH = 640

/* The inline preview is displayed blurred, so 16px across carries all the detail that survives.
   A WebP this size is ~150 bytes; the cap catches an encoder that produced something far larger
   (a PNG fallback on a noisy frame), which is not worth carrying in every copy of the post. */
const PREVIEW_WIDTH = 16
const MAX_PREVIEW_LENGTH = 2000

/* A frame at exactly 0 is often a black fade-in, so nudge into the video — but stay near the
   start, since seeking further means decoding more of the file. */
const SEEK_RATIO = 0.05
const MAX_SEEK_SECONDS = 0.1

/* Decoding happens in the browser's media stack, which can stall on an exotic container. The
   poster is an optimisation, so give up rather than hold the post composer hostage. */
const TIMEOUT_MS = 8000

/**
 * Encodes the tiny preview canvas as compactly as the browser allows. Safari cannot encode WebP
 * from a canvas and silently hands back a PNG instead, so the type of what came back decides
 * whether to fall through to JPEG.
 * @param {HTMLCanvasElement} canvas
 * @returns {string|undefined} A data URL, or undefined when nothing small enough came out.
 */
function encodePreview(canvas) {
  let dataUrl = canvas.toDataURL('image/webp', 0.6)
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.6)
  return dataUrl.length <= MAX_PREVIEW_LENGTH ? dataUrl : undefined
}

/**
 * @param {File|Blob} file A video file selected in the composer.
 * @returns {Promise<{ file: File, preview: string|undefined }|null>} A WebP still plus the inline
 *   preview data URL, or null when no frame could be captured.
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

        /* Downscaled from the still rather than the frame: the intermediate size averages the
           pixels properly instead of point-sampling 16 of them from a 4K frame */
        const previewCanvas = document.createElement('canvas')
        previewCanvas.width = PREVIEW_WIDTH
        previewCanvas.height = Math.max(1, Math.round((PREVIEW_WIDTH * canvas.height) / canvas.width))
        previewCanvas.getContext('2d')?.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height)
        const preview = encodePreview(previewCanvas)

        canvas.toBlob(
          (blob) => {
            if (!blob) return finish(null)
            const base = (file.name || 'video').replace(/\.[^.]+$/, '')
            finish({ file: new File([blob], `${base}-poster.webp`, { type: 'image/webp' }), preview })
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
