'use client'

/**
 * Instagram-style followers/following modal for the profile page.
 * Lists come from the aggregate APIs over the `follows` table (offchain follows plus
 * LUKSO's LSP26, config/socialGraph.js), so counts match the profile header and every
 * row's Follow vs Following comes with the page that lists it.
 *
 * Rows the viewer doesn't follow yet carry a checkbox — the selection is followed in
 * one go from the action bar, using the connected wallet's follow route (lib/follow.js).
 */

import Link from 'next/link'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import { toast } from '@/components/NextToast'
import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
import { chunk } from '@/lib/batchLike'
import { fetchFollowRelations, setFollowing } from '@/lib/follow'
import { MAX_FOLLOW_TARGETS } from '@/config/socialGraph'
import { shortTxError } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
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
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const [activeTab, setActiveTab] = useState('followers')
  const [tabs, setTabs] = useState({ followers: emptyTabState(), following: emptyTabState() })
  // "Does the viewer follow this address" flags, keyed by lowercase address
  const [viewerFollowing, setViewerFollowing] = useState({})
  // Batch-follow selection, keyed by lowercase address (shared across both tabs
  // since the same profile can appear in each)
  const [selected, setSelected] = useState(() => new Set())
  const [isBatchSending, setIsBatchSending] = useState(false)

  // Guards against double-fetching the same page (scroll events fire faster than state settles)
  const loadingRef = useRef({ followers: false, following: false })

  const isFollowedByViewer = useCallback((profileAddress) => Boolean(viewerFollowing[profileAddress.toLowerCase()]), [viewerFollowing])

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
        // A basket left over from a previous open would be invisible until the
        // action bar appeared with a count the viewer never chose.
        setSelected(new Set())
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

  const toggleSelect = useCallback((profileAddress) => {
    const key = profileAddress.toLowerCase()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // A row followed through its own button leaves the basket — its checkbox is
  // gone, so a stale entry would make the action-bar count lie.
  const pruneSelection = useCallback((profileAddress) => {
    const key = profileAddress.toLowerCase()
    setSelected((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  // One place flips follow state for every reader: the row flags and the basket
  // (a followed row has no checkbox, so it must leave the selection).
  const markFollowing = useCallback(
    (addresses, following) => {
      const keys = addresses.map((entry) => entry.toLowerCase())
      setViewerFollowing((prev) => {
        const next = { ...prev }
        for (const key of keys) next[key] = following
        return next
      })
      if (following) addresses.forEach(pruneSelection)
    },
    [pruneSelection]
  )

  // Only the loaded rows of the active tab — unloaded pages can't be consented to.
  const selectAllLoaded = () => {
    const viewerKey = address?.toLowerCase()
    setSelected((prev) => {
      const next = new Set(prev)
      for (const profileAddress of tabs[activeTab].list) {
        const key = profileAddress.toLowerCase()
        if (key === viewerKey || isFollowedByViewer(profileAddress)) continue
        next.add(key)
      }
      return next
    })
  }

  const sendBatchFollow = async () => {
    if (!address) {
      toast(`Please connect wallet`, `error`)
      return
    }

    const queue = [...selected]
    if (queue.length === 0) return

    setIsBatchSending(true)

    try {
      // The shared follow helper filters existing relations before onchain batches.
      for (const batch of chunk(queue, MAX_FOLLOW_TARGETS)) {
        await setFollowing({ address, targets: batch, following: true, signMessageAsync, chainId })
        // Marked per batch, so the remainder stays selected if a later one fails
        markFollowing(batch, true)
      }

      toast(queue.length === 1 ? 'Profile followed' : `Following ${new Intl.NumberFormat('en').format(queue.length)} profiles`, 'success')
    } catch (error) {
      console.error('Batch follow failed:', error)
      toast(shortTxError(error, 'Batch follow failed'), 'error')
    } finally {
      setIsBatchSending(false)
    }
  }

  const activeList = tabs[activeTab]

  // Mirrors the per-row checkbox condition, so the bar can't appear over a list
  // where every row is the viewer or already followed.
  const selectableCount = address
    ? activeList.list.filter((entry) => entry.toLowerCase() !== address.toLowerCase() && !isFollowedByViewer(entry)).length
    : 0

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
            following={isFollowedByViewer(profileAddress)}
            isSelected={selected.has(profileAddress.toLowerCase())}
            isBatchSending={isBatchSending}
            onToggleSelect={toggleSelect}
            onFollowChanged={markFollowing}
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

      {(selectableCount > 0 || selected.size > 0) && (
        <footer className={styles.dialog__actions}>
          <button
            type="button"
            className={styles.dialog__selectAll}
            onClick={selectAllLoaded}
            disabled={isBatchSending || selectableCount === 0}
          >
            Select all loaded
          </button>

          <button
            type="button"
            className={styles.dialog__batchBtn}
            onClick={sendBatchFollow}
            disabled={selected.size === 0 || isBatchSending}
          >
            {isBatchSending ? 'Confirm Wallet…' : `Follow ${new Intl.NumberFormat('en').format(selected.size)} selected`}
          </button>
        </footer>
      )}
    </NativeDialog>
  )
})

/**
 * Single list entry: SWR-cached profile lookup plus a follow toggle. The dialog owns
 * the follow state; the row flips it optimistically and hands it back if the follow fails.
 *
 * The batch checkbox only shows on rows that are still followable.
 */
const ProfileRow = ({ profileAddress, following, isSelected, isBatchSending, onToggleSelect, onFollowChanged, onNavigate }) => {
  const { profile, isLoading } = useProfile(profileAddress)
  const { address, isConnected } = useConnection()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const isSelf = address && address.toLowerCase() === profileAddress.toLowerCase()
  const [isBusy, setIsBusy] = useState(false)

  const handleFollow = async () => {
    if (isBusy || isBatchSending) return
    if (!isConnected) {
      toast(`Please connect wallet`, `error`)
      return
    }
    setIsBusy(true)
    onFollowChanged?.([profileAddress], !following)
    try {
      // An unfollow also has to clear a LUKSO LSP26 follow, if this is one
      const onchain = following ? (await fetchFollowRelations(address, [profileAddress])).onchain : []
      await setFollowing({ address, targets: [profileAddress], following: !following, signMessageAsync, chainId, onchain })
    } catch (error) {
      toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
      // A failed onchain unfollow must remain retryable even if legacy offchain cleanup landed.
      onFollowChanged?.([profileAddress], following)
    } finally {
      setIsBusy(false)
    }
  }

  const truncatedAddress = `${profileAddress.slice(0, 6)}…${profileAddress.slice(-4)}`

  if (isLoading || !profile) return <div className={clsx(styles.row__shimmer, 'shimmer')} />

  const isSelectable = isConnected && !isSelf && !following

  return (
    <div className={clsx(styles.row, isSelected && styles['row--selected'])}>
      {isSelectable && (
        <input
          type="checkbox"
          className={styles.row__checkbox}
          checked={isSelected}
          disabled={isBatchSending}
          onChange={() => onToggleSelect?.(profileAddress)}
          aria-label={`Select ${profile.name} for batch follow`}
        />
      )}

      <Link href={profilePath(profileAddress, profile?.username)} className={styles.row__profile} onClick={onNavigate}>
        <figure className={styles.row__avatar}>
          <Avatar src={profile.profileImage} size={44} alt={profile.name} />
        </figure>

        <div className={styles.row__info}>
          <b className={styles.row__name}>{profile.name}</b>
          <span className={styles.row__handle}>{truncatedAddress}</span>
        </div>
      </Link>

      {!isSelf && (
        <button
          type="button"
          className={clsx(styles.row__followBtn, following && styles['row__followBtn--following'])}
          onClick={handleFollow}
          disabled={isBusy || isBatchSending}
        >
          {isBusy ? '…' : following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  )
}

export default FollowListDialog
