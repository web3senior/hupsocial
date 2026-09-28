/**
 * @file lib/whip.js
 * @description Sends a MediaStream to the media server (WHIP) and receives one from it (WHEP)
 * over the browser's own RTCPeerConnection. One HTTP exchange sets each connection up; the
 * video then flows peer to peer with the server.
 */

import { LIVE_AUDIO_BITRATE, LIVE_VIDEO_BITRATE } from '@/lib/live'

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
const ICE_GATHER_TIMEOUT_MS = 2000

export class LiveConnectionError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'LiveConnectionError'
    this.status = status
  }
}

// The offer is sent once with its candidates in it, so gathering has to finish (or time out) first
const iceGathered = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', check)
  })

const exchange = async (pc, url, key, signal) => {
  await pc.setLocalDescription(await pc.createOffer())
  await iceGathered(pc)

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: pc.localDescription.sdp,
    signal,
  })
  if (response.status !== 201) {
    throw new LiveConnectionError(response.status === 404 ? 'The stream is not live' : 'The media server refused the connection', response.status)
  }

  const location = response.headers.get('Location')
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() })
  return location ? new URL(location, url).toString() : null
}

const capBitrate = async (pc) => {
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue
    const parameters = sender.getParameters()
    if (!parameters.encodings?.length) parameters.encodings = [{}]
    parameters.encodings[0].maxBitrate = sender.track.kind === 'video' ? LIVE_VIDEO_BITRATE : LIVE_AUDIO_BITRATE
    await sender.setParameters(parameters).catch(() => {})
  }
}

const closer = (pc, resource, key) => {
  let closed = false
  return () => {
    if (closed) return
    closed = true
    pc.close()
    if (!resource) return
    fetch(resource, { method: 'DELETE', keepalive: true, headers: key ? { Authorization: `Bearer ${key}` } : {} }).catch(() => {})
  }
}

/**
 * @param {{url: string, key: string, stream: MediaStream, signal?: AbortSignal}} options
 * @returns {Promise<{pc: RTCPeerConnection, close: () => void}>}
 */
export const publishStream = async ({ url, key, stream, signal }) => {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
  try {
    for (const track of stream.getTracks()) pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] })
    const resource = await exchange(pc, url, key, signal)
    await capBitrate(pc)
    return { pc, close: closer(pc, resource, key) }
  } catch (error) {
    pc.close()
    throw error
  }
}

/**
 * @param {{url: string, signal?: AbortSignal}} options
 * @returns {Promise<{pc: RTCPeerConnection, stream: MediaStream, close: () => void}>}
 */
export const playStream = async ({ url, signal }) => {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
  const stream = new MediaStream()
  try {
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.addEventListener('track', (event) => stream.addTrack(event.track))
    const resource = await exchange(pc, url, null, signal)
    return { pc, stream, close: closer(pc, resource, null) }
  } catch (error) {
    pc.close()
    throw error
  }
}
