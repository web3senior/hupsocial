'use client'

import { useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { ArchiveIcon, ArrowSquareOutIcon, CopyIcon, DownloadSimpleIcon, EyeIcon, FileIcon, FileTextIcon, ImageIcon, LinkIcon, LockOpenIcon, MusicNotesIcon, VideoCameraIcon } from '@phosphor-icons/react'
import { normalizeEnvelope } from '@/lib/gatedContent'
import styles from './RevealGatedContent.module.scss'

function base64ByteSize(base64) {
  const padding = (base64.match(/=+$/) || [''])[0].length
  return Math.floor((base64.length * 3) / 4) - padding
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`
}

function fileIconFor(mimeType = '') {
  if (mimeType.startsWith('image/')) return ImageIcon
  if (mimeType.startsWith('video/')) return VideoCameraIcon
  if (mimeType.startsWith('audio/')) return MusicNotesIcon
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return FileTextIcon
  if (/zip|rar|7z|tar|gz|compressed|archive/.test(mimeType)) return ArchiveIcon
  return FileIcon
}

export default function RevealGatedContent({ item, cid }) {
  const { address } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [isRevealing, setIsRevealing] = useState(false)
  const [revealed, setRevealed] = useState(null)

  const targetChain = CONTRACTS[`chain${item.network_id}`]

  const handleReveal = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!targetChain?.store) {
      toast("The store contract isn't available on this network yet", 'error')
      return
    }

    setIsRevealing(true)
    try {
      const timestamp = Date.now()
      const message = `Reveal gated content for post ${item.id}\nTimestamp: ${timestamp}`
      const signature = await signMessageAsync({ message })

      const isLukso = Number(item.network_id) === 42

      const res = await fetch('/api/store/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: item.id,
          chainId: item.network_id,
          cid,
          message,
          signature,
          ...(isLukso && { up_address: address }),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to reveal content')
      }

      setRevealed(await res.json())
    } catch (err) {
      toast(err.message || 'Failed to reveal content', 'error')
    } finally {
      setIsRevealing(false)
    }
  }

  const handleCopy = async (value) => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Failed to copy', 'error')
    }
  }

  if (revealed) {
    const { name, description, links, files } = normalizeEnvelope(revealed)

    return (
      <div className={styles.reveal}>
        <div className={styles.revealHeader}>
          <LockOpenIcon size={13} />
          <span>Unlocked</span>
        </div>

        {name && <h4 className={styles.contentName}>{name}</h4>}

        {description && (
          <div className={styles.textBlock}>
            <textarea readOnly value={description} rows={3} onClick={(e) => e.target.select()} />
            <button type="button" onClick={() => handleCopy(description)} className={styles.copyButton}>
              <CopyIcon size={12} />
              <span>Copy</span>
            </button>
          </div>
        )}

        {links.length > 0 && (
          <ul className={styles.linkList}>
            {links.map((link, i) => (
              <li key={`${link.url}-${i}`}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.linkItem}>
                  <LinkIcon size={15} />
                  <span>{link.name}</span>
                  <ArrowSquareOutIcon size={13} className={styles.externalIcon} />
                </a>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <ul className={styles.fileList}>
            {files.map((file, i) => {
              const isImage = file.mimeType?.startsWith('image/')
              const href = `data:${file.mimeType};base64,${file.dataBase64}`
              const size = formatFileSize(base64ByteSize(file.dataBase64))
              const FileIcon = fileIconFor(file.mimeType)

              return (
                <li key={`${file.filename}-${i}`} className={styles.fileItem}>
                  {isImage ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className={styles.thumb}>
                      <img src={href} alt={file.filename} />
                    </a>
                  ) : (
                    <div className={styles.fileIcon}>
                      <FileIcon size={18} />
                    </div>
                  )}

                  <div className={styles.fileMeta}>
                    <span className={styles.fileName}>{file.filename}</span>
                    <span className={styles.fileSize}>{size}</span>
                  </div>

                  <a href={href} download={file.filename} className={styles.downloadButton} aria-label={`Download ${file.filename}`}>
                    <DownloadSimpleIcon size={15} />
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        {!name && !description && links.length === 0 && files.length === 0 && (
          <p className={styles.empty}>The seller hasn&apos;t attached any content to this listing yet.</p>
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={handleReveal} disabled={isRevealing} className={styles.revealButton}>
      <EyeIcon size={16} />
      <span>{isRevealing ? 'Revealing...' : 'Reveal content'}</span>
    </button>
  )
}
