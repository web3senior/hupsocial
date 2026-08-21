'use client'

import { ArrowSquareOutIcon, EnvelopeSimpleIcon, LinkSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
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

export const Share = ({ item, url, title, creator, trigger, copyLabel = 'Copy post link', copiedToast = 'Post link copied' }) => {
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
  )
}

export default Share
