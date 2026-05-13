'use client'

import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { getProfile, getUniversalProfile } from '@/lib/api'
import { toRelativeTime } from '@/lib/dateHelper'
import { config } from '@/config/wagmi'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import styles from './Profile.module.scss'

const DEFAULT_USERNAME = 'new-user'
const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

/*
 * Fetcher logic that mimics your fallback chain:
 * Universal Profile -> Local DB -> Fallback Default
 */
const profileFetcher = async (address) => {
  try {
    // 1. Try Universal Profile (LUKSO Standards)
    const res = await getUniversalProfile(address);
    if (res?.data?.Profile?.[0]?.isContract) {
      const p = res.data.Profile[0];
      return {
        wallet: res.data.id,
        // Only use the name if it isn't null/empty
        name: p.name || DEFAULT_USERNAME,
        profileImage: p.profileImages?.[0]?.src || DEFAULT_PFP,
      };
    }
    
    // 2. Try Local Database
    const localRes = await getProfile(address);
    if (localRes?.wallet_address) {
      return {
        ...localRes,
        // Check if name is null from the API response you just shared
        name: localRes.name || DEFAULT_USERNAME,
        profileImage: localRes.profileImage 
          ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${localRes.profileImage}`
          : DEFAULT_PFP
      };
    }
  } catch (e) {
    console.error("Profile fetch error", e);
  }

  // 3. Absolute Fallback
  return { wallet: address, name: DEFAULT_USERNAME, profileImage: DEFAULT_PFP };
};

export default function Profile({
  creator,
  createdAt,
  chainId,
  variant = 'full', // options: 'imageOnly', 'compact', 'full'
}) {
  const router = useRouter()

  // SWR handles caching and loading state
  const { data: profile, isLoading } = useSWR(creator ? `profile-${creator}` : null, () =>
    profileFetcher(creator),
  )

  if (isLoading || !profile) {
    return (
      <div className={`${styles.profileShimmer} flex align-items-center gap-050`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
        {variant !== 'imageOnly' && (
          <div className="flex flex-column gap-025">
            <div className="shimmer rounded" style={{ width: `60px`, height: `10px` }} />
          </div>
        )}
      </div>
    )
  }

  const chainInfo = chainId ? config.chains.find((c) => c.id === chainId) : null

  return (
    <figure
      className={`${styles.profile} flex align-items-center`}
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/${creator}`)
      }}
    >
      <img alt={profile.name} src={profile.profileImage} className="rounded" />

      {variant !== 'imageOnly' && (
        <figcaption className="flex flex-column">
          <div className="flex align-items-center gap-025">
            <span className={styles.name}>{profile.name}</span>
            <img alt="verified" src={blueCheckMarkIcon.src} width={14} />

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

          {variant === 'full' && <code>{`${creator.slice(0, 6)}…${creator.slice(38)}`}</code>}
        </figcaption>
      )}
    </figure>
  )
}
