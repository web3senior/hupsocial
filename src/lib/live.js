/**
 * @file lib/live.js
 * @description What a live stream is, for the browser and the server alike: where the media
 * server lives, the limits a stream is held to, and who may start one. The video never passes
 * through this app; it goes from the streamer's browser to MediaMTX and from there to viewers.
 */

const trimSlash = (value) => String(value || '').replace(/\/+$/, '')

// A production build with no override talks to the live server; local dev sets its own in .env
const DEFAULT_MEDIA_URL = process.env.NODE_ENV === 'production' ? 'https://live.huplabs.com' : ''

// WHIP/WHEP endpoint of the media server
export const LIVE_MEDIA_URL = trimSlash(process.env.NEXT_PUBLIC_LIVE_MEDIA_URL) || DEFAULT_MEDIA_URL
// cidex/live-streams.js, which answers "is this wallet live?" without an app invocation
export const LIVE_STATUS_URL = trimSlash(process.env.NEXT_PUBLIC_LIVE_STATUS_URL) || (LIVE_MEDIA_URL ? `${LIVE_MEDIA_URL}/status` : '')

export const liveIsConfigured = Boolean(LIVE_MEDIA_URL && LIVE_STATUS_URL)

// 'premium' keeps going live to Premium members and the admin; 'everyone' opens it
export const LIVE_ACCESS = 'premium'

export const LIVE_TITLE_MAX = 120
export const LIVE_STARTS_PER_HOUR = 12

export const LIVE_VIDEO = { width: 1280, height: 720, frameRate: 30 }
export const LIVE_VIDEO_BITRATE = 2_500_000
export const LIVE_AUDIO_BITRATE = 96_000

export const LIVE_MODES = [
  { id: 'camera', label: 'Camera' },
  { id: 'screen', label: 'Screen' },
  { id: 'both', label: 'Screen + camera' },
]

export const whipUrl = (id) => `${LIVE_MEDIA_URL}/live/${id}/whip`
export const whepUrl = (id) => `${LIVE_MEDIA_URL}/live/${id}/whep`
export const liveStatusUrl = (wallet) => `${LIVE_STATUS_URL}/${String(wallet || '').toLowerCase()}`

export const cleanLiveTitle = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIVE_TITLE_MAX)

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** "1.2K watching" */
export const viewersLabel = (count) => `${compact.format(Math.max(0, Number(count) || 0))} watching`

/** "1:04:09" since the stream started */
export const liveDuration = (startedAt, now = Date.now()) => {
  const start = startedAt ? new Date(startedAt).getTime() : NaN
  if (!Number.isFinite(start)) return '0:00'
  const total = Math.max(0, Math.floor((now - start) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}
