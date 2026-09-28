'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import {
  BroadcastIcon,
  DownloadSimpleIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  SealCheckIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
  WalletIcon,
} from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { clearChatToken, ensureChatSession } from '@/lib/chatApi'
import { openConnect } from '@/lib/connectDialog'
import { LIVE_MODES, LIVE_TITLE_MAX, cleanLiveTitle, liveDuration, liveIsConfigured, viewersLabel, whipUrl } from '@/lib/live'
import { endLiveStream, fetchLiveStatus, fetchStudio, isLiveUnauthorized, startLiveStream } from '@/lib/liveApi'
import { captureErrorMessage, openLiveSource } from '@/lib/liveCapture'
import { canRecordLive, discardSavedRecording, readSavedRecording, recordingSizeLabel, startLiveRecording } from '@/lib/liveRecorder'
import { publishStream } from '@/lib/whip'
import { useChatToken } from '@/hooks/useChatToken'
import { useClientMounted } from '@/hooks/useClientMount'
import { useProfile } from '@/hooks/useProfile'
import { toast } from '@/components/NextToast'
import { ContentSpinner, Spinner } from '@/components/Loading'
import CopyButton from '@/components/ui/CopyButton'
import EmptyState from '@/components/ui/EmptyState'
import Field from '@/components/ui/Field'
import LiveBadge from '@/components/ui/LiveBadge'
import SegmentedControl from '@/components/ui/SegmentedControl'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import styles from './LiveStudio.module.scss'

const STATUS_REFRESH_MS = 5000
// The worker learns of a new stream on its next sweep, so "offline" means nothing before this
const CUT_OFF_GRACE_MS = 15_000

const MODE_OPTIONS = LIVE_MODES.map((mode) => ({ value: mode.id, label: mode.label }))

export default function LiveStudio() {
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const chainId = useChainId()
  const token = useChatToken(address)
  const { profile } = useProfile(address || null)
  // The wallet and its token are browser state, so the server's render cannot know them
  const mounted = useClientMounted()

  const [mode, setMode] = useState('camera')
  const [source, setSource] = useState(null)
  const [isOpening, setIsOpening] = useState(false)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState('setup')
  const [microphoneOn, setMicrophoneOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [liveSince, setLiveSince] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [keepCopy, setKeepCopy] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [recording, setRecording] = useState(null)

  const previewRef = useRef(null)
  const sourceRef = useRef(null)
  const sessionRef = useRef(null)
  const tokenRef = useRef(token)
  const liveSinceRef = useRef(0)
  const recorderRef = useRef(null)
  const recordingUrlRef = useRef(null)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const isLive = phase === 'live'
  const chain = appChains.find((item) => item.id === chainId)

  const { data: studio, isLoading: isStudioLoading, mutate: mutateStudio } = useSWR(token ? ['live-studio', token] : null, () => fetchStudio(token), {
    revalidateOnFocus: false,
    onError: (error) => {
      if (isLiveUnauthorized(error)) clearChatToken(address)
    },
  })

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setSource(null)
  }, [])

  const showRecording = useCallback((result) => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
    recordingUrlRef.current = result ? URL.createObjectURL(result.blob) : null
    setRecording(result ? { url: recordingUrlRef.current, name: result.name, size: result.size } : null)
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (!recorder) return
    setIsRecording(false)
    const result = await recorder.stop().catch(() => null)
    if (result) showRecording(result)
  }, [showRecording])

  const stopPublishing = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    finishRecording()
    liveSinceRef.current = 0
    setLiveSince(0)
    setPhase('setup')
  }, [finishRecording])

  const endStream = useCallback(
    async (message) => {
      const wasLive = Boolean(sessionRef.current)
      stopPublishing()
      if (message) toast(message, 'error')
      if (!wasLive || !tokenRef.current) return
      await endLiveStream(tokenRef.current).catch(() => {})
      mutateStudio()
    },
    [stopPublishing, mutateStudio],
  )

  const openSource = useCallback(
    async (nextMode) => {
      if (isOpening) return
      setIsOpening(true)
      closeSource()
      try {
        const opened = await openLiveSource(nextMode)
        opened.onEnded(() => {
          closeSource()
          endStream(sessionRef.current ? 'Screen sharing stopped, so the stream ended' : null)
        })
        sourceRef.current = opened
        setMicrophoneOn(true)
        setCameraOn(true)
        setSource(opened)
      } catch (error) {
        toast(captureErrorMessage(error), 'error')
      } finally {
        setIsOpening(false)
      }
    },
    [isOpening, closeSource, endStream],
  )

  useEffect(() => {
    const video = previewRef.current
    if (!video) return
    video.srcObject = source?.stream ?? null
    if (source) video.play().catch(() => {})
  }, [source])

  useEffect(() => {
    if (!isLive) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isLive])

  // A moderator's cut-off reaches the worker first; the peer connection takes far longer to notice
  const { data: status } = useSWR(isLive && address ? ['live-status', address.toLowerCase()] : null, () => fetchLiveStatus(address), {
    refreshInterval: STATUS_REFRESH_MS,
    keepPreviousData: true,
    onSuccess: (latest) => {
      if (latest?.status !== 'offline' || !sessionRef.current) return
      if (Date.now() - liveSinceRef.current < CUT_OFF_GRACE_MS) return
      stopPublishing()
      mutateStudio()
      toast('The stream was ended', 'error')
    },
  })

  useEffect(() => {
    let cancelled = false
    readSavedRecording().then((saved) => {
      if (saved && !cancelled && !recorderRef.current) showRecording(saved)
    })
    return () => {
      cancelled = true
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
      recordingUrlRef.current = null
    }
  }, [showRecording])

  useEffect(() => {
    const leave = () => {
      if (sessionRef.current && tokenRef.current) endLiveStream(tokenRef.current).catch(() => {})
      sessionRef.current?.close()
      sessionRef.current = null
      recorderRef.current?.stop().catch(() => {})
      recorderRef.current = null
    }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [])

  const signIn = async () => {
    if (!address || isSigningIn) return
    setIsSigningIn(true)
    try {
      await ensureChatSession(address, signMessageAsync, chainId)
    } catch (error) {
      if (error?.name !== 'UserRejectedRequestError') toast(error?.message || 'Could not sign in', 'error')
    } finally {
      setIsSigningIn(false)
    }
  }

  const changeMode = (nextMode) => {
    if (isLive || phase === 'starting') return
    setMode(nextMode)
    openSource(nextMode)
  }

  const goLive = async (event) => {
    event.preventDefault()
    const cleanTitle = cleanLiveTitle(title)
    if (!source || !cleanTitle || phase !== 'setup') return

    setPhase('starting')
    try {
      const { id, key } = await startLiveStream(token, { title: cleanTitle, networkId: chainId })
      const session = await publishStream({ url: whipUrl(id), key, stream: source.stream })
      session.pc.addEventListener('connectionstatechange', () => {
        if (session.pc.connectionState === 'failed' && sessionRef.current === session) {
          endStream('The connection to the media server was lost')
        }
      })
      sessionRef.current = session
      if (keepCopy) {
        showRecording(null)
        recorderRef.current = await startLiveRecording({ stream: source.stream, title: cleanTitle }).catch(() => null)
        setIsRecording(Boolean(recorderRef.current))
        if (!recorderRef.current) toast('This browser cannot record, so the stream is live without a copy', 'error')
      }
      liveSinceRef.current = Date.now()
      setLiveSince(liveSinceRef.current)
      setNow(Date.now())
      setPhase('live')
      mutateStudio()
    } catch (error) {
      if (isLiveUnauthorized(error)) clearChatToken(address)
      endLiveStream(token).catch(() => {})
      setPhase('setup')
      toast(error?.message || 'Could not start the stream', 'error')
    }
  }

  const toggleMicrophone = () => {
    source?.setMicrophone(!microphoneOn)
    setMicrophoneOn(!microphoneOn)
  }

  const toggleCamera = () => {
    source?.setCamera(!cameraOn)
    setCameraOn(!cameraOn)
  }

  const deleteRecording = async () => {
    showRecording(null)
    await discardSavedRecording()
  }

  const endOther = async () => {
    await endLiveStream(token).catch(() => {})
    mutateStudio()
  }

  if (!liveIsConfigured) {
    return (
      <EmptyState size="lg" align="center" icon={BroadcastIcon} as="div">
        Live streaming is not set up here yet.
      </EmptyState>
    )
  }

  if (!mounted) return <ContentSpinner />

  if (!isConnected || !address) {
    return (
      <EmptyState
        size="lg"
        align="center"
        icon={WalletIcon}
        as="div"
        action={
          <button type="button" className={styles.studio__button} onClick={() => openConnect() || toast('Please connect wallet', 'error')}>
            Connect wallet
          </button>
        }
      >
        Connect a wallet to go live.
      </EmptyState>
    )
  }

  if (!token) {
    return (
      <EmptyState
        size="lg"
        align="center"
        icon={BroadcastIcon}
        as="div"
        action={
          <button type="button" className={styles.studio__button} onClick={signIn} disabled={isSigningIn}>
            {isSigningIn ? 'Check your wallet…' : 'Sign in'}
          </button>
        }
      >
        Sign one message to prove this wallet is yours. It is the same sign-in the chat uses.
      </EmptyState>
    )
  }

  if (isStudioLoading && !studio) return <ContentSpinner />

  if (studio && !studio.allowed) {
    return (
      <EmptyState
        size="lg"
        align="center"
        icon={SealCheckIcon}
        as="div"
        action={
          <Link href="/premium" className={styles.studio__button}>
            See Premium
          </Link>
        }
      >
        {studio.reason || 'This wallet cannot go live.'}
      </EmptyState>
    )
  }

  const watchPath = `/live/${profile?.username ? `@${profile.username}` : address.toLowerCase()}`
  const openElsewhere = !isLive && phase === 'setup' && studio?.stream

  return (
    <div className={styles.studio}>
      {openElsewhere && (
        <p className={styles.studio__notice}>
          <span>You have a stream open from another tab or device. Going live here ends it.</span>
          <button type="button" className={styles.studio__link} onClick={endOther}>
            End it now
          </button>
        </p>
      )}

      {recording && !isLive && (
        <div className={styles.studio__recording}>
          <p className={styles.studio__recordingText}>
            <strong>Your recording is ready</strong>
            <span>
              {recording.name} · {recordingSizeLabel(recording.size)}
            </span>
            <span>It is kept in this browser only, and going live again with a copy replaces it.</span>
          </p>
          <div className={styles.studio__recordingActions}>
            <a href={recording.url} download={recording.name} className={styles.studio__button}>
              <DownloadSimpleIcon size={16} weight="bold" aria-hidden="true" />
              Download
            </a>
            <button type="button" className={styles.studio__link} onClick={deleteRecording}>
              Delete
            </button>
          </div>
        </div>
      )}

      <div className={styles.studio__stage}>
        <video ref={previewRef} className={clsx(styles.studio__preview, !source && styles['studio__preview--empty'])} muted playsInline autoPlay />

        {!source && (
          <div className={styles.studio__placeholder}>
            {isOpening ? (
              <Spinner size={28} />
            ) : (
              <button type="button" className={styles.studio__button} onClick={() => openSource(mode)}>
                Turn on preview
              </button>
            )}
          </div>
        )}

        {isLive && (
          <p className={styles.studio__overlay}>
            <LiveBadge />
            <span>{liveDuration(liveSince, now)}</span>
            <span>{viewersLabel(status?.viewers)}</span>
          </p>
        )}

        {source && (
          <div className={styles.studio__controls}>
            {source.hasMicrophone && (
              <button
                type="button"
                className={styles.studio__control}
                onClick={toggleMicrophone}
                aria-pressed={!microphoneOn}
                aria-label={microphoneOn ? 'Mute microphone' : 'Unmute microphone'}
              >
                {microphoneOn ? <MicrophoneIcon size={18} /> : <MicrophoneSlashIcon size={18} />}
              </button>
            )}
            {source.hasCamera && (
              <button
                type="button"
                className={styles.studio__control}
                onClick={toggleCamera}
                aria-pressed={!cameraOn}
                aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {cameraOn ? <VideoCameraIcon size={18} /> : <VideoCameraSlashIcon size={18} />}
              </button>
            )}
          </div>
        )}
      </div>

      {isLive ? (
        <div className={styles.studio__live}>
          <h2 className={styles.studio__title}>{cleanLiveTitle(title)}</h2>
          <p className={styles.studio__share}>
            <Link href={watchPath} target="_blank" className={styles.studio__link}>
              {watchPath}
            </Link>
            <CopyButton value={watchPath} title="Copy watch link" variant="chip" label="Copy link" />
          </p>
          {isRecording && <p className={styles.studio__hint}>A copy is being recorded in this browser. You can download it when the stream ends.</p>}
          <button type="button" className={clsx(styles.studio__button, styles['studio__button--danger'])} onClick={() => endStream()}>
            End stream
          </button>
        </div>
      ) : (
        <form className={styles.studio__form} onSubmit={goLive}>
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={changeMode} label="What to share" />

          <Field label="Title" hint={chain ? `Tips from viewers arrive on ${chain.name}, the network your wallet is on.` : undefined}>
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={styles.studio__input}
                type="text"
                value={title}
                maxLength={LIVE_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What is this stream about?"
                autoComplete="off"
                disabled={phase !== 'setup'}
              />
            )}
          </Field>

          {canRecordLive() && (
            <div className={styles.studio__option}>
              <label htmlFor="liveKeepCopy">
                <strong>Keep a copy</strong>
                <span>Recorded in this browser, for you to download when the stream ends.</span>
              </label>
              <ToggleSwitch id="liveKeepCopy" checked={keepCopy} onChange={(event) => setKeepCopy(event.target.checked)} disabled={phase !== 'setup'} />
            </div>
          )}

          <button type="submit" className={styles.studio__button} disabled={!source || !cleanLiveTitle(title) || phase !== 'setup'}>
            {phase === 'starting' ? 'Going live…' : 'Go live'}
          </button>
        </form>
      )}
    </div>
  )
}
