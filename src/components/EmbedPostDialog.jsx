'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import { EMBED_THEMES, buildPostEmbedSnippet, getPostEmbedUrl } from '@/lib/postEmbed'
import styles from './EmbedPostDialog.module.scss'

const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' }

// Long enough to read the confirmation, short enough that the button is ready for a second copy.
const COPIED_RESET_MS = 2000

// Matches the loader's starting height (public/embed.js) so the preview doesn't jump before the
// framed document reports its real size.
const INITIAL_PREVIEW_HEIGHT = 140

/**
 * "Embed" from the post menu: hands over the snippet that renders this post on any page, with a
 * live preview of what the paste produces. Mount = open / unmount = close, matching TipModal.
 * @param {Object} props
 * @param {Object} props.item Post row.
 * @param {() => void} props.onClose Called when the dialog closes, by any route out of it.
 */
export default function EmbedPostDialog({ item, onClose }) {
  const dialogRef = useRef(null)
  const previewRef = useRef(null)
  const [theme, setTheme] = useState('auto')
  const [copied, setCopied] = useState(false)
  const [previewHeight, setPreviewHeight] = useState(INITIAL_PREVIEW_HEIGHT)
  // The dialog only ever mounts from a click, so window is available — read once so the snippet
  // and the preview agree on the origin even if the deployment is reached by several hostnames.
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin))

  const snippet = buildPostEmbedSnippet(item, { origin, theme })
  const previewUrl = getPostEmbedUrl(item, origin, { theme })

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])

  // Same height handshake the loader performs, so the preview is the real thing rather than an
  // approximation of it. The frame is sandboxed without allow-same-origin, so its messages carry
  // an opaque origin — the source check is what identifies them.
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type !== 'hup:embed:size') return
      if (event.source !== previewRef.current?.contentWindow) return

      const height = Math.ceil(Number(event.data.height))
      if (!Number.isFinite(height) || height <= 0) return
      setPreviewHeight(Math.max(height, INITIAL_PREVIEW_HEIGHT))
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      toast('Embed code copied', 'success')
    } catch {
      toast('Failed to copy', 'error')
    }
  }

  const handleThemeChange = (next) => {
    setTheme(next)
    setPreviewHeight(INITIAL_PREVIEW_HEIGHT)
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.embedPost}
      aria-label="Embed this post"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={() => onClose?.()}
    >
      <header className={styles.embedPost__header}>
        <button type="button" className={styles.embedPost__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Embed this post</h3>
      </header>

      <main className={styles.embedPost__body}>
        <div className={styles.embedPost__field}>
          <span className={styles.embedPost__label}>Colour scheme</span>
          <div className={styles.embedPost__themes} role="group" aria-label="Embed colour scheme">
            {EMBED_THEMES.map((option) => (
              <button
                key={option}
                type="button"
                className={clsx(styles.embedPost__theme, option === theme && styles['embedPost__theme--active'])}
                aria-pressed={option === theme}
                onClick={() => handleThemeChange(option)}
              >
                {THEME_LABELS[option]}
              </button>
            ))}
          </div>
          <small className={styles.embedPost__hint}>Auto follows the reader&apos;s own light or dark setting.</small>
        </div>

        <div className={styles.embedPost__field}>
          <span className={styles.embedPost__label}>Preview</span>
          <iframe
            ref={previewRef}
            // Remount on a theme change: the document renders its palette server-side, so the
            // frame has to be refetched rather than restyled.
            key={theme}
            className={styles.embedPost__preview}
            src={previewUrl}
            title="Embedded post preview"
            // Inline, not a height attribute: the global `iframe { height: 100% }` in Global.scss
            // outranks the attribute and collapses the frame to the UA's default 150px
            style={{ height: `${previewHeight}px` }}
            scrolling="no"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          />
        </div>

        <div className={styles.embedPost__field}>
          <span className={styles.embedPost__label}>Embed code</span>
          <pre className={styles.embedPost__code}>
            <code>{snippet}</code>
          </pre>
          <small className={styles.embedPost__hint}>
            Paste it where the post should appear. The script sizes the frame to fit, and the link inside stays readable if it never
            loads.
          </small>
        </div>
      </main>

      <footer className={styles.embedPost__footer}>
        <button type="button" className={styles.embedPost__copy} onClick={handleCopy}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          <span>{copied ? 'Copied' : 'Copy code'}</span>
        </button>
      </footer>
    </NativeDialog>
  )
}
