'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CornersOutIcon, PlayIcon, SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react'
import { whepUrl } from '@/lib/live'
import { playStream } from '@/lib/whip'
import { useAutoplayPreference } from '@/hooks/useAutoplayPreference'
import { Spinner } from '@/components/Loading'
import styles from './LivePlayer.module.scss'

const MAX_RETRIES = 5
const RETRY_STEP_MS = 1500

/**
 * Plays one live stream over WHEP. Rests behind a play button unless the reader turned autoplay
 * on in Settings, in which case it starts muted, the only way a browser lets video start alone.
 */
export default function LivePlayer({ streamId, title }) {
  const autoplay = useAutoplayPreference()
  const [phase, setPhase] = useState('idle')
  const [muted, setMuted] = useState(false)

  const stageRef = useRef(null)
  const videoRef = useRef(null)
  const sessionRef = useRef(null)
  const abortRef = useRef(null)
  const retryRef = useRef({ timer: null, attempts: 0 })
  const connectRef = useRef(null)

  const release = useCallback(() => {
    clearTimeout(retryRef.current.timer)
    abortRef.current?.abort()
    abortRef.current = null
    sessionRef.current?.close()
    sessionRef.current = null
  }, [])

  const retry = useCallback(() => {
    const state = retryRef.current
    if (state.attempts >= MAX_RETRIES) {
      release()
      setPhase('failed')
      return
    }
    state.attempts += 1
    setPhase('connecting')
    clearTimeout(state.timer)
    state.timer = setTimeout(() => connectRef.current?.(), RETRY_STEP_MS * state.attempts)
  }, [release])

  const connect = useCallback(async ({ startMuted = false } = {}) => {
    release()
    setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const session = await playStream({ url: whepUrl(streamId), signal: controller.signal })
      if (controller.signal.aborted) return session.close()

      sessionRef.current = session
      session.pc.addEventListener('connectionstatechange', () => {
        if (sessionRef.current !== session) return
        if (session.pc.connectionState === 'failed' || session.pc.connectionState === 'closed') retry()
      })

      const video = videoRef.current
      if (!video) return
      video.srcObject = session.stream
      if (startMuted) {
        video.muted = true
        setMuted(true)
      }
      try {
        await video.play()
      } catch (error) {
        if (error?.name !== 'NotAllowedError') throw error
        video.muted = true
        setMuted(true)
        await video.play()
      }

      retryRef.current.attempts = 0
      setPhase('playing')
    } catch {
      if (!controller.signal.aborted) retry()
    }
  }, [streamId, release, retry])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(
    () => () => {
      release()
      setPhase('idle')
    },
    [release],
  )

  useEffect(() => {
    if (!autoplay || phase !== 'idle') return
    const timer = setTimeout(() => connect({ startMuted: true }), 0)
    return () => clearTimeout(timer)
  }, [autoplay, phase, connect])

  const play = () => {
    retryRef.current.attempts = 0
    connect()
  }

  const toggleMuted = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !muted
    setMuted(!muted)
  }

  const goFullscreen = () => {
    const stage = stageRef.current
    if (document.fullscreenElement) return document.exitFullscreen()
    if (stage?.requestFullscreen) return stage.requestFullscreen().catch(() => {})
    // iPhone Safari only takes the video element itself fullscreen
    videoRef.current?.webkitEnterFullscreen?.()
  }

  return (
    <div ref={stageRef} className={styles.player}>
      <video ref={videoRef} className={styles.player__video} playsInline aria-label={title} />

      {phase === 'idle' && (
        <button type="button" className={styles.player__cover} onClick={play} aria-label="Play live stream">
          <span className={styles.player__play}>
            <PlayIcon size={28} weight="fill" aria-hidden="true" />
          </span>
        </button>
      )}

      {phase === 'connecting' && (
        <div className={styles.player__cover}>
          <Spinner size={32} color="#fff" label="Connecting to the stream" />
        </div>
      )}

      {phase === 'failed' && (
        <div className={styles.player__cover}>
          <p className={styles.player__message}>The stream could not be reached.</p>
          <button type="button" className={styles.player__retry} onClick={play}>
            Try again
          </button>
        </div>
      )}

      {phase === 'playing' && (
        <div className={styles.player__controls}>
          <button type="button" className={styles.player__control} onClick={toggleMuted} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <SpeakerSlashIcon size={18} /> : <SpeakerHighIcon size={18} />}
          </button>
          <button type="button" className={styles.player__control} onClick={goFullscreen} aria-label="Full screen">
            <CornersOutIcon size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
