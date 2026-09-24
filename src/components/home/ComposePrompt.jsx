'use client'

import { useActiveWallet } from '@/hooks/useActiveWallet'
import { useProfile } from '@/hooks/useProfile'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { openConnect } from '@/lib/connectDialog'
import { toast } from '@/components/NextToast'
import Avatar from '@/components/ui/Avatar'
import styles from './ComposePrompt.module.scss'

// Threads-style prompt at the top of the feed card. A tap opens the real composer, which
// Aside renders off the same store flag as the sidebar's Post button.
export default function ComposePrompt() {
  const { address, isConnected } = useActiveWallet()
  const { profile } = useProfile(isConnected && address ? address : null)
  const openComponent = useSidebarStore((state) => state.openComponent)

  const handleCompose = () => {
    // Same gate as the sidebar: no wallet, no composer
    if (!isConnected) {
      if (!openConnect()) toast('Please connect wallet', 'error')
      return
    }
    openComponent()
  }

  return (
    <div className={styles.prompt}>
      <Avatar className={styles.prompt__avatar} src={isConnected ? profile?.profileImage : null} size={36} />
      <button type="button" className={styles.prompt__field} onClick={handleCompose}>
        What&apos;s new?
      </button>
      <button type="button" className={styles.prompt__post} onClick={handleCompose}>
        Post
      </button>
    </div>
  )
}
