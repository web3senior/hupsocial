'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { ArrowsInIcon, ArrowsOutIcon, XIcon } from '@phosphor-icons/react'
import { config } from '@/config/wagmi'
import { displayTokenId } from '@/lib/walletNfts'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './NftFrameDialog.module.scss'

/**
 * NftFrameDialog — frame mode.
 * The artwork hung in a picture frame on a lit gallery wall, the way a print hangs on a real one:
 * moulding, a mat, a placard underneath naming the piece. The whole viewport is the wall, and a
 * fullscreen switch hands it to a second screen or a TV, where the chrome fades out after a few
 * idle seconds and only the wall is left.
 *
 * The frame hugs the image at its own aspect ratio rather than filling a fixed box — a frame
 * that is wider than its picture is a frame with nothing in it. The image itself is the 2048 rung
 * of the same metadata row the page already holds (same SWR key, no second fetch); the page's
 * 1024 copy is the poster until the sharper one has landed, so the frame is never empty.
 *
 * Finish, wall and mat are the viewer's own choices, kept in localStorage — someone who hangs
 * every NFT in walnut on a charcoal wall should not have to say so each time.
 *
 * Mount = open / unmount = close, matching the other dialogs.
 *
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.tokenId Token id in its raw form — bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} [props.isLsp8]
 * @param {string|null} [props.collectionName] Names the token while its own metadata resolves.
 * @param {string|null} [props.poster] The image the opening surface already shows, painted first.
 * @param {Function} props.onClose
 */

export const FRAME_FINISHES = [
  { id: 'black', label: 'Black' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'oak', label: 'Oak' },
  { id: 'gold', label: 'Gold' },
  { id: 'white', label: 'White' },
]

export const WALL_TONES = [
  { id: 'white', label: 'Gallery white' },
  { id: 'greige', label: 'Warm grey' },
  { id: 'charcoal', label: 'Charcoal' },
]

const STORAGE_KEY = 'hup:nftFrame'
const DEFAULTS = { frame: 'walnut', wall: 'white', mat: true }

// How long the pointer has to rest before the chrome leaves the wall
const IDLE_MS = 2800

// Storage can be absent, full, or hold a value from an older shape — every read falls back to
// the defaults field by field, so a bad row can never leave the wall unstyled
const readPreferences = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return DEFAULTS
    return {
      frame: FRAME_FINISHES.some((finish) => finish.id === parsed.frame) ? parsed.frame : DEFAULTS.frame,
      wall: WALL_TONES.some((tone) => tone.id === parsed.wall) ? parsed.wall : DEFAULTS.wall,
      mat: typeof parsed.mat === 'boolean' ? parsed.mat : DEFAULTS.mat,
    }
  } catch {
    return DEFAULTS
  }
}

const writePreferences = (preferences) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    /* private mode or quota — the choice still holds for this open */
  }
}

const noSubscribe = () => () => {}
const subscribeFullscreen = (callback) => {
  document.addEventListener('fullscreenchange', callback)
  return () => document.removeEventListener('fullscreenchange', callback)
}

export default function NftFrameDialog({ chainId, collection, tokenId, isLsp8, collectionName, poster = null, onClose }) {
  const dialogRef = useRef(null)
  const wallRef = useRef(null)

  // Client-only by construction — this mounts on a click, never on the server — so storage can
  // seed the first render directly and the wall paints in the viewer's finish from frame one
  const [preferences, setPreferences] = useState(readPreferences)
  const update = (patch) =>
    setPreferences((current) => {
      const next = { ...current, ...patch }
      writePreferences(next)
      return next
    })

  const metadata = useNftMetadata({ chainId, collection, tokenId, isLsp8, imageWidth: 2048 })

  // The 2048 rung is the proxy's own encode on first sight, which can take a moment. The poster
  // is already in the browser's cache from the page underneath, so it hangs at once and the
  // sharper copy swaps in behind it once a probe has it loaded.
  const hiImage = metadata.image || null
  const [readySrc, setReadySrc] = useState(null)
  useEffect(() => {
    if (!hiImage || hiImage === poster) return undefined
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setReadySrc(hiImage)
    }
    probe.src = hiImage
    return () => {
      cancelled = true
    }
  }, [hiImage, poster])
  const src = readySrc === hiImage ? hiImage : poster || hiImage

  const label = displayTokenId(tokenId)
  const collectionLabel = metadata.collectionName || collectionName || null
  const name = metadata.name || (collectionLabel ? `${collectionLabel} #${label}` : `#${label}`)
  const chainName = config.chains.find((chain) => chain.id === Number(chainId))?.name ?? null
  // A named piece gets its id on the second line; an unnamed one already carries it in the title
  const idTag = `#${label}`
  const placardMeta = [collectionLabel, name.includes(idTag) ? null : idTag, chainName].filter(Boolean).join(' · ')

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  // iPhone Safari implements the Fullscreen API for <video> only, so the switch would render
  // and silently do nothing there — hidden instead. Read as external state rather than set in
  // an effect: the server pass has no document, the client pass answers directly.
  const canFullscreen = useSyncExternalStore(noSubscribe, () => document.fullscreenEnabled === true, () => false)
  const isFullscreen = useSyncExternalStore(subscribeFullscreen, () => Boolean(document.fullscreenElement), () => false)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
      return
    }
    // The wall, not the dialog: NativeDialog keeps the element to itself, and a descendant of a
    // modal dialog is allowed into fullscreen on top of it
    wallRef.current?.requestFullscreen?.().catch(() => {
      /* denied or unsupported — the framed view stays in the dialog */
    })
  }

  // Chrome leaves the wall after a pause and comes back on any pointer or key activity, so a
  // TV shows only the piece and a viewer who reaches for the mouse gets the controls back
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef(null)
  const armIdle = useCallback(() => {
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  const wake = useCallback(() => {
    setIdle(false)
    armIdle()
  }, [armIdle])
  useEffect(() => {
    armIdle()
    return () => clearTimeout(idleTimer.current)
  }, [armIdle])

  const handleKeyDown = (event) => {
    wake()
    if (!canFullscreen || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault()
      toggleFullscreen()
    }
  }

  const handleClose = (event) => {
    event.stopPropagation()
    // Unmounting the fullscreen element exits fullscreen anyway, but the explicit exit skips
    // the frame of black some browsers paint in between
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    onClose?.()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.frameMode}
      aria-label={`${name}, framed`}
      onClick={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
      onClose={handleClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={wallRef}
        className={styles.frameMode__wall}
        data-frame={preferences.frame}
        data-wall={preferences.wall}
        data-mat={preferences.mat ? '' : undefined}
        data-idle={idle ? '' : undefined}
        onPointerMove={wake}
        onPointerDown={wake}
      >
        <figure className={styles.frameMode__piece}>
          <div className={styles.frameMode__moulding}>
            <div className={styles.frameMode__mat}>
              <div className={styles.frameMode__glass}>
                {src ? (
                  <img src={src} alt={name} decoding="async" draggable={false} onError={handleBrokenImage} />
                ) : (
                  <span className={styles.frameMode__blank} aria-hidden="true" />
                )}
              </div>
            </div>
          </div>

          <figcaption className={styles.frameMode__placard}>
            <strong className={styles.frameMode__placardTitle}>{name}</strong>
            {placardMeta && <span className={styles.frameMode__placardMeta}>{placardMeta}</span>}
          </figcaption>
        </figure>

        <button type="button" className={styles.frameMode__close} onClick={() => dialogRef.current?.close()} aria-label="Leave frame mode">
          <XIcon size={18} />
        </button>

        <div className={styles.frameMode__controls} role="toolbar" aria-label="Frame options">
          <div className={styles.frameMode__group} role="radiogroup" aria-label="Frame finish">
            <span className={styles.frameMode__groupLabel}>Frame</span>
            {FRAME_FINISHES.map((finish) => (
              <button
                key={finish.id}
                type="button"
                role="radio"
                aria-checked={preferences.frame === finish.id}
                aria-label={finish.label}
                title={finish.label}
                data-frame={finish.id}
                className={clsx(styles.frameMode__swatch, preferences.frame === finish.id && styles['frameMode__swatch--active'])}
                onClick={() => update({ frame: finish.id })}
              />
            ))}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={preferences.mat}
            className={clsx(styles.frameMode__toggle, preferences.mat && styles['frameMode__toggle--on'])}
            onClick={() => update({ mat: !preferences.mat })}
          >
            Mat
          </button>

          <div className={styles.frameMode__group} role="radiogroup" aria-label="Wall">
            <span className={styles.frameMode__groupLabel}>Wall</span>
            {WALL_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                role="radio"
                aria-checked={preferences.wall === tone.id}
                aria-label={tone.label}
                title={tone.label}
                data-wall={tone.id}
                className={clsx(styles.frameMode__swatch, preferences.wall === tone.id && styles['frameMode__swatch--active'])}
                onClick={() => update({ wall: tone.id })}
              />
            ))}
          </div>

          {canFullscreen && (
            <>
              <span className={styles.frameMode__divider} aria-hidden="true" />
              <button
                type="button"
                className={styles.frameMode__toggle}
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen ? <ArrowsInIcon size={16} weight="bold" /> : <ArrowsOutIcon size={16} weight="bold" />}
              </button>
            </>
          )}
        </div>
      </div>
    </NativeDialog>
  )
}
