'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { formatVoiceDuration, WAVEFORM_BARS, WAVEFORM_MAX } from '@/lib/voiceMessage'
import styles from './VoiceMessage.module.scss'

// Drawn for a recording that came without a waveform
const FLAT_WAVEFORM = Array.from({ length: WAVEFORM_BARS }, () => WAVEFORM_MAX / 4)
const MIN_BAR_PERCENT = 12
const SEEK_STEP_SECONDS = 5

// One voice message plays at a time: starting another pauses this one
let nowPlaying = null

/**
 * A voice message: play and pause, a waveform that fills as it plays and seeks on click, and the
 * time. Nothing downloads until it is played. `src` may list gateway fallbacks, tried in order.
 * Drawn in the ink of whatever holds it, so it reads on any bubble.
 */
export default function VoiceMessage({ src, duration, waveform, fill = false, className }) {
  const audioRef = useRef(null)
  const frameRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [hasFailed, setHasFailed] = useState(false)
  // Read from the file once it loads, for a recording that came without its length
  const [loadedDuration, setLoadedDuration] = useState(0)

  const sources = (Array.isArray(src) ? src : [src]).filter(Boolean)
  const total = Number.isFinite(duration) && duration > 0 ? duration : loadedDuration
  const bars = waveform?.length ? waveform : FLAT_WAVEFORM
  const progress = total > 0 ? Math.min(1, position / total) : 0
  const isDisabled = hasFailed || sources.length === 0

  // timeupdate fires a few times a second; a frame loop keeps the fill smooth
  useEffect(() => {
    if (!isPlaying) return undefined
    const tick = () => {
      if (audioRef.current) setPosition(audioRef.current.currentTime)
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [isPlaying])

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      audio?.pause()
      if (nowPlaying === audio) nowPlaying = null
    }
  }, [])

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio || isDisabled) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    if (nowPlaying && nowPlaying !== audio) nowPlaying.pause()
    nowPlaying = audio
    try {
      await audio.play()
    } catch (error) {
      // AbortError is a pause that landed before playback began
      if (error?.name !== 'AbortError') setHasFailed(true)
    }
  }

  const seekTo = (seconds) => {
    const audio = audioRef.current
    if (!audio || isDisabled || total <= 0) return
    const next = Math.min(total, Math.max(0, seconds))
    audio.currentTime = next
    setPosition(next)
  }

  const onTrackClick = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) seekTo(((event.clientX - box.left) / box.width) * total)
  }

  const onTrackKeyDown = (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') seekTo(position + SEEK_STEP_SECONDS)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') seekTo(position - SEEK_STEP_SECONDS)
    else if (event.key === 'Home') seekTo(0)
    else if (event.key === 'End') seekTo(total)
    else return
    event.preventDefault()
  }

  const shownTime = isPlaying || position > 0 ? position : total

  return (
    <div className={clsx(styles.voice, fill && styles['voice--fill'], className)}>
      {sources.length > 0 && (
        <audio
          ref={audioRef}
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false)
            setPosition(0)
          }}
          onLoadedMetadata={(event) => {
            // A recorder writes no length into its file, which then reads as Infinity
            if (Number.isFinite(event.currentTarget.duration)) setLoadedDuration(event.currentTarget.duration)
          }}
          onError={() => setHasFailed(true)}
        >
          {/* The browser moves on to the next <source> when one fails to load */}
          {sources.map((source, index) => (
            <source key={source} src={source} onError={index === sources.length - 1 ? () => setHasFailed(true) : undefined} />
          ))}
        </audio>
      )}

      <button
        type="button"
        className={styles.voice__toggle}
        onClick={toggle}
        disabled={isDisabled}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <PauseIcon size={18} weight="fill" aria-hidden /> : <PlayIcon size={18} weight="fill" aria-hidden />}
      </button>

      {hasFailed ? (
        <span className={styles.voice__note}>Voice message unavailable</span>
      ) : (
        <div
          className={styles.voice__track}
          role="slider"
          tabIndex={isDisabled ? -1 : 0}
          aria-label="Position in the voice message"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${formatVoiceDuration(position)} of ${formatVoiceDuration(total)}`}
          aria-disabled={isDisabled || undefined}
          onClick={onTrackClick}
          onKeyDown={onTrackKeyDown}
        >
          {bars.map((level, index) => (
            <span
              key={index}
              className={clsx(styles.voice__bar, (index + 0.5) / bars.length <= progress && styles['voice__bar--played'])}
              style={{ height: `${Math.max(MIN_BAR_PERCENT, level)}%` }}
            />
          ))}
        </div>
      )}

      <span className={styles.voice__time}>{formatVoiceDuration(shownTime)}</span>
    </div>
  )
}
