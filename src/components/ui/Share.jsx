'use client'

import { useState } from 'react'
import { ArrowSquareOutIcon, EnvelopeSimpleIcon, ImageIcon, LinkSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import CopyPostImageDialog from '@/components/CopyPostImageDialog'
import { SAVED, copyPostImage, hasPostImage, supportsImageClipboard } from '@/lib/postImage'
import NativePopover from './NativePopover'
import Tooltip from './Tooltip'
import styles from './Share.module.scss'

/**
 * Share Interaction Component
 * Defaults to sharing a post (`item`), but any page can share its own subject by passing
 * `url`/`title`/`creator` plus a custom `trigger` — the target menu stays identical.
 * @param {Object} props
 * @param {Object} [props.item] Core content model with network metadata (post sharing).
 * @param {string} [props.url] Absolute URL to share instead of the post permalink.
 * @param {string} [props.title] Share title instead of the post text.
 * @param {string} [props.creator] Creator wallet when there is no `item`.
 * @param {import('react').ReactNode} [props.trigger] Custom popover trigger element.
 * @param {import('react').RefObject<HTMLElement>} [props.captureRef] The post's own element, so
 *   "Copy as image" copies the card on screen rather than its link-preview rendition.
 * @param {string} [props.copyLabel] Label for the copy-link entry.
 * @param {string} [props.copiedToast] Toast shown after a successful copy.
 */
// encodeURIComponent throws URIError on lone UTF-16 surrogates, which real post data can
// contain (e.g. an emoji mangled by storage truncation) — one bad post must not crash the
// route through this component, so share text is always sanitized first.
const sanitizeShareText = (value) => {
  if (typeof value !== 'string') return ''
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

export const Share = ({
  item,
  url,
  title,
  creator,
  trigger,
  captureRef,
  copyLabel = 'Copy post link',
  copiedToast = 'Post link copied',
}) => {
  // The card being copied, held from the click that asked for it: the popover unmounts on close,
  // so the node cannot be read again when the sheet renders.
  const [imageNode, setImageNode] = useState(null)
  const shareUrl = url ?? `${location.protocol}//${window.location.host}/networks/${item.network_id}/${item.id}`
  // Encrypted posts carry an envelope object as content — share the lock placeholder, never
  // the object (or its ciphertext)
  const rawTitle =
    title ?? (item?.content?.encrypted ? '🔒 Encrypted community post' : item?.content?.elements?.[0]?.data?.text ?? '')
  const sharePostTitle = sanitizeShareText(rawTitle)
  const creatorWallet = item?.wallet_address ?? creator
  const shareHupHandle = 'hupsocial' // <-- Replace with your actual X handle (without the @)
  const shareContent = `${sharePostTitle}\n\n${creatorWallet ? ` Creator: ${creatorWallet} \n\n` : ''}`

  const handleCopyLink = async (close) => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast(copiedToast, 'success')
    } catch {
      toast('Failed to copy', 'error')
    }
    close()
  }

  // Where there is a card on screen, the entry opens the sheet: the copy is that card, and the
  // reader sets its theme and colour before taking it. The node is read at click time and held,
  // because the menu closing is what unmounts the popover this handler was called from.
  const handleCopyImage = (close) => {
    const node = captureRef?.current

    if (node) {
      setImageNode(node)
      close()
      return
    }

    // No card to copy — the Shorts player shares a full-screen video. Its picture is the one
    // every link preview already shows, fetched and copied without a sheet to set. The fetch
    // starts inside the click: Safari drops the user activation across an await, and no picture
    // reaches the clipboard after that.
    const handle = toast('Copying the post…', 'loading')
    const copying = copyPostImage(item)
    close()

    const report = (message, type) => {
      if (!handle.update(message, type)) toast(message, type)
    }

    copying
      .then((outcome) => report(outcome === SAVED ? 'Post image downloaded' : 'Post image copied', 'success'))
      .catch((error) => {
        console.warn('Could not copy the post image:', error.message)
        report('Failed to copy the post image', 'error')
      })
  }

  const shareTargets = [
    {
      label: 'Share on 𝕏',
      href: `https://x.com/intent/tweet?text=${encodeURIComponent(shareContent)}&url=${encodeURIComponent(shareUrl)}&via=${shareHupHandle}`,
    },
    {
      label: 'Share on Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      label: 'Share on LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      label: 'Share on Telegram',
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(sharePostTitle)}`,
    },
    {
      label: 'Share on WhatsApp',
      href: `https://wa.me/?text=${encodeURIComponent(`${shareContent}${shareUrl}`)}`,
    },
    {
      label: 'Share on Reddit',
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(sharePostTitle)}`,
    },
    {
      label: 'Send via Email',
      href: `mailto:?subject=${encodeURIComponent(sharePostTitle)}&body=${encodeURIComponent(`${shareContent}${shareUrl}`)}`,
    },
  ]

  return (
    <>
      <NativePopover
        placement="bottom-end"
        type="auto"
        trigger={
          trigger ?? (
            <Tooltip content="Share" placement="bottom" size="compact" hoverOnly>
              <button data-action="share" aria-label="Share post">
                <UploadSimpleIcon width={17} height={17} />
              </button>
            </Tooltip>
          )
        }
      >
        {({ close }) => (
          <div className={styles.share__menu}>
            <ul className={styles.share__list}>
              <li>
                <button type="button" className={styles.share__link} onClick={() => handleCopyLink(close)}>
                  <span>{copyLabel}</span>
                  <LinkSimpleIcon size={16} />
                </button>
              </li>
              {/* Only a post can be copied as a picture; the pages that share a bare URL keep the menu they had */}
              {hasPostImage(item) && (
                <li>
                  <button type="button" className={styles.share__link} onClick={() => handleCopyImage(close)}>
                    <span>{captureRef || supportsImageClipboard() ? 'Copy as image' : 'Download as image'}</span>
                    <ImageIcon size={16} />
                  </button>
                </li>
              )}
              {shareTargets.map((target) => {
                const isExternal = target.href.startsWith('http')

                return (
                  <li key={target.label}>
                    <a
                      className={styles.share__link}
                      href={target.href}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                      onClick={close}
                    >
                      <span>{target.label}</span>
                      {isExternal ? <ArrowSquareOutIcon size={16} /> : <EnvelopeSimpleIcon size={16} />}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </NativePopover>

      {imageNode && <CopyPostImageDialog item={item} node={imageNode} onClose={() => setImageNode(null)} />}
    </>
  )
}

export default Share
