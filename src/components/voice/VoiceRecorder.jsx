'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowUpIcon, StopIcon, TrashIcon } from '@phosphor-icons/react'
import { LIVE_BARS, useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { formatVoiceDuration, MAX_VOICE_SECONDS } from '@/lib/voiceMessage'
import VoiceMessage from './VoiceMessage'
import styles from './VoiceRecorder.module.scss'

// The shortest bar, so a pause in speech still shows the recording is running
const MIN_LEVEL_PERCENT = 8

/**
 * Records a voice message in the message box's place: recording starts on mount and the microphone
 * is released on unmount. Send stops and sends at once; stop keeps it to listen to first. Nothing is
 * uploaded here: the recording goes to `onSend`. `onClose` runs however it ends.
 */
export default function VoiceRecorder({ onSend, onClose, onError, className }) {
  const { status, error, elapsed, levels, finish } = useVoiceRecorder()
  // The stopped recording, waiting to be sent or discarded, with a URL to play it from
  const [review, setReview] = useState(null)
  const isFinishingRef = useRef(false)

  // Read by the effects below, which must not re-run when a parent re-renders
  const handlersRef = useRef({ onClose, onError })
  useEffect(() => {
    handlersRef.current = { onClose, onError }
  })

  useEffect(() => {
    if (status !== 'error') return
    handlersRef.current.onError(error)
    handlersRef.current.onClose()
  }, [status, error])

  useEffect(() => {
    if (!review) return undefined
    return () => URL.revokeObjectURL(review.url)
  }, [review])

  const stop = async () => {
    if (isFinishingRef.current) return null
    isFinishingRef.current = true
    const { voice, problem } = await finish()
    if (voice) return voice
    if (problem) onError(problem)
    onClose()
    return null
  }

  const stopToReview = async () => {
    const voice = await stop()
    if (voice) setReview({ voice, url: URL.createObjectURL(voice.file) })
  }

  const send = async () => {
    const voice = review?.voice ?? (await stop())
    if (!voice) return
    onSend(voice)
    onClose()
  }

  // At the limit the recording stops by itself and waits to be sent
  const hasReachedLimit = status === 'recording' && elapsed >= MAX_VOICE_SECONDS
  const stopToReviewRef = useRef(stopToReview)
  useEffect(() => {
    stopToReviewRef.current = stopToReview
  })
  useEffect(() => {
    if (hasReachedLimit) stopToReviewRef.current()
  }, [hasReachedLimit])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) handlersRef.current.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const isRecording = status === 'recording'
  // Filled from the right, so new sound enters where the recording is heading
  const bars = [...Array.from({ length: Math.max(0, LIVE_BARS - levels.length) }, () => 0), ...levels]

  return (
    <div className={clsx(styles.recorder, className)} role="group" aria-label="Voice message">
      <button
        type="button"
        className={clsx(styles.recorder__button, styles['recorder__button--discard'])}
        onClick={onClose}
        aria-label="Discard the recording"
        title="Discard"
      >
        <TrashIcon size={20} aria-hidden />
      </button>

      {review ? (
        <VoiceMessage src={review.url} duration={review.voice.duration} waveform={review.voice.waveform} fill />
      ) : (
        <>
          <span className={styles.recorder__time} role="timer" aria-label="Recording time">
            <span className={clsx(styles.recorder__dot, isRecording && styles['recorder__dot--live'])} aria-hidden />
            {formatVoiceDuration(elapsed)}
          </span>

          <span className={styles.recorder__levels} aria-hidden>
            {bars.map((level, index) => (
              <span key={index} className={styles.recorder__level} style={{ height: `${Math.max(MIN_LEVEL_PERCENT, level * 100)}%` }} />
            ))}
          </span>

          <button
            type="button"
            className={styles.recorder__button}
            onClick={stopToReview}
            disabled={!isRecording}
            aria-label="Stop and listen before sending"
            title="Stop and listen"
          >
            <StopIcon size={18} weight="fill" aria-hidden />
          </button>
        </>
      )}

      <button
        type="button"
        className={styles.recorder__send}
        onClick={send}
        disabled={!review && !isRecording}
        aria-label="Send voice message"
        title="Send"
      >
        <ArrowUpIcon size={18} weight="bold" aria-hidden />
      </button>

      <span className={styles.recorder__status} role="status">
        {review ? 'Recording stopped' : isRecording ? 'Recording' : 'Starting the microphone'}
      </span>
    </div>
  )
}
