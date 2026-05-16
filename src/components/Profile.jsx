'use client'

import { useMemo, useState, useEffect } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { getProfile, getUniversalProfile } from '@/lib/api'
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import { is0GHash, resolve0GUrl } from '@/lib/storageHelper'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import styles from './Profile.module.scss'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

/**
 * Clean data fetcher that queries LUKSO Universal Profiles first, 
 * falling back to the local database configuration.
 * Adheres to rule: No side-effect logic here.
 */
const profileFetcher = async (address) => {
  if (!address) return null

  try {
    // Attempt Universal Profile (LUKSO) mapping first
    const res = await getUniversalProfile(address)
    if (res?.Profile?.[0]?.isContract) {
      const p = res.Profile[0]
      return {
        wallet: res.id,
        name: p.name || DEFAULT_USERNAME,
        profileImage: p.profileImages?.[0]?.src || DEFAULT_PFP,
      }
    }

    // Fallback to local database mapping
    const localRes = await getProfile(address)
    if (localRes?.wallet_address) {
      return {
        ...localRes,
        name: localRes.name || DEFAULT_USERNAME,
        profileImage: localRes.profileImage || DEFAULT_PFP,
      }
    }
  } catch (e) {
    console.error('Profile fetch pipeline error:', e)
  }

  return { wallet: address, name: DEFAULT_USERNAME, profileImage: DEFAULT_PFP }
}

export default function Profile({
  creator,
  createdAt,
  chainId,
  variant = 'full',
}) {
  const router = useRouter()
  const [resolvedUrl, setResolvedUrl] = useState(null)

  // SWR handles client-side caching gracefully
  const { data: profile, isLoading } = useSWR(
    creator ? `profile-${creator}` : null,
    () => profileFetcher(creator),
    { revalidateOnFocus: false }
  )

  // Asynchronously resolve 0G hashes using our storageHelper script
  useEffect(() => {
    // If there's no profile image asset or it's a standard web URL/IPFS CID, exit
    if (!profile?.profileImage || !is0GHash(profile.profileImage)) {
      setResolvedUrl(null)
      return
    }

    let isMounted = true

    const getAssetBlob = async () => {
      const blobUrl = await resolve0GUrl(profile.profileImage)
      if (blobUrl && isMounted) {
        setResolvedUrl(blobUrl)
      }
    }

    getAssetBlob()

    return () => {
      isMounted = false
    }
  }, [profile?.profileImage])

  const chainInfo = useMemo(() => {
    return chainId ? config.chains.find((c) => c.id === chainId) : null
  }, [chainId])

  const handleNavigation = (e) => {
    e.stopPropagation()
    if (creator) router.push(`/${creator}`)
  }

  if (isLoading || !profile) {
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className="shimmer rounded-full" style={{ width: 36, height: 36 }} />
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

  // Determine the final rendering image target string
  const finalImageSrc = is0GHash(profile.profileImage)
    ? (resolvedUrl || '/placeholder-loading-spinner.gif')
    : profile.profileImage

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
        <img
          alt={profile.name}
          src={finalImageSrc}
          width={36}
          height={36}
          className="rounded-full"
          style={{ objectFit: 'cover' }}
        />
      </div>

      {variant !== 'imageOnly' && (
        <figcaption className="flex flex-column justify-center gap-025">
          <div className="flex align-items-center gap-025">
            <span className={styles.name}>{profile.name}</span>
            <Image alt="verified" src={blueCheckMarkIcon} width={14} height={14} />

            {chainInfo && (
              <div
                className={styles.badge}
                title={chainInfo.name}
                dangerouslySetInnerHTML={{ __html: chainInfo.icon }}
              />
            )}

            {variant === 'full' && createdAt && (
              <span className={styles.createdAt}>{toRelativeTime(createdAt)}</span>
            )}
          </div>

          {variant === 'full' && creator && (
            <code className={styles.address}>{truncatedAddress}</code>
          )}
        </figcaption>
      )}
    </figure>
  )
}