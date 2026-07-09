'use client'

import { useConnection } from 'wagmi'
import { ArrowSquareOutIcon, EnvelopeSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import NativePopover from './NativePopover'
import styles from './Share.module.scss'

/**
 * Share Interaction Component
 * @param {Object} props
 * @param {Object} props.item Core content model with network metadata.
 */
export const Share = ({ item }) => {
  const { isConnected } = useConnection()

  const shareUrl = `${location.protocol}//${window.location.host}/networks/${item.network_id}/${item.id}`
  const sharePostTitle = item?.content?.elements?.[0]?.data?.text || item?.content || ''
  const shareHupHandle = 'hupsocial' // <-- Replace with your actual X handle (without the @)
  const shareContent = `${sharePostTitle}\n\n Creator: ${item.wallet_address} \n\n`

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
      onBeforeToggle={(e) => {
        if (e.newState === 'open' && !isConnected) {
          e.preventDefault()
          toast(`Please connect wallet`, `error`)
        }
      }}
      trigger={
        <button data-action="share" aria-label="Share post">
          <UploadSimpleIcon width={17} height={17} />
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.share__menu}>
          <ul className={styles.share__list}>
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
