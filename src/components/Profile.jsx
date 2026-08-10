'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnection, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useProfile } from '@/hooks/useProfile'
import { toRelativeTime } from '@/lib/dateHelper'
import { config, CONTRACTS } from '@/config/wagmi'
import { getActiveChain } from '@/lib/communication'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import { toast } from '@/components/NextToast'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { Identicon } from './ui/UniversalIdentity/Identicon'
import NativePopover from './ui/NativePopover'
import clsx from 'clsx'
import UPlogo from '@/../public/up.png'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full', className }) {
  const router = useRouter()
  const { profile, isLoading } = useProfile(creator)
  const [popoverOpened, setPopoverOpened] = useState(false)

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

  const handleUniversalProfile = (e) => {
    e.stopPropagation()
    const url = `https://universaleverything.io/${creator}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Render placeholder skeletal visual states during active metadata fetches
  if (isLoading || !profile) {
    return (
      <div className={clsx(styles.profileShimmer, 'flex align-items-center gap-050', className)}>
        <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 36, height: 36, flexShrink: 0 }} />
        {variant !== 'imageOnly' && (
          <div className="flex flex-column gap-025">
            <div className="flex flex-row gap-025">
              <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 80, height: 16 }} />
              <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 16, height: 16 }} />
              <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 16, height: 16 }} />
              <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 16, height: 16 }} />
            </div>
            {isFullLike && <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: 80, height: 10 }} />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={clsx(styles.profile, 'flex align-items-center', className)}>
      <NativePopover
        trigger={
          <button
            type="button"
            className={styles.imageWrapper}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open profile card for ${profile.name}`}
          >
            <Image
              className={clsx(styles.imageWrapper__avatar, 'rounded-full')}
              alt={profile.name}
              src={profile.profileImage}
              width={36}
              height={36}
              unoptimized
            />
            <Identicon
              name={profile.name}
              profileImage={profile.profileImage}
              address={creator}
              size={20}
              className={clsx(styles.imageWrapper__fingerprint, 'rounded-full')}
            />
          </button>
        }
        placement="bottom-start"
        onToggle={(e) => {
          if (e.newState === 'open') setPopoverOpened(true)
        }}
      >
        {() => (popoverOpened ? <ProfileHoverCard creator={creator} profile={profile} networkId={networkId} /> : null)}
      </NativePopover>

      {variant !== 'imageOnly' && (
        <div className="flex flex-column align-items-start justify-content-center gap-025">
          <div className={styles.nameRow}>
            <Link
              href={creator ? `/${creator}` : '#'}
              className={styles.name}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => creator && router.prefetch(`/${creator}`)}
              onFocus={() => creator && router.prefetch(`/${creator}`)}
            >
              {profile.fullName || (profile.name + '#' + profile.wallet_address.slice(2, 6))}
            </Link>
            {/* <Image alt="verified" src={blueCheckMarkIcon} width={12} height={12} /> */}
            {chainInfo && (
              <div className={styles.badge} title={chainInfo.name}>
                <img src={chainInfo.iconUrl} alt="" />
              </div>
            )}
            {profile.source === `universal_profile` && (
              <div className={styles.badge} onClick={handleUniversalProfile}>
                <Image alt={`Universal Profile`} src={UPlogo} width={14} height={14} />
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

// Popup shown when the avatar is tapped — mirrors the follow/follower affordances
// on the full profile page, scoped to the post's own chain instead of whichever
// chain the wallet is currently connected to.
const ProfileHoverCard = ({ creator, profile, networkId }) => {
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const [fallbackChain] = getActiveChain()
  const targetNetworkId = networkId || fallbackChain?.id
  const followerSystemAddress = CONTRACTS[`chain${targetNetworkId}`]?.followerSystem
  const isSelf = address && creator && address.toLowerCase() === creator.toLowerCase()

  const truncatedAddress = creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : ''

  const { data: isFollowingData, refetch: refetchIsFollowing } = useReadContract({
    address: followerSystemAddress,
    abi: followerSystemAbi,
    functionName: 'isFollowing',
    args: [address, creator],
    query: { enabled: !!followerSystemAddress && !!address && !!creator && !isSelf },
  })
  const isFollowingTarget = Boolean(isFollowingData)

  const { data: followerCountData, refetch: refetchFollowerCount } = useReadContract({
    address: followerSystemAddress,
    abi: followerSystemAbi,
    functionName: 'followerCount',
    args: [creator],
    query: { enabled: !!followerSystemAddress && !!creator },
  })

  const { data: hash, isPending: isSigning, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isConfirmed) {
      refetchIsFollowing()
      refetchFollowerCount()
    }
  }, [isConfirmed, refetchIsFollowing, refetchFollowerCount])

  const handleFollow = (e) => {
    e.stopPropagation()
    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: isFollowingTarget ? 'unfollow' : 'follow',
      args: [creator],
    })
  }

  return (
    <div className={clsx(styles.hoverCard, 'flex flex-column align-items-start gap-050')} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={styles.hoverCard__avatar} onClick={() => creator && router.push(`/${creator}`)}>
        <Image alt={profile.name} src={profile.profileImage} width={48} height={48} unoptimized />
      </button>

      <div className={styles.nameRow}>
        <Link href={creator ? `/${creator}` : '#'} className={styles.name}>
          {profile.fullName || profile.name}
        </Link>
        <Image alt="verified" src={blueCheckMarkIcon} width={12} height={12} />
      </div>

      {creator && <code className={styles.address}>{truncatedAddress}</code>}

      {profile.description && <p className={styles.hoverCard__bio}>{profile.description}</p>}

      <button type="button" className={styles.hoverCard__followers}>
        {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(followerCountData ?? 0))} followers
      </button>

      {!isSelf && (
        <button type="button" className={styles.hoverCard__followBtn} onClick={handleFollow} disabled={isSigning || isConfirming}>
          {isSigning ? 'Confirm Wallet...' : isConfirming ? 'Confirming...' : isFollowingTarget ? 'Unfollow' : 'Follow'}
        </button>
      )}
    </div>
  )
}
