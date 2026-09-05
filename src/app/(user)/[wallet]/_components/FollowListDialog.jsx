'use client'

/**
 * Instagram-style followers/following modal for the profile page.
 * Lists come from the cross-network aggregate APIs (cidex `follows` table) so
 * counts match the profile header. Follow vs Following per row comes from the
 * viewer's following list on the connected chain — the chain the tx lands on —
 * with the aggregate standing in only until that read answers.
 *
 * Rows the viewer doesn't follow yet carry a checkbox — the selection is sent as
 * one followBatch transaction from the action bar, preflighted against the active
 * chain first because a single already-followed address reverts the whole array.
 */

import Link from 'next/link'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import { toast } from '@/components/NextToast'
import { useProfile } from '@/hooks/useProfile'
import { getActiveChain } from '@/lib/communication'
import { chunk, describeDropped } from '@/lib/batchLike'
import { MAX_BATCH_FOLLOW_COUNT, preflightSelection, readFollowingSet } from '@/lib/batchFollow'
import { shortTxError } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
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
  const publicClient = usePublicClient()
  const { mutateAsync: writeContractAsync } = useWriteContract()
  const [activeTab, setActiveTab] = useState('followers')
  const [tabs, setTabs] = useState({ followers: emptyTabState(), following: emptyTabState() })
  // Cross-network "does the viewer follow this address" flags, keyed by lowercase
  // address — the fallback for row state until the connected chain has answered.
  const [viewerFollowing, setViewerFollowing] = useState({})
  // Lowercased addresses the viewer follows on the connected chain; null until read (or unreadable)
  const [onchainFollowing, setOnchainFollowing] = useState(null)
  const [followStateLoading, setFollowStateLoading] = useState(false)
  // Batch-follow selection, keyed by lowercase address (shared across both tabs
  // since the same profile can appear in each). Sent as one followBatch tx.
  const [selected, setSelected] = useState(() => new Set())
  const [isBatchSending, setIsBatchSending] = useState(false)

  // Guards against double-fetching the same page (scroll events fire faster than state settles)
  const loadingRef = useRef({ followers: false, following: false })
  const followerSystemAddress = getActiveChain()?.[1]?.followerSystem
  // Only the newest read may land — a chain or wallet switch mid-flight would seed rows with the old chain's list
  const followingReadRef = useRef(0)
  const openedRef = useRef(false)

  const loadOnchainFollowing = useCallback(async () => {
    const requestId = ++followingReadRef.current
    if (!address || !publicClient || !followerSystemAddress) {
      setOnchainFollowing(null)
      setFollowStateLoading(false)
      return
    }
    setFollowStateLoading(true)
    try {
      const following = await readFollowingSet({ client: publicClient, contractAddress: followerSystemAddress, viewer: address })
      if (requestId === followingReadRef.current) setOnchainFollowing(following)
    } catch (error) {
      console.error('Could not read the following list onchain:', error)
      if (requestId === followingReadRef.current) setOnchainFollowing(null)
    } finally {
      if (requestId === followingReadRef.current) setFollowStateLoading(false)
    }
  }, [address, publicClient, followerSystemAddress])

  // The list is read when the dialog opens, and again whenever the wallet or chain changes while it has been used
  useEffect(() => {
    setOnchainFollowing(null)
    if (openedRef.current) loadOnchainFollowing()
  }, [loadOnchainFollowing])

  const isFollowedByViewer = useCallback(
    (profileAddress) => {
      const key = profileAddress.toLowerCase()
      return onchainFollowing ? onchainFollowing.has(key) : Boolean(viewerFollowing[key])
    },
    [onchainFollowing, viewerFollowing]
  )

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
        openedRef.current = true
        loadOnchainFollowing()
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    [loadPage, loadOnchainFollowing, tabs.followers.page, tabs.following.page]
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

  // One place flips follow state for every reader: the chain set, the aggregate fallback,
  // and the basket (a followed row has no checkbox, so it must leave the selection).
  const markFollowing = useCallback(
    (addresses, following) => {
      const keys = addresses.map((entry) => entry.toLowerCase())
      setOnchainFollowing((prev) => {
        if (!prev) return prev
        const next = new Set(prev)
        for (const key of keys) following ? next.add(key) : next.delete(key)
        return next
      })
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

    if (!followerSystemAddress) {
      toast(`Follow system isn't deployed on this network yet`, `warning`)
      return
    }

    const selection = [...selected]
    if (selection.length === 0) return

    setIsBatchSending(true)

    try {
      let queue = selection

      if (publicClient) {
        try {
          const result = await preflightSelection({
            client: publicClient,
            contractAddress: followerSystemAddress,
            addresses: selection,
            viewer: address,
          })

          queue = result.followable

          // These addresses revert forever on this chain, and one takes the whole array down
          if (result.dropped.length > 0) {
            result.dropped.forEach((entry) => pruneSelection(entry.address))
            toast(`Skipped ${describeDropped(result.dropped)}`, 'info')
          }
        } catch (error) {
          // A failed read is no reason to block the batch; the wallet surfaces
          // anything the preflight would have caught
          console.error('Batch follow preflight failed:', error)
          toast('Could not verify selection, sending as staged', 'info')
        }
      }

      if (queue.length === 0) {
        toast('Everyone selected is already followed', 'info')
        return
      }

      const batches = chunk(queue, MAX_BATCH_FOLLOW_COUNT)

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index]

        if (batches.length > 1) toast(`Signing batch ${index + 1} of ${batches.length}`, 'info')

        await writeContractAsync({
          abi: followerSystemAbi,
          address: followerSystemAddress,
          functionName: 'followBatch',
          args: [batch],
        })

        // Flip the signed rows to Following immediately instead of waiting for
        // cidex. Marking per batch keeps the unsigned remainder selected if a
        // later chunk fails.
        markFollowing(batch, true)
      }

      toast(queue.length === 1 ? 'Profile followed' : `Following ${new Intl.NumberFormat('en').format(queue.length)} profiles`, 'success')
    } catch (error) {
      console.error('Batch follow transaction failed:', error)
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
            followStateLoading={followStateLoading}
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
 * the follow state; the row flips it optimistically around the tx on the active
 * chain's contract and hands it back if that tx fails.
 *
 * The batch checkbox only shows on rows that are still followable — a followed
 * profile can't join a followBatch without reverting the whole array.
 */
const ProfileRow = ({ profileAddress, following, followStateLoading, isSelected, isBatchSending, onToggleSelect, onFollowChanged, onNavigate }) => {
  const { profile, isLoading } = useProfile(profileAddress)
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()
  const followerSystemAddress = activeChain?.[1]?.followerSystem
  const isSelf = address && address.toLowerCase() === profileAddress.toLowerCase()
  // The state before the pending tx, so a failure can put the row back
  const revertToRef = useRef(null)

  const { data: hash, isPending: isSigning, error: submitError, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, error: receiptError } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    const error = submitError || receiptError
    if (!error) return
    toast(error.shortMessage || error.message || 'Failed to update follow status', 'error')
    if (revertToRef.current !== null) onFollowChanged?.([profileAddress], revertToRef.current)
    revertToRef.current = null
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
    revertToRef.current = following
    onFollowChanged?.([profileAddress], !following)
    writeContract({
      address: followerSystemAddress,
      abi: followerSystemAbi,
      functionName: following ? 'unfollow' : 'follow',
      args: [profileAddress],
      chainId: activeChain?.[0]?.id,
    })
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

      <Link href={`/${profileAddress}`} className={styles.row__profile} onClick={onNavigate}>
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
          disabled={isSigning || isConfirming || isBatchSending || followStateLoading}
        >
          {isSigning || isConfirming ? '…' : following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  )
}

export default FollowListDialog
