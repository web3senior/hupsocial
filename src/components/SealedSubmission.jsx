'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { renderMarkdown } from '@/lib/markdown'
import { taskDetailKey } from '@/lib/taskTracking'
import { openRevealedSubmission, openSubmission, unlockTaskIdentity } from '@/lib/taskVault'
import MediaGallery from './Gallery'
import { LockSimpleIcon, LockSimpleOpenIcon } from '@phosphor-icons/react'
import styles from './SealedSubmission.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * A sealed task reply. Anyone reads it once the poster published its key on approval; before
 * that only the poster can open it, with the task key from their Security Vault.
 */
export default function SealedSubmission({ envelope, networkId, parentId, replyId }) {
  const { address } = useConnection()
  const { data } = useSWR(networkId && parentId ? taskDetailKey(networkId, parentId) : null, fetcher)
  const [content, setContent] = useState(null)
  const [failed, setFailed] = useState(false)

  const task = data?.data?.task
  const payout = (data?.data?.payouts ?? []).find((row) => String(row.reply_id) === String(replyId))
  const revealKey = payout?.reveal_key || null
  const isPoster = Boolean(address && task && address.toLowerCase() === String(task.wallet_address).toLowerCase())

  useEffect(() => {
    if (!revealKey || content) return
    let cancelled = false
    openRevealedSubmission(envelope, revealKey)
      .then((opened) => !cancelled && setContent(opened))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [envelope, revealKey, content])

  const openAsPoster = async (event) => {
    event.stopPropagation()
    try {
      const identity = await unlockTaskIdentity('Opening a sealed reply to your task')
      setContent(await openSubmission(envelope, identity.privKeyHex))
    } catch (err) {
      if (err?.code !== 4001) setFailed(true)
    }
  }

  if (content) {
    const text = content?.elements?.find((element) => element?.type === 'text')?.data?.text ?? ''
    const media = content?.elements?.find((element) => element?.type === 'media')?.data?.items ?? []
    return (
      <div className={styles.sealed} onClick={(e) => e.stopPropagation()}>
        <span className={styles.sealed__label}>
          <LockSimpleOpenIcon size={13} /> {revealKey ? 'Published by the poster on approval' : 'Opened with your task key'}
        </span>
        <div className={styles.sealed__text} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        {media.length > 0 && <MediaGallery data={media} />}
      </div>
    )
  }

  return (
    <div className={styles.sealed} onClick={(e) => e.stopPropagation()}>
      <span className={styles.sealed__label}>
        <LockSimpleIcon size={13} />
        {failed ? 'This reply could not be opened.' : payout ? 'Approved and paid, kept private by the poster.' : 'Sealed until the poster approves it.'}
      </span>
      {isPoster && !failed && (
        <button type="button" className={styles.sealed__open} onClick={openAsPoster}>
          Open with your task key
        </button>
      )}
    </div>
  )
}
