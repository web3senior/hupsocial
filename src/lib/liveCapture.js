/**
 * @file lib/liveCapture.js
 * @description Turns the streamer's camera, screen, or both into the one MediaStream that is
 * sent. Screen + camera is drawn onto a canvas with the camera in the corner, so the media
 * server still receives a single picture.
 */

import { LIVE_VIDEO } from '@/lib/live'

const CAMERA_CONSTRAINTS = {
  width: { ideal: LIVE_VIDEO.width },
  height: { ideal: LIVE_VIDEO.height },
  frameRate: { ideal: LIVE_VIDEO.frameRate },
}
const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true }

const INSET_WIDTH_RATIO = 0.22
const INSET_MARGIN = 24
const INSET_RADIUS = 16

// requestAnimationFrame stops in a hidden tab, which is where the streamer's tab is while they
// work in the window they are sharing; a worker's timer keeps ticking
const TICKER_SOURCE = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}'

const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop())

const videoFor = async (stream) => {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream(stream.getVideoTracks())
  await video.play()
  return video
}

const mixAudio = (streams) => {
  const sources = streams.filter((stream) => stream?.getAudioTracks().length)
  if (sources.length === 0) return { track: null, close: () => {} }
  if (sources.length === 1) return { track: sources[0].getAudioTracks()[0], close: () => {} }

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  for (const stream of sources) context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(destination)
  return { track: destination.stream.getAudioTracks()[0], close: () => context.close().catch(() => {}) }
}

const drawContained = (context, video, width, height) => {
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight)
  const w = video.videoWidth * scale
  const h = video.videoHeight * scale
  context.drawImage(video, (width - w) / 2, (height - h) / 2, w, h)
}

const drawInset = (context, video, width, height) => {
  const w = Math.round(width * INSET_WIDTH_RATIO)
  const h = Math.round((w * 9) / 16)
  const x = width - w - INSET_MARGIN
  const y = height - h - INSET_MARGIN

  // Cover crop, so a 4:3 camera fills the 16:9 inset
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight)
  const sw = w / scale
  const sh = h / scale

  context.save()
  context.beginPath()
  if (context.roundRect) context.roundRect(x, y, w, h, INSET_RADIUS)
  else context.rect(x, y, w, h)
  context.clip()
  context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, x, y, w, h)
  context.restore()
}

const compose = async (screen, camera) => {
  const { width, height, frameRate } = LIVE_VIDEO
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })

  const [screenVideo, cameraVideo] = await Promise.all([videoFor(screen), videoFor(camera)])
  const state = { cameraOn: true }

  const draw = () => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    if (screenVideo.videoWidth) drawContained(context, screenVideo, width, height)
    if (state.cameraOn && cameraVideo.videoWidth) drawInset(context, cameraVideo, width, height)
  }

  const tickerUrl = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' }))
  const ticker = new Worker(tickerUrl)
  ticker.onmessage = draw
  ticker.postMessage(Math.round(1000 / frameRate))
  draw()

  return {
    track: canvas.captureStream(frameRate).getVideoTracks()[0],
    state,
    close: () => {
      ticker.terminate()
      URL.revokeObjectURL(tickerUrl)
      screenVideo.srcObject = null
      cameraVideo.srcObject = null
    },
  }
}

const openMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS }).catch(() => null)

const openScreen = () =>
  navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: LIVE_VIDEO.frameRate } },
    audio: true,
  })

/**
 * Opens what the mode needs and hands back the stream to send.
 * @param {'camera'|'screen'|'both'} mode
 * @returns {Promise<{stream: MediaStream, hasMicrophone: boolean, hasCamera: boolean, setMicrophone: (on: boolean) => void, setCamera: (on: boolean) => void, onEnded: (listener: () => void) => void, close: () => void}>}
 */
export const openLiveSource = async (mode) => {
  const opened = []
  const closers = []
  let ended = () => {}

  try {
    let video
    let microphone = null
    let camera = null
    let compositor = null
    const audioSources = []

    if (mode === 'camera') {
      camera = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: MIC_CONSTRAINTS })
      opened.push(camera)
      microphone = camera.getAudioTracks().length ? camera : null
      video = camera.getVideoTracks()[0]
      audioSources.push(camera)
    } else {
      const screen = await openScreen()
      opened.push(screen)
      // The browser's own "Stop sharing" button ends the screen track
      screen.getVideoTracks()[0].addEventListener('ended', () => ended())

      microphone = await openMicrophone()
      if (microphone) opened.push(microphone)
      audioSources.push(screen, microphone)

      if (mode === 'both') {
        camera = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS })
        opened.push(camera)
        compositor = await compose(screen, camera)
        closers.push(compositor.close)
        video = compositor.track
      } else {
        video = screen.getVideoTracks()[0]
      }
    }

    const audio = mixAudio(audioSources)
    closers.push(audio.close)

    const setEnabled = (stream, kind, on) =>
      stream?.getTracks().forEach((track) => {
        if (track.kind === kind) track.enabled = on
      })

    return {
      stream: new MediaStream([video, audio.track].filter(Boolean)),
      hasMicrophone: Boolean(microphone),
      hasCamera: Boolean(camera),
      setMicrophone: (on) => setEnabled(microphone, 'audio', on),
      setCamera: (on) => {
        if (compositor) compositor.state.cameraOn = on
        else setEnabled(camera, 'video', on)
      },
      onEnded: (listener) => {
        ended = listener
      },
      close: () => {
        closers.forEach((close) => close())
        opened.forEach(stopTracks)
      },
    }
  } catch (error) {
    closers.forEach((close) => close())
    opened.forEach(stopTracks)
    throw error
  }
}

/** The sentence for a capture that could not be opened. */
export const captureErrorMessage = (error) => {
  if (error?.name === 'NotAllowedError') return 'Permission was not given'
  if (error?.name === 'NotFoundError') return 'No camera or microphone was found'
  if (error?.name === 'NotReadableError') return 'The camera or microphone is in use by another app'
  return error?.message || 'Could not open the camera or screen'
}
