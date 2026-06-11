'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import { isIPFSHash, resolveIPFSUrl } from '@/lib/storageHelper'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { Identicon } from './ui/UniversalIdentity/Identicon'
import clsx from 'clsx'
import UPlogo from '@/../public/up.png'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full' }) {
  const router = useRouter()
  const { profile, isLoading } = useProfile(creator)

  // Extract network configuration based on current chain identifier
  const chainInfo = useMemo(() => {
    return networkId ? config.chains.find((c) => c.id === networkId) : null
  }, [networkId])

  // Truncate public wallet keys into compact readable hashes
  const truncatedAddress = useMemo(() => {
    return creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : ''
  }, [creator])

  // Redirect client viewport directly to selected destination route
  const handleNavigation = (e) => {
    e.stopPropagation()
    if (creator) router.push(`/${creator}`)
  }

  const handleUniversalProfile = (e) => {
    e.stopPropagation()

    const url = `https://universaleverything.io/${creator}`

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Render placeholder skeletal visual states during active metadata fetches
  if (isLoading || !profile) {
    return (
      <div className={clsx(styles.profileShimmer, 'flex align-items-center gap-050')}>
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

  return (
    <div
      className={clsx(styles.profile, 'flex align-items-center')}
      onClick={handleNavigation}
      role="button"
      tabIndex={0}
      aria-label={`View profile for ${profile.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleNavigation(e)
      }}
    >
      <div className={styles.imageWrapper}>
        <img alt={profile.name} src={profile.profileImage} width={36} height={36} className="rounded-full" />
        <Identicon
          name={profile.name}
          profileImage={profile.profileImage}
          address={creator}
          size={20}
          className={clsx(styles.imageWrapper__fingerprint, 'rounded-full')}
        />
      </div>

      {variant !== 'imageOnly' && (
        <div className="flex flex-column align-items-start justify-content-center gap-025">
          <div className={styles.nameRow}>
            <b className={styles.name}>{profile.name}</b>
            <Image alt="verified" src={blueCheckMarkIcon} width={14} height={14} />
            {chainInfo && <div className={styles.badge} title={chainInfo.name} dangerouslySetInnerHTML={{ __html: chainInfo.icon }} />}
            {profile.source === `universal_profile` && (
              <div className={styles.universalProfile} onClick={handleUniversalProfile}>
                <img alt={`Universal Profile`} src={UPlogo.src} width={12} height={12} />
              </div>
            )}
            {variant === 'full' && createdAt && <small className={styles.createdAt}>{toRelativeTime(createdAt)}</small>}
          </div>

          {variant === 'full' && creator && <code className={styles.address}>{truncatedAddress}</code>}
        </div>
      )}
    </div>
  )
}
