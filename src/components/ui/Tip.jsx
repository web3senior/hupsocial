'use client'

import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { TipIcon } from '@/components/Icons'

/**
 * Tip Interaction Component
 * No counter yet — tips have no aggregate metric in the API. Structured like the other
 * footer actions so a live counter can be added once the backend exposes one.
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata.
 * @param {Function} props.onTip Opens the tip modal for this post.
 */
export const Tip = ({ post, onTip }) => {
  const isMounted = useClientMounted()
  const { isConnected } = useConnection()

  const handleTip = (e) => {
    e.stopPropagation()

    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }

    onTip?.(post)
  }

  if (!isMounted) return null

  return (
    <button data-action="tip" aria-label="Tip the author" onClick={handleTip}>
      <TipIcon />
    </button>
  )
}

export default Tip
