'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DownloadSimpleIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { toast } from '@/components/NextToast'
import { buildPostSheet } from '@/lib/postCaptureSheet'
import { SAVED, copySheetImage, saveSheetImage } from '@/lib/postImage'
import HupMark from './ui/HupMark'
import NativeDialog from './ui/NativeDialog'
import ToggleSwitch from './ui/ToggleSwitch'
import styles from './CopyPostImageDialog.module.scss'

/* Auto leaves the sheet on whatever the reader is using, so a copy made in the dark reads like
   the app they made it from. Terminal is left out on purpose: it is a novelty for the person
   running the app, not a look to hand to someone who has never seen it. */
const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/* The sheet the card sits on. `var(--background)` re-resolves under the sheet's own theme, so
   "Theme" always means the colour the app itself paints behind a post — the other four are
   there for a copy that has to sit on somebody else's page. */
const BACKGROUNDS = [
  { id: 'theme', label: 'Theme colour', value: 'var(--background)' },
  { id: 'paper', label: 'Paper', value: '#ffffff' },
  { id: 'ink', label: 'Ink', value: '#0b0b0c' },
  { id: 'sand', label: 'Sand', value: '#efe7db' },
  { id: 'sky', label: 'Sky', value: '#dce9f5' },
]

/* The card is cloned at whatever width the surface it came from gave it — a post detail page is
   more than twice the feed's — so the sheet settles it between these two. In the feed, which is
   where nearly every copy starts, the card is already inside the range and never reflows. */
const MIN_CARD_PX = 320
const MAX_CARD_PX = 600

/**
 * "Copy as image": the post exactly as it renders, on a sheet the reader can set before copying.
 *
 * The preview is not a picture of the card — it *is* the card, cloned out of the feed and
 * mounted here (lib/postCaptureSheet.js). The copy button rasterizes this same element, so what
 * the dialog shows and what lands on the clipboard cannot disagree.
 *
 * Mount = open / unmount = close, matching TipModal and EmbedPostDialog.
 *
 * @param {Object} props
 * @param {Object} props.item Post row.
 * @param {HTMLElement} props.node The post's own element, the one being copied.
 * @param {() => void} props.onClose Called when the dialog closes, by any route out of it.
 */
export default function CopyPostImageDialog({ item, node, onClose }) {
  const dialogRef = useRef(null)
  const frameRef = useRef(null)
  const sheetRef = useRef(null)
  const cardRef = useRef(null)

  const [theme, setTheme] = useState('auto')
  const [background, setBackground] = useState(BACKGROUNDS[0].id)
  const [showMetrics, setShowMetrics] = useState(true)
  const [busy, setBusy] = useState(null)

  const sheetBackground = useMemo(() => BACKGROUNDS.find((option) => option.id === background) ?? BACKGROUNDS[0], [background])

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  /* The clone is built once. Everything the controls change — theme, sheet colour, whether the
     counters show — is a property of the sheet around it, so none of them rebuild the card. */
  useEffect(() => {
    const host = cardRef.current
    if (!host || !node) return

    host.style.width = `${Math.min(Math.max(node.offsetWidth, MIN_CARD_PX), MAX_CARD_PX)}px`
    host.replaceChildren(buildPostSheet(node))
  }, [node])

  /* A card is wider than this dialog, so the preview is scaled to fit. The picture is not:
     captureElement states the layout size outright, which is what keeps the copy full size. */
  useLayoutEffect(() => {
    const frame = frameRef.current
    const sheet = sheetRef.current
    if (!frame || !sheet) return

    const fit = () => {
      const available = frame.clientWidth
      const natural = sheet.offsetWidth
      if (!available || !natural) return

      const scale = Math.min(1, available / natural)
      frame.style.setProperty('--sheet-scale', scale)
      frame.style.setProperty('--sheet-width', `${natural}px`)
      // A transform does not shrink the box it paints in, so the frame is told what the scaled
      // sheet actually occupies — otherwise the dialog scrolls past a screenful of nothing.
      frame.style.height = `${sheet.offsetHeight * scale}px`
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [])

  /**
   * Both buttons draw the same sheet; only the destination differs. Started straight out of the
   * click — Safari drops the user activation across an await, and a picture that misses that
   * window never reaches the clipboard.
   */
  const run = (action, task, message) => {
    const sheet = sheetRef.current
    if (!sheet || busy) return

    setBusy(action)
    task(sheet, item)
      .then((outcome) => {
        toast(outcome === SAVED ? 'Post image downloaded' : message, 'success')
        dialogRef.current?.close()
      })
      .catch((error) => {
        console.warn('Could not copy the post image:', error.message)
        toast('Failed to copy the post image', 'error')
        setBusy(null)
      })
  }

  // Portalled to <body>, and not for stacking — the top layer already handles that. The share
  // menu that opens this sits in the post's own action row, so a dialog rendered in place is a
  // DOM descendant of `.post__actions`, and every descendant rule scoped to it lands on the
  // cloned card inside. Mounted on <body>, the sheet inherits what a card inherits.
  return createPortal(
    <NativeDialog
      ref={dialogRef}
      className={styles.copyImage}
      aria-label="Copy this post as an image"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      // A post can itself be inside a dialog (a comment thread, a quote) and React's synthetic
      // close event propagates up the tree — without this, closing the sheet closes that too.
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.copyImage__header}>
        <button type="button" className={styles.copyImage__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Copy as image</h3>
      </header>

      <main className={styles.copyImage__body}>
        {/* The stage is the dialog's own chrome, never part of the picture — it is what makes a
            white sheet on a white dialog read as a sheet rather than as nothing */}
        <div className={styles.copyImage__stage}>
          <div className={styles.copyImage__frame} ref={frameRef}>
            {/* The shrink-to-fit lives on this wrapper, never on the sheet: the rasterizer copies
                the sheet's own computed style, and a transform there would be baked into the
                picture — the card drawn at preview size inside a full-size canvas. */}
            <div className={styles.copyImage__scaler}>
              <div
                ref={sheetRef}
                className={styles.copyImage__sheet}
                // Bare `[data-theme='dark']` selectors declare the palette in Globals.scss, so
                // the sheet re-declares it for the cloned card without touching the page around it.
                data-theme={theme === 'auto' ? undefined : theme}
                data-metrics={showMetrics ? 'true' : 'false'}
                style={{ background: sheetBackground.value }}
              >
                <div className={styles.copyImage__card} ref={cardRef} />
                <div className={styles.copyImage__brand}>
                  <HupMark size={16} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.copyImage__controls}>
          <div className={styles.copyImage__row}>
            <label className={styles.copyImage__label} htmlFor="copy-image-metrics">
              Show metrics
            </label>
            <ToggleSwitch
              id="copy-image-metrics"
              checked={showMetrics}
              onChange={(event) => setShowMetrics(event.target.checked)}
              aria-label="Show likes, comments and reposts on the image"
            />
          </div>

          <div className={styles.copyImage__row}>
            <span className={styles.copyImage__label}>Colour scheme</span>
            <div className={styles.copyImage__themes} role="group" aria-label="Image colour scheme">
              {THEMES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={clsx(styles.copyImage__theme, option.id === theme && styles['copyImage__theme--active'])}
                  aria-pressed={option.id === theme}
                  onClick={() => setTheme(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.copyImage__row}>
            <span className={styles.copyImage__label}>Background</span>
            <div className={styles.copyImage__swatches} role="group" aria-label="Image background">
              {BACKGROUNDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={clsx(styles.copyImage__swatch, option.id === background && styles['copyImage__swatch--active'])}
                  style={{ background: option.value }}
                  aria-pressed={option.id === background}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setBackground(option.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className={styles.copyImage__footer}>
        <button
          type="button"
          className={styles.copyImage__save}
          disabled={busy !== null}
          aria-label="Download the image"
          onClick={() => run('save', saveSheetImage, 'Post image downloaded')}
        >
          <DownloadSimpleIcon size={18} />
        </button>
        <button
          type="button"
          className={styles.copyImage__copy}
          disabled={busy !== null}
          onClick={() => run('copy', copySheetImage, 'Post image copied')}
        >
          {busy === 'copy' ? 'Copying…' : 'Copy'}
        </button>
      </footer>
    </NativeDialog>,
    document.body
  )
}
