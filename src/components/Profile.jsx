'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile' // Path to your new hook
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import { isIPFSHash, resolveIPFSUrl } from '@/lib/storageHelper'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full' }) {
  const router = useRouter()
  
  // Utilize the shared hook here
  const { profile, isLoading } = useProfile(creator)

  const chainInfo = useMemo(() => {
    return networkId ? config.chains.find((c) => c.id === networkId) : null
  }, [networkId])

  const handleNavigation = (e) => {
    e.stopPropagation()
    if (creator) router.push(`/${creator}`)
  }

  if (isLoading || !profile) {
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className="shimmer" style={{ width: 36, height: 36 }} />
        {variant !== 'imageOnly' && (
          <div className="flex flex-column gap-025">
            <div className="shimmer rounded" style={{ width: 80, height: 14 }} />
            {variant === 'full' && <div className="shimmer rounded" style={{ width: 120, height: 10 }} />}
          </div>
        )}
      </div>
    )
  }

  const truncatedAddress = creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : ''
  const finalImageSrc = isIPFSHash(profile.profileImage) ? `${resolveIPFSUrl(profile.profileImage)}` : profile.profileImage

  return (
    <figure
      className={`${styles.profile} flex align-items-center gap-050`}
      onClick={handleNavigation}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleNavigation(e)
      }}
    >
      <div className={styles.imageWrapper}>
        <img alt={profile.name} src={finalImageSrc} width={36} height={36} className="" />
      </div>

      {variant !== 'imageOnly' && (
        <figcaption className="flex flex-column align-items-start justify-content-center gap-025">
          <div className={`${styles.nameRow}`}>
            <b>{profile.name}</b>
            <Image alt="verified" src={blueCheckMarkIcon} width={14} height={14} />
            {chainInfo && <div className={styles.badge} title={chainInfo.name} dangerouslySetInnerHTML={{ __html: chainInfo.icon }} />}
            {variant === 'full' && createdAt && <span className={styles.createdAt}>{toRelativeTime(createdAt)}</span>}
          </div>
          {variant === 'full' && creator && <code className={styles.address}>{truncatedAddress}</code>}
        </figcaption>
      )}
    </figure>
  )
}