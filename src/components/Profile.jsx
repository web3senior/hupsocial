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
import { isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { addressTag, sameAddress, shortAddress } from '@/lib/address'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { toast } from '@/components/NextToast'
import AgentBadge from './ui/AgentBadge'
import Avatar from './ui/Avatar'
import { Identicon } from './ui/UniversalIdentity/Identicon'
import NativePopover from './ui/NativePopover'
import clsx from 'clsx'
import UPlogo from '@/../public/up.png'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full', size = 32, hoverCard = true, className }) {
  const router = useRouter()
  const { profile, isLoading } = useProfile(creator)
  const [popoverOpened, setPopoverOpened] = useState(false)

  // Derived check for layout variations sharing the full metadata sub-row
  const isFullLike = variant === 'full' || variant === 'fullWithoutTime'

  // The picture's laid-out size, handed to the stylesheet so the shimmer that stands in for it
  // reserves the same box and the fingerprint keeps its proportion. Only `imageOnly` surfaces
  // have reason to move it — a face strip is smaller than a byline.
  //
  // 32px is the byline default, the size Instagram sets a post header's picture at. It costs no
  // less to fetch than a larger slot would — every size from 24 up to 48 rounds to the same 96px
  // rung of the avatar ladder — so this is a layout call, not a bandwidth one.
  const avatarBox = { '--profile-avatar-size': `${size}px` }

  // Extract network configuration based on current chain identifier
  const chainInfo = useMemo(() => {
    if (!networkId) return null
    return isSolanaNetworkId(networkId) ? solanaChainFor(networkId) : config.chains.find((c) => c.id === Number(networkId)) ?? null
  }, [networkId])

  // Truncate public wallet keys into compact readable hashes
  const truncatedAddress = useMemo(() => {
    return shortAddress(creator)
  }, [creator])

  // Name plus a short address discriminator, the way non-UP handles are shown.
  // The address can be absent when the profile fetch failed, so fall back to the
  // creator prop — an upstream hiccup must not take the whole list down with it.
  const displayName = useMemo(() => {
    if (profile?.fullName) return profile.fullName
    const walletAddress = profile?.wallet_address || creator
    return walletAddress ? `${profile?.name}#${addressTag(walletAddress)}` : profile?.name
  }, [profile, creator])

  const handleUniversalProfile = (e) => {
    e.stopPropagation()
    const url = `https://universaleverything.io/${creator}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Render placeholder skeletal visual states during active metadata fetches
  if (isLoading || !profile) {
    return (
      <div className={clsx(styles.profileShimmer, 'flex align-items-center gap-050', className)} style={avatarBox}>
        <div className={clsx(styles.profileShimmer__item,'rounded-full')} style={{ width: size, height: size, flexShrink: 0 }} />
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

  // The picture is the same whether it opens the hover card or, inside that card, links out.
  const picture = (
    <>
      <Avatar
        className={clsx(styles.imageWrapper__avatar, 'rounded-full')}
        alt={profile.name}
        src={profile.profileImage}
        size={size}
      />
      <Identicon
        name={profile.name}
        profileImage={profile.profileImage}
        address={creator}
        size={Math.round(size / 2)}
        className={clsx(styles.imageWrapper__fingerprint)}
      />
    </>
  )

  return (
    <div className={clsx(styles.profile, 'flex align-items-center', className)} style={avatarBox}>
      {hoverCard ? (
        <NativePopover
          trigger={
            <button
              type="button"
              className={styles.imageWrapper}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open profile card for ${profile.name}`}
            >
              {picture}
            </button>
          }
          openOnHover
          placement="bottom-start"
          onToggle={(e) => {
            if (e.newState === 'open') setPopoverOpened(true)
          }}
        >
          {() => (popoverOpened ? <ProfileHoverCard creator={creator} profile={profile} networkId={networkId} /> : null)}
        </NativePopover>
      ) : (
        <Link
          href={creator ? `/${creator}` : '#'}
          className={styles.imageWrapper}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open the profile of ${profile.name}`}
        >
          {picture}
        </Link>
      )}

      {variant !== 'imageOnly' && (
        <div className={clsx(styles.nameColumn, 'flex flex-column align-items-start justify-content-center gap-025')}>
          <div className={styles.nameRow}>
            <Link
              href={creator ? `/${creator}` : '#'}
              className={styles.name}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => creator && router.prefetch(`/${creator}`)}
              onFocus={() => creator && router.prefetch(`/${creator}`)}
            >
              {displayName}
            </Link>
            <CommunityBadge badge={profile.badge} />
            {/* The automated mark sits ahead of the chain and Universal Profile glyphs: those two
                say where a post came from, this one says what published it. */}
            <AgentBadge agent={profile.agent} />
            {chainInfo && (
              <div className={styles.badge} title={chainInfo.name}>
                <img src={chainInfo.iconUrl} alt="" />
              </div>
            )}
            {profile.source === `universal_profile` && (
              <div className={clsx(styles.badge, styles['badge--link'])} title={`View Universal Profile`} onClick={handleUniversalProfile}>
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

// The community tag a member chose to wear — Hup's answer to a Discord server tag. It renders
// straight from the profile payload, which re-joins community_members on every fetch, so what is
// on screen is a live membership claim and not a remembered one: leaving the community (or being
// banned from it) drops the pill on the next load without anything being written.
export const CommunityBadge = ({ badge, size = 'sm' }) => {
  if (!badge?.tag) return null

  return (
    <Link
      href={`/communities/${badge.networkId}/${badge.communityId}`}
      className={clsx(styles.communityTag, size === 'lg' && styles['communityTag--lg'])}
      title={`Member of ${badge.communityName}`}
      onClick={(e) => e.stopPropagation()}
    >
      {badge.logoUrl && <img className={styles.communityTag__logo} src={badge.logoUrl} alt="" width={10} height={10} />}
      <span>{badge.tag}</span>
    </Link>
  )
}

// Popup shown when the avatar is hovered (tapped, on pointers without hover) — mirrors the
// follow/follower affordances on the full profile page, scoped to the post's own chain
// instead of whichever chain the wallet is currently connected to.
const ProfileHoverCard = ({ creator, profile, networkId }) => {
  const { address, isConnected } = useConnection()
  const [fallbackChain] = getActiveChain()
  const targetNetworkId = networkId || fallbackChain?.id
  const followerSystemAddress = CONTRACTS[`chain${targetNetworkId}`]?.followerSystem
  const isSelf = sameAddress(address, creator)
  const [copied, setCopied] = useState(false)

  const truncatedAddress = shortAddress(creator)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(creator)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast(`Could not copy the address`, `error`)
    }
  }

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
      <Profile
        creator={creator}
        networkId={networkId}
        variant="compact"
        size={48}
        hoverCard={false}
        className={styles.hoverCard__profile}
      />

      {creator && (
        <button
          type="button"
          className={styles.hoverCard__copy}
          onClick={handleCopy}
          title={`Copy ${creator}`}
          aria-label={`Copy the wallet address ${creator}`}
        >
          <code className={styles.address}>{truncatedAddress}</code>
          {copied ? <CheckIcon size={12} weight="bold" /> : <CopyIcon size={12} />}
        </button>
      )}

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
