'use client'

import { useState } from 'react'
import { zeroAddress } from 'viem'
import { useChainId, useConnection, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { ArchiveIcon, ArrowCounterClockwiseIcon, ArrowSquareOutIcon, CopyIcon, DownloadSimpleIcon, EyeIcon, FileIcon, FileTextIcon, HourglassIcon, ImageIcon, LinkIcon, LockOpenIcon, MusicNotesIcon, VideoCameraIcon } from '@phosphor-icons/react'
import { normalizeEnvelope } from '@/lib/gatedContent'
import { fetchIPFS } from '@/lib/ipfsGateways'
import { resolveIdentity, unwrapContentKey, decryptContent } from '@/lib/sellVault'
import { requestVaultUnlock } from '@/lib/vaultUnlockBus'
import sellAbi from '@/abis/HupSell.json'
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

/**
 * Unlocks a gated post entirely in the browser. The server is not in this path at all: the key
 * comes from the HupSell contract (wrapped to this viewer by the seller), the ciphertext comes
 * from IPFS, and both are opened against an identity derived from the viewer's Security Vault.
 * Nothing that could decrypt this ever leaves the tab.
 */
export default function RevealGatedContent({ item, cid }) {
  const { address } = useConnection()
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const { writeContractAsync } = useWriteContract()
  // Reactive, unlike a render-time chain snapshot: read again after switchChainAsync resolves
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  const [isRevealing, setIsRevealing] = useState(false)
  const [isRefunding, setIsRefunding] = useState(false)
  const [revealed, setRevealed] = useState(null)

  const sellAddress = CONTRACTS[`chain${item.network_id}`]?.sell
  const enabled = Boolean(sellAddress && address)

  const { data: purchase } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'getPurchase',
    args: [BigInt(item.id), address ?? zeroAddress],
    chainId,
    query: { enabled },
  })

  const { data: refundable, refetch: refetchRefundable } = useReadContract({
    abi: sellAbi,
    address: sellAddress,
    functionName: 'isRefundable',
    args: [BigInt(item.id), address ?? zeroAddress],
    chainId,
    query: { enabled },
  })

  const hasPurchase = Boolean(purchase && Number(purchase.paidAt) !== 0)
  const isGranted = Boolean(purchase?.granted)
  const isRefunded = Boolean(purchase?.refunded)

  const handleReveal = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }

    setIsRevealing(true)
    try {
      const wrapped = await publicClient.readContract({
        address: sellAddress,
        abi: sellAbi,
        functionName: 'wrappedKeys',
        args: [BigInt(item.id), address],
      })

      if (!wrapped || wrapped === '0x') {
        throw new Error('The seller has not released your key yet')
      }

      // Promptless when the vault is already open this session; otherwise one PIN + one signature
      let identity = await resolveIdentity()
      if (!identity) {
        await requestVaultUnlock({ reason: 'Unlocking this gated post' })
        identity = await resolveIdentity()
      }
      if (!identity) throw new Error('Your Security Vault is locked')

      const contentKey = unwrapContentKey(wrapped, identity.privKeyHex)

      const res = await fetchIPFS(String(cid).replace('ipfs://', ''))
      const envelope = await res.json()

      setRevealed(await decryptContent(contentKey, envelope.iv, envelope.ciphertext))
    } catch (err) {
      // A key that will not open is almost always a vault derived under a different PIN — the
      // recovery is requestRegrant, not a retry, so say so rather than offering the same button.
      const message = /decrypt|authentication|bad mac/i.test(err.message || '')
        ? 'This key was issued to a different vault identity. Ask the seller for a re-grant from your current one.'
        : err.message || 'Failed to reveal content'
      toast(message, 'error')
    } finally {
      setIsRevealing(false)
    }
  }

  const handleRefund = async () => {
    setIsRefunding(true)
    try {
      // The refund is written on the post's chain, never wherever the wallet happens to sit
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      const hash = await writeContractAsync({
        abi: sellAbi,
        address: sellAddress,
        functionName: 'claimRefund',
        args: [BigInt(item.id)],
        chainId,
      })
      toast('Refund sent', 'success')
      await publicClient.waitForTransactionReceipt({ hash })
      refetchRefundable()
    } catch (err) {
      toast(err.shortMessage || err.message || 'Refund failed', 'error')
    } finally {
      setIsRefunding(false)
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

  if (hasPurchase && isRefunded) {
    return <p className={styles.empty}>You were refunded for this purchase.</p>
  }

  // Paid, but the seller has not published the key yet. The refund is the buyer's lever here, so
  // it belongs on this screen rather than buried in a settings page.
  if (hasPurchase && !isGranted) {
    return (
      <div className={styles.pending}>
        <div className={styles.revealHeader}>
          <HourglassIcon size={13} />
          <span>Waiting for the seller to release your key</span>
        </div>
        <p className={styles.empty}>Your payment is held by the contract until then — it is not with the seller.</p>

        {refundable && (
          <button type="button" onClick={handleRefund} disabled={isRefunding} className={styles.revealButton}>
            <ArrowCounterClockwiseIcon size={16} />
            <span>{isRefunding ? 'Refunding...' : 'Claim refund'}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={handleReveal} disabled={isRevealing || !enabled} className={styles.revealButton}>
      <EyeIcon size={16} />
      <span>{isRevealing ? 'Revealing...' : 'Reveal content'}</span>
    </button>
  )
}
