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
import { addressTag, isEvmAddress, sameAddress, shortAddress } from '@/lib/address'
import { tunnelChatUrl } from '@/lib/tunnel'
import { getAddress } from 'viem'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import { toast } from '@/components/NextToast'
import AgentBadge from './ui/AgentBadge'
import Avatar from './ui/Avatar'
import PremiumBadge from './ui/PremiumBadge'
import { Identicon } from './ui/UniversalIdentity/Identicon'
import NativePopover from './ui/NativePopover'
import clsx from 'clsx'
import UPlogo from '@/../public/up.png'
import { openConnect } from '@/lib/connectDialog'
import styles from './Profile.module.scss'

export default function Profile({ creator, createdAt, networkId, variant = 'full', size = 32, hoverCard = true, fingerprint = true, linkBox = false, onNavigate, className, fallback }) {
  const router = useRouter()
  // `fallback` is the name and picture a post row already carries (profileFallbackFromRow):
  // the byline paints with it at once and the fetched profile replaces it
  const { profile } = useProfile(creator, fallback)
  const [popoverOpened, setPopoverOpened] = useState(false)

  // Derived check for layout variations sharing the full metadata sub-row
  const isFullLike = variant === 'full' || variant === 'fullWithoutTime' || variant === 'stacked'

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
  //
  // A claimed username is the name itself: it is unique and chosen, so it needs no discriminator
  // and no second `@handle` beside it.
  const displayName = useMemo(() => {
    if (profile?.username) return profile.username
    if (profile?.fullName) return profile.fullName
    const walletAddress = profile?.wallet_address || creator
    return walletAddress ? `${profile?.name}#${addressTag(walletAddress)}` : profile?.name
  }, [profile, creator])

  // The canonical page for this account: its handle wherever there is one, so a link copied out
  // of a feed is the same link the profile itself canonicalizes to.
  const profileHref = profile?.username ? `/@${profile.username}` : creator ? `/${creator}` : '#'

  const handleUniversalProfile = (e) => {
    e.stopPropagation()
    const url = `https://universaleverything.io/${creator}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Placeholder until there is something to show: with no fallback that is the whole fetch,
  // with one it is never (isLoading stays true through a fetch even when fallback data paints)
  if (!profile) {
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
      {/* The fingerprint tells lookalike profiles apart; a purely decorative picture — a corner
          of a tile — can drop it and show the face alone */}
      {fingerprint && (
        <Identicon
          name={profile.name}
          profileImage={profile.profileImage}
          address={creator}
          // Half the picture on a byline, but capped: past a 48px avatar the mark is a
          // discriminator beside a face, not a second picture competing with it
          size={Math.min(24, Math.round(size / 2))}
          className={clsx(styles.imageWrapper__fingerprint)}
        />
      )}
    </>
  )

  // The avatar and the name both open the same card, each anchored to itself. Mounted on first
  // open only: the card reads the follower contract, which a feed of bylines shouldn't pay for.
  const withCard = (trigger) => (
    <NativePopover
      trigger={trigger}
      openOnHover
      placement="bottom-start"
      onToggle={(e) => {
        if (e.newState === 'open') setPopoverOpened(true)
      }}
    >
      {() => (popoverOpened ? (
        <ProfileHoverCard creator={creator} profile={profile} displayName={displayName} profileHref={profileHref} networkId={networkId} />
      ) : null)}
    </NativePopover>
  )

  // Hover-only prefetch: visible links re-prefetch on every router cache invalidation,
  // which looped the chat's sender names into a render per link per second
  const nameLink = (
    <Link
      href={profileHref}
      prefetch={false}
      className={styles.name}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => creator && router.prefetch(profileHref)}
      onFocus={() => creator && router.prefetch(profileHref)}
    >
      {displayName}
    </Link>
  )

  const Container = linkBox ? Link : 'div'
  const containerProps = linkBox ? {
    href: profileHref,
    prefetch: false,
    onClick: onNavigate,
    onMouseEnter: () => creator && router.prefetch(profileHref),
    onFocus: () => creator && router.prefetch(profileHref),
  } : {}

  return (
    <Container {...containerProps} className={clsx(styles.profile, linkBox && styles['profile--linked'], 'flex', className)} style={avatarBox}>
      {linkBox ? <span className={styles.imageWrapper}>{picture}</span> : hoverCard ? withCard(
        <button
          type="button"
          className={styles.imageWrapper}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open profile card for ${profile.name}`}
        >
          {picture}
        </button>
      ) : (
        <Link
          href={profileHref}
          prefetch={false}
          className={styles.imageWrapper}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => creator && router.prefetch(profileHref)}
          onFocus={() => creator && router.prefetch(profileHref)}
          aria-label={`Open the profile of ${profile.name}`}
        >
          {picture}
        </Link>
      )}

      {variant !== 'imageOnly' && (
        <div className={clsx(styles.nameColumn, 'flex flex-column align-items-start justify-content-center')}>
          <div className={styles.nameRow}>
            {linkBox ? <span className={styles.name}>{displayName}</span> : hoverCard ? withCard(nameLink) : nameLink}
            {/* Straight after the name, the way a paid mark is read everywhere else. It is a
                claim about the account, not about the post's chain, so it takes no chain colour. */}
            <PremiumBadge premium={profile.premium} />
            <CommunityBadge badge={profile.badge} iconOnly linked={!linkBox} />
            {/* The automated mark sits ahead of the chain and Universal Profile glyphs: those two
                say where a post came from, this one says what published it. */}
            <AgentBadge agent={profile.agent} iconOnly />
            {chainInfo && (
              <div className={styles.badge} title={chainInfo.name}>
                <img src={chainInfo.iconUrl} alt="" />
              </div>
            )}
            {profile.source === `universal_profile` && (
              <div className={clsx(styles.badge, !linkBox && styles['badge--link'])} title={`Universal Profile`} onClick={linkBox ? undefined : handleUniversalProfile}>
                <Image alt={`Universal Profile`} src={UPlogo} width={14} height={14} />
              </div>
            )}
            {/* Timestamp remains completely exclusive to the standard 'full' layout variant. */}
            {/* Relative time is read off two clocks when the byline is server-rendered — a post
                seconds old can say "12s" in the HTML and "14s" at hydration — so React must not
                treat that text as a mismatch and re-render the whole boundary over it */}
            {variant === 'full' && createdAt && (
              <small className={styles.createdAt} suppressHydrationWarning>
                {toRelativeTime(createdAt)}
              </small>
            )}
          </div>

          {/* The address stays under the name whether or not a handle sits beside it: a name is
              chosen and a handle is claimed, but this is the account itself. */}
          {isFullLike && creator && <code className={styles.address}>{truncatedAddress}</code>}
        </div>
      )}
    </Container>
  )
}

// The community tag a member chose to wear — Hup's answer to a Discord server tag. It renders
// straight from the profile payload, which re-joins community_members on every fetch, so what is
// on screen is a live membership claim and not a remembered one: leaving the community (or being
// banned from it) drops the pill on the next load without anything being written.
export const CommunityBadge = ({ badge, size = 'sm', iconOnly = false, linked = true }) => {
  if (!badge?.tag) return null

  const Tag = linked ? Link : 'span'
  const linkProps = linked ? {
    href: `/communities/${badge.networkId}/${badge.communityId}`,
    onClick: (event) => event.stopPropagation(),
  } : {}

  return (
    <Tag
      {...linkProps}
      className={clsx(styles.communityTag, size === 'lg' && styles['communityTag--lg'], iconOnly && styles['communityTag--icon'])}
      title={iconOnly ? `${badge.tag} — member of ${badge.communityName}` : `Member of ${badge.communityName}`}
    >
      {badge.logoUrl ? (
        <img className={styles.communityTag__logo} src={badge.logoUrl} alt="" width={10} height={10} />
      ) : (
        // A logo-less community would leave the icon-only chip empty, so its tag stands in for one
        iconOnly && <span className={styles.communityTag__initial}>{badge.tag.slice(0, 1)}</span>
      )}
      {!iconOnly && <span>{badge.tag}</span>}
    </Tag>
  )
}

// Popup shown when the avatar or name is hovered (tapped, on pointers without hover): who the
// account is, and the two things a reader does next — follow it or message it. Follows are read
// on the post's own chain instead of whichever chain the wallet is currently connected to.
const ProfileHoverCard = ({ creator, profile, displayName, profileHref, networkId }) => {
  const { address, isConnected } = useConnection()
  const [fallbackChain] = getActiveChain()
  const targetNetworkId = networkId || fallbackChain?.id
  const followerSystemAddress = CONTRACTS[`chain${targetNetworkId}`]?.followerSystem
  const isSelf = sameAddress(address, creator)

  // Same target the profile page's Message button opens
  const tunnelTarget = profile.tunnelAddress ?? (isEvmAddress(creator) ? getAddress(creator.toLowerCase()) : null)

  // The byline already names the account by its handle, so the card leads with the chosen name
  // and keeps the handle as the line under it
  const cardName = profile.fullName || profile.name || displayName
  const cardHandle = profile.username || shortAddress(creator)

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
      if (!openConnect()) toast(`Please connect wallet`, `error`)
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
    <div className={styles.hoverCard} onClick={(e) => e.stopPropagation()}>
      <div className={styles.hoverCard__header}>
        <div className={styles.hoverCard__identity}>
          <Link href={profileHref} prefetch={false} className={styles.hoverCard__name}>
            {cardName}
          </Link>
          <span className={styles.hoverCard__handle}>{cardHandle}</span>
        </div>
        <Link href={profileHref} prefetch={false} className={styles.hoverCard__avatar} aria-label={`Open the profile of ${cardName}`}>
          <Avatar className="rounded-full" alt={cardName} src={profile.profileImage} size={72} />
        </Link>
      </div>

      {profile.description && <p className={styles.hoverCard__bio}>{profile.description}</p>}

      <span className={styles.hoverCard__followers}>
        {new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(followerCountData ?? 0))} followers
      </span>

      {!isSelf && (
        <div className={styles.hoverCard__actions}>
          <button
            type="button"
            className={clsx(styles.hoverCard__btn, !isFollowingTarget && styles['hoverCard__btn--primary'])}
            onClick={handleFollow}
            disabled={isSigning || isConfirming}
          >
            {isSigning ? 'Confirm Wallet...' : isConfirming ? 'Confirming...' : isFollowingTarget ? 'Unfollow' : 'Follow'}
          </button>
          {tunnelTarget && (
            <a className={styles.hoverCard__btn} href={tunnelChatUrl(tunnelTarget)} target="_blank" rel="noopener noreferrer">
              Message
            </a>
          )}
        </div>
      )}
    </div>
  )
}
