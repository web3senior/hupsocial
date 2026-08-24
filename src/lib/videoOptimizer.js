/**
 * Re-encodes a video in the browser before it is uploaded.
 *
 * Phone footage is the worst thing to stream through an IPFS gateway: an iPhone records HEVC at
 * ~60 MB a minute, and HEVC in a .mov does not even play on Android or desktop Chrome. Nothing
 * downstream (a gateway, a feed card) can fix that after the fact without a transcoding service,
 * so the fix happens where the file is: WebCodecs decodes and re-encodes it on the device to
 * H.264 at a web bitrate, capped at 1280 px on the long edge, in an MP4 with the index up front so
 * playback can start before the file has arrived.
 *
 * Everything here is best-effort. Any browser that cannot do it — no WebCodecs, a source it cannot
 * decode, an encoder it does not have — uploads the original, exactly as before. The upload path
 * never depends on this succeeding.
 *
 * The heavy lifting is mediabunny (demux → WebCodecs → mux). It is imported lazily so the composer
 * bundle does not carry it for a text post.
 */

/* Long edge of the output. 720p-class: sharp on a phone and a feed card, a fraction of 1080p's bytes. */
const MAX_EDGE = 1280

/* H.264 at this rate is visually clean at 720p and streams comfortably over cellular. */
const TARGET_BITRATE = 2_500_000

/* A source that is already H.264, within the size cap and at or under this rate is left alone:
   re-encoding it would cost the phone a minute of CPU to save nothing worth having. */
const ACCEPTABLE_BITRATE = 3_500_000

const abortError = () => new DOMException('Optimisation cancelled', 'AbortError')

/**
 * Whether this browser can run the optimiser at all. Cheap and synchronous, so the composer can
 * decide up front whether a tile will show an "Optimizing" phase.
 * @returns {boolean}
 */
export const canOptimizeVideo = () =>
  typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'

const outputName = (name) => `${(name || 'video').replace(/\.[^.]+$/, '')}.mp4`

/* H.264 wants even dimensions; keep the aspect ratio and land on the nearest even pair */
const scaledDimensions = (width, height) => {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  }
}

async function convert(file, { onProgress, signal }) {
  if (signal?.aborted) throw abortError()

  const { Input, Output, Conversion, ConversionCanceledError, BlobSource, BufferTarget, Mp4OutputFormat, MP4, QTFF, WEBM, MATROSKA, canEncodeVideo } =
    await import('mediabunny')

  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] })

  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack || !(await videoTrack.canDecode())) return null

  const duration = await input.computeDuration()
  const longEdge = Math.max(videoTrack.displayWidth, videoTrack.displayHeight)
  const sourceBitrate = duration > 0 ? (file.size * 8) / duration : Infinity
  if (videoTrack.codec === 'avc' && longEdge <= MAX_EDGE && sourceBitrate <= ACCEPTABLE_BITRATE) return null

  const { width, height } = scaledDimensions(videoTrack.displayWidth, videoTrack.displayHeight)
  if (!(await canEncodeVideo('avc', { width, height, bitrate: TARGET_BITRATE }))) return null

  const audioTrack = await input.getPrimaryAudioTrack()

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    video: { width, height, fit: 'contain', codec: 'avc', bitrate: TARGET_BITRATE },
    /* No bitrate on purpose: AAC sources (every phone recording) are copied untouched, only
       Opus/other sources are re-encoded */
    audio: { codec: 'aac' },
  })

  /* iPhone .mov files carry timecode and metadata tracks that have no place in the output —
     dropping those is fine. Dropping the picture or the sound is not. */
  const lostEssentialTrack = conversion.discardedTracks.some(({ track }) => track === videoTrack || track === audioTrack)
  if (!conversion.isValid || lostEssentialTrack) return null

  conversion.onProgress = (progress) => onProgress?.(Math.min(1, progress))

  const cancel = () => conversion.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await conversion.execute()
  } catch (error) {
    if (signal?.aborted || error instanceof ConversionCanceledError) throw abortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const buffer = output.target.buffer
  if (!buffer) return null

  /* For an H.264 source the only point was size, so an output that is not smaller is discarded.
     An HEVC source is converted regardless — compatibility was the point there. */
  if (videoTrack.codec === 'avc' && buffer.byteLength >= file.size) return null

  return { file: new File([buffer], outputName(file.name), { type: 'video/mp4' }), width, height, duration }
}

/**
 * Produces a web-friendly MP4 from a video the user picked, or `null` when the original should be
 * uploaded as-is (unsupported browser, undecodable source, already efficient, or any failure).
 * @param {File} file
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [transfer]
 *   `onProgress` receives the share of the clip processed (0–1); `signal` cancels the encode,
 *   which then rejects with an AbortError — the one error this function lets through.
 * @returns {Promise<{ file: File, width: number, height: number, duration: number } | null>}
 */
export async function optimizeVideo(file, transfer = {}) {
  if (!canOptimizeVideo()) return null

  try {
    return await convert(file, transfer)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    console.warn('[video] optimisation skipped, uploading the original:', error?.message || error)
    return null
  }
}
