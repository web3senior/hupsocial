'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { getProfile, getUniversalProfile } from '@/lib/api'
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import styles from './Profile.module.scss'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

// Fetcher logic extracted for better testability and SWR compatibility
const profileFetcher = async (address) => {
  if (!address) return null

  try {
    // Attempt Universal Profile (LUKSO) first
    const res = await getUniversalProfile(address)
    console.log(res)
    if (res?.Profile?.[0]?.isContract) {
      const p = res.Profile[0]
      return {
        wallet: res.id,
        name: p.name || DEFAULT_USERNAME,
        profileImage: p.profileImages?.[0]?.src || DEFAULT_PFP,
      }
    }

    // Fallback to local database
    const localRes = await getProfile(address)
    if (localRes?.wallet_address) {
      return {
        ...localRes,
        name: localRes.name || DEFAULT_USERNAME,
        profileImage: localRes.profileImage
          ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${localRes.profileImage}`
          : DEFAULT_PFP,
      }
    }
  } catch (e) {
    console.error("Profile fetch error:", e)
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

  const { data: profile, isLoading } = useSWR(
    creator ? `profile-${creator}` : null,
    () => profileFetcher(creator),
    { revalidateOnFocus: false } // Prevents flickering when switching tabs
  )

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

  return (
    <figure
      className={`${styles.profile} flex align-items-center gap-050`}
      onClick={handleNavigation}
      role="button"
      tabIndex={0}
    >
      <div className={styles.imageWrapper}>
        <img
          alt={profile.name}
          src={profile.profileImage}
          width={36}
          height={36}
          className="rounded-full"
          unoptimized={profile.profileImage.includes('ipfs')} // IPFS images often need raw gateway access
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