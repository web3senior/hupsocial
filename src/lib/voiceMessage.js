/**
 * @file lib/voiceMessage.js
 * @description Voice messages: what a recording is stored as, and the numbers drawn for it. Pure,
 * so the browser and the routes check a recording against the same rules.
 */

export const MAX_VOICE_SECONDS = 300
export const MIN_VOICE_SECONDS = 1
// Speech stays clear at this rate, and five minutes come to about 1.2 MB
export const VOICE_BITS_PER_SECOND = 32_000

export const WAVEFORM_BARS = 40
export const WAVEFORM_MAX = 100
const MAX_WAVEFORM_BARS = 64

// Asked of the recorder in order: Chrome and Firefox record Opus in WebM, older Safari MP4 only
export const VOICE_RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export const VOICE_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg']

const EXTENSIONS = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }

/** "audio/webm;codecs=opus" → "audio/webm" */
export const baseMimeType = (value) =>
  String(value ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()

/** @returns {string} the first type this browser's recorder takes, '' to leave it to the browser */
export const pickRecorderType = (isSupported) =>
  VOICE_RECORDER_TYPES.find((type) => {
    try {
      return isSupported(type)
    } catch {
      return false
    }
  }) ?? ''

/** @returns {string} "voice-1800000000000.webm" */
export const voiceFileName = (mimeType, now = Date.now()) => `voice-${now}.${EXTENSIONS[mimeType] ?? 'bin'}`

/**
 * The loudest reading of each stretch, scaled so the loudest stretch fills the bar.
 * @param {number[]} samples loudness readings from 0 to 1, in the order taken
 * @returns {number[]} `bars` whole numbers from 0 to WAVEFORM_MAX, or none without samples
 */
export const buildWaveform = (samples, bars = WAVEFORM_BARS) => {
  const levels = (Array.isArray(samples) ? samples : []).filter(Number.isFinite).map((level) => Math.min(1, Math.max(0, level)))
  if (levels.length === 0) return []

  const peaks = Array.from({ length: bars }, (_, bar) => {
    const from = Math.floor((bar * levels.length) / bars)
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / bars))
    return Math.max(...levels.slice(from, to))
  })

  const loudest = Math.max(...peaks)
  if (loudest === 0) return peaks.map(() => 0)
  return peaks.map((peak) => Math.round((peak / loudest) * WAVEFORM_MAX))
}

/**
 * A waveform from anyone, made safe to draw: it only ever sets the height of a bar.
 * @returns {number[]|undefined}
 */
export const cleanWaveform = (value) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WAVEFORM_BARS) return undefined
  if (!value.every((level) => typeof level === 'number' && Number.isFinite(level))) return undefined
  return value.map((level) => Math.round(Math.min(WAVEFORM_MAX, Math.max(0, level))))
}

/** "0:07", "1:05", "1:02:03" */
export const formatVoiceDuration = (seconds) => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
