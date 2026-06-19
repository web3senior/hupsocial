'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { Identicon } from './ui/UniversalIdentity/Identicon'
import clsx from 'clsx'
import UPlogo from '@/../public/up.png'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full', className }) {
  const router = useRouter()
  const { profile, isLoading } = useProfile(creator)

  // Derived check for layout variations sharing the full metadata sub-row
  const isFullLike = variant === 'full' || variant === 'fullWithoutTime'

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
      <div className={clsx(styles.profileShimmer, 'flex align-items-center gap-050', className)}>
        <div className="shimmer" style={{ width: 36, height: 36 }} />
        {variant !== 'imageOnly' && (
          <div className="flex flex-column gap-025">
            <div className="shimmer rounded" style={{ width: 80, height: 14 }} />
            {isFullLike && <div className="shimmer rounded" style={{ width: 120, height: 10 }} />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={clsx(styles.profile, 'flex align-items-center', className)}
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
            <img alt="verified" src={blueCheckMarkIcon.src} width={12} height={12} />
            {chainInfo && (
              <div className={styles.badge} title={chainInfo.name} dangerouslySetInnerHTML={{ __html: chainInfo.icon }} />
            )}
            {profile.source === `universal_profile` && (
              <div className={styles.badge} onClick={handleUniversalProfile}>
                <img alt={`Universal Profile`} src={UPlogo.src} width={14} height={14} />
              </div>
            )}
            {/* Timestamp remains completely exclusive to the standard 'full' layout variant */}
            {variant === 'full' && createdAt && <small className={styles.createdAt}>{toRelativeTime(createdAt)}</small>}
          </div>

          {isFullLike && creator && <code className={styles.address}>{truncatedAddress}</code>}
        </div>
      )}
    </div>
  )
}