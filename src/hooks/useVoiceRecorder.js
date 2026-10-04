'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  baseMimeType,
  buildWaveform,
  MIN_VOICE_SECONDS,
  pickRecorderType,
  VOICE_BITS_PER_SECOND,
  VOICE_MIME_TYPES,
  voiceFileName,
} from '@/lib/voiceMessage'

const METER_INTERVAL_MS = 100
// Bars drawn while recording: the last few seconds
export const LIVE_BARS = 32

const errorMessage = (error) => {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the microphone for this site and try again'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found on this device'
    case 'NotReadableError':
      return 'The microphone is in use by another app'
    default:
      return 'The microphone could not be started'
  }
}

// The loudest point of the last moment, 0 to 1; the square root lifts quiet speech next to one loud word
const readLevel = (analyser, buffer) => {
  analyser.getByteTimeDomainData(buffer)
  let peak = 0
  for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128)
  return Math.sqrt(peak)
}

/** Whether this page can record at all: the API exists and no permissions policy shuts the microphone off. */
export const canRecordVoice = () => {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false
  const policy = document.permissionsPolicy ?? document.featurePolicy
  try {
    return policy ? policy.allowsFeature('microphone') : true
  } catch {
    return true
  }
}

/**
 * Records a voice message from mount to unmount; the microphone is released on unmount, so it is
 * never left on behind a closed recorder. `elapsed` is in seconds, `levels` the last LIVE_BARS readings.
 */
export function useVoiceRecorder() {
  const [status, setStatus] = useState('starting')
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState([])
  const sessionRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const session = { stream: null, recorder: null, audioContext: null, meter: null, chunks: [], samples: [], startedAt: 0 }

    session.release = () => {
      clearInterval(session.meter)
      session.stream?.getTracks().forEach((track) => track.stop())
      if (session.audioContext && session.audioContext.state !== 'closed') session.audioContext.close().catch(() => {})
    }
    sessionRef.current = session

    // Without Web Audio the recording still runs; the bars stay flat
    const startMeter = () => {
      let analyser = null
      let buffer = null
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        session.audioContext = new AudioContextClass()
        analyser = session.audioContext.createAnalyser()
        analyser.fftSize = 512
        buffer = new Uint8Array(analyser.fftSize)
        session.audioContext.createMediaStreamSource(session.stream).connect(analyser)
        session.audioContext.resume().catch(() => {})
      } catch {
        analyser = null
      }

      session.meter = setInterval(() => {
        session.samples.push(analyser ? readLevel(analyser, buffer) : 0)
        setLevels(session.samples.slice(-LIVE_BARS))
        setElapsed((performance.now() - session.startedAt) / 1000)
      }, METER_INTERVAL_MS)
    }

    const start = async () => {
      if (!canRecordVoice()) {
        setError('This browser cannot record voice messages')
        setStatus('error')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        session.stream = stream

        const mimeType = pickRecorderType((type) => MediaRecorder.isTypeSupported(type))
        const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: VOICE_BITS_PER_SECOND })
        recorder.ondataavailable = (event) => {
          if (event.data?.size > 0) session.chunks.push(event.data)
        }
        session.recorder = recorder
        // No timeslice: one whole file when it stops, which every player opens
        recorder.start()
        session.startedAt = performance.now()
        startMeter()
        setStatus('recording')
      } catch (err) {
        if (cancelled) return
        session.release()
        setError(errorMessage(err))
        setStatus('error')
      }
    }

    start()

    return () => {
      cancelled = true
      const { recorder } = session
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        try {
          recorder.stop()
        } catch {
          /* Already stopping */
        }
      }
      session.release()
    }
  }, [])

  /** Stops and hands back `{voice: {file, mimeType, duration, waveform}}`, or `{problem}` when there is none. */
  const finish = useCallback(
    () =>
      new Promise((resolve) => {
        const session = sessionRef.current
        const recorder = session?.recorder
        if (!recorder || recorder.state === 'inactive') return resolve({ voice: null, problem: null })

        const duration = (performance.now() - session.startedAt) / 1000

        recorder.onstop = () => {
          session.release()
          setStatus('stopped')

          const mimeType = baseMimeType(recorder.mimeType || session.chunks[0]?.type)
          const blob = new Blob(session.chunks, { type: mimeType })

          if (duration < MIN_VOICE_SECONDS)
            return resolve({ voice: null, problem: 'That recording was too short. Hold on a little longer' })
          if (blob.size === 0 || !VOICE_MIME_TYPES.includes(mimeType)) {
            return resolve({ voice: null, problem: 'This browser could not save the recording' })
          }

          resolve({
            voice: {
              file: new File([blob], voiceFileName(mimeType), { type: mimeType }),
              mimeType,
              duration,
              waveform: buildWaveform(session.samples),
            },
            problem: null,
          })
        }
        recorder.onerror = () => {
          session.release()
          setStatus('stopped')
          resolve({ voice: null, problem: 'The recording was interrupted' })
        }

        try {
          recorder.stop()
        } catch {
          recorder.onerror()
        }
      }),
    []
  )

  return { status, error, elapsed, levels, finish }
}
