'use client'

/**
 * Instagram-style followers/following modal for the profile page.
 * Lists come from the cross-network aggregate APIs (cidex `follows` table) so
 * counts match the profile header; the per-row Follow button still reads/writes
 * the LSP26 followerSystem live on whichever chain the viewer's wallet is on.
 */

import Link from 'next/link'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import { toast } from '@/components/NextToast'
import { useProfile } from '@/hooks/useProfile'
import { getActiveChain } from '@/lib/communication'
import followerSystemAbi from '@/abis/LSP26FollowerSystem'
import styles from './FollowListDialog.module.scss'

const PAGE_SIZE = 20
const SCROLL_THRESHOLD = 200

const TABS = [
  { id: 'followers', label: 'Followers' },
  { id: 'following', label: 'Following' },
]

const emptyTabState = () => ({ list: [], page: 0, total: null, hasMore: true, loading: false })

const FollowListDialog = forwardRef(function FollowListDialog({ addr }, ref) {
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const { address } = useConnection()
  const [activeTab, setActiveTab] = useState('followers')
  const [tabs, setTabs] = useState({ followers: emptyTabState(), following: emptyTabState() })
  // Cross-network "does the viewer follow this address" flags, keyed by lowercase
  // address — seeds each row's Follow/Following state (same aggregate the counts use).
  const [viewerFollowing, setViewerFollowing] = useState({})

  // Guards against double-fetching the same page (scroll events fire faster than state settles)
  const loadingRef = useRef({ followers: false, following: false })

  const loadPage = useCallback(
    async (tabId, page) => {
      if (!addr || loadingRef.current[tabId]) return
      loadingRef.current[tabId] = true
      setTabs((prev) => ({ ...prev, [tabId]: { ...prev[tabId], loading: true } }))

      try {
        const qs = address ? `&viewer_address=${address}` : ''
        const res = await fetch(`/api/v1/users/${addr}/${tabId}?page=${page}&limit=${PAGE_SIZE}${qs}`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Request failed')

        setViewerFollowing((prev) => {
          const next = { ...prev }
          for (const followed of json.viewerFollowing || []) next[followed.toLowerCase()] = true
          return next
        })

        setTabs((prev) => {
          const existing = page === 1 ? [] : prev[tabId].list
          const seen = new Set(existing)
          const merged = [...existing, ...json.data.filter((a) => !seen.has(a))]
          return {
            ...prev,
            [tabId]: {
              list: merged,
              page,
              total: json.meta.total,
              hasMore: Boolean(json.meta.hasMore),
              loading: false,
            },
          }
        })
      } catch (error) {
        console.error(`Error loading ${tabId} list:`, error)
        setTabs((prev) => ({ ...prev, [tabId]: { ...prev[tabId], loading: false } }))
      } finally {
        loadingRef.current[tabId] = false
      }
    },
    [addr, address]
  )

  useImperativeHandle(
    ref,
    () => ({
      open: (tabId = 'followers') => {
        setActiveTab(tabId)
        // Both counts show in the header, so prime both tabs on first open
        if (tabs.followers.page === 0) loadPage('followers', 1)
        if (tabs.following.page === 0) loadPage('following', 1)
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    [loadPage, tabs.followers.page, tabs.following.page]
  )

  // The list is the scroll container; pull the next page as it nears the bottom
  const handleScroll = () => {
    const el = listRef.current
    const tab = tabs[activeTab]
    if (!el || !tab.hasMore || tab.loading) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD) {
      loadPage(activeTab, tab.page + 1)
    }
  }

  const switchTab = (tabId) => {
    setActiveTab(tabId)
    if (listRef.current) listRef.current.scrollTop = 0
  }

  const activeList = tabs[activeTab]

  return (
    <NativeDialog ref={dialogRef} lightDismiss className={styles.dialog} aria-label="Followers and following">
      <header className={styles.dialog__tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={clsx(styles.dialog__tab, activeTab === tab.id && styles['dialog__tab--active'])}
            onClick={() => switchTab(tab.id)}
          >
            <span className={styles.dialog__tabLabel}>{tab.label}</span>
            <span className={styles.dialog__tabCount}>
              {tabs[tab.id].total === null ? '…' : new Intl.NumberFormat('en').format(tabs[tab.id].total)}
            </span>
          </button>
        ))}
      </header>

      <div ref={listRef} className={styles.dialog__list} onScroll={handleScroll}>
        {activeList.list.map((profileAddress) => (
          <ProfileRow
            key={profileAddress}
            profileAddress={profileAddress}
            initialFollowing={Boolean(viewerFollowing[profileAddress.toLowerCase()])}
            onNavigate={() => dialogRef.current?.close()}
          />
        ))}

        {activeList.loading && (
          <>
            <div className={clsx(styles.row__shimmer, 'shimmer')} />
            <div className={clsx(styles.row__shimmer, 'shimmer')} />
          </>
        )}

        {!activeList.loading && activeList.list.length === 0 && (
          <p className={styles.dialog__empty}>{activeTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>
        )}
      </div>
    </NativeDialog>
  )
})

/**
 * Single list entry: SWR-cached profile lookup plus a follow toggle. Follow state
 * is seeded from the cross-network aggregate (a live onchain read would only
 * reflect the viewer's current chain — same reasoning as the profile header) and
 * flipped optimistically while the tx goes through the active chain's contract.
 */
const ProfileRow = ({ profileAddress, initialFollowing, onNavigate }) => {
  const { profile, isLoading } = useProfile(profileAddress)
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()
  const followerSystemAddress = activeChain?.[1]?.followerSystem
  const isSelf = address && address.toLowerCase() === profileAddress.toLowerCase()

  const [isFollowingTarget, setIsFollowingTarget] = useState(initialFollowing)

  // The aggregate answer can arrive after first render (viewer connects late, page merge)
  useEffect(() => {
    setIsFollowingTarget(initialFollowing)
  }, [initialFollowing])

  const { data: hash, isPending: isSigning, error: submitError, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, error: receiptError } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    const error = submitError || receiptError
    if (!error) return
    toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
    // Revert the optimistic flip from handleFollow — the tx didn't go through.
    setIsFollowingTarget((prev) => !prev)
  }, [submitError, receiptError])

  const handleFollow = () => {
    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }
    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }
    const wasFollowing = isFollowingTarget
    setIsFollowingTarget(!wasFollowing)
    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: wasFollowing ? 'unfollow' : 'follow',
      args: [profileAddress],
    })
  }

  const truncatedAddress = `${profileAddress.slice(0, 6)}…${profileAddress.slice(-4)}`

  if (isLoading || !profile) return <div className={clsx(styles.row__shimmer, 'shimmer')} />

  return (
    <div className={styles.row}>
      <Link href={`/${profileAddress}`} className={styles.row__profile} onClick={onNavigate}>
        <figure className={styles.row__avatar}>
          <img src={profile.profileImage} alt={profile.name} loading="lazy" />
        </figure>

        <div className={styles.row__info}>
          <b className={styles.row__name}>{profile.name}</b>
          <span className={styles.row__handle}>{truncatedAddress}</span>
        </div>
      </Link>

      {!isSelf && (
        <button
          type="button"
          className={clsx(styles.row__followBtn, isFollowingTarget && styles['row__followBtn--following'])}
          onClick={handleFollow}
          disabled={isSigning || isConfirming}
        >
          {isSigning || isConfirming ? '…' : isFollowingTarget ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  )
}

export default FollowListDialog
