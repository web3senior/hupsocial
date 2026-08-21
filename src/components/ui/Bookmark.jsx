'use client'

import { useState } from 'react'
import { BookmarkSimpleIcon as BookmarkIcon, CheckIcon, PlusIcon, XCircleIcon } from '@phosphor-icons/react'
import useSWR, { useSWRConfig } from 'swr'
import { useConnection } from 'wagmi'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { getPostById } from '@/lib/api'
import { getBookmarkFoldersKey } from '@/lib/savedPostsKey'
import NativePopover from './NativePopover'
import postStyles from '../Post.module.scss'

const foldersFetcher = async (url) => {
  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok || !body.success) throw new Error(body.error || 'Failed to load folders')
  return body.data
}

// Every saved-list view — All, one folder, one search — is its own useSWRInfinite entry, cached
// under the infinite prefix plus the URL of its first page. Matching them by shape instead of
// rebuilding each key by hand is what stops a post unsaved under a folder or search filter from
// lingering on screen until the next refetch.
const isSavedListKey = (key) => typeof key === 'string' && key.startsWith('$inf$') && key.includes('/networks/posts/bookmarked?')

/**
 * Bookmark Interaction Component
 * Bookmarks are offchain-only (see Hup.sol notice), so this simply toggles a DB row — no wallet signature required.
 * Clicking the icon opens a menu (save/remove + folder picker) rather than toggling instantly, since a post can
 * optionally be filed into a single folder (post_bookmarks.folder_id).
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata.
 */
export const Bookmark = ({ post }) => {
  const isMounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const { mutate: mutateGlobal } = useSWRConfig()
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const cacheKey = post?.id ? `posts/${post.network_id}/${post.id}/${address || 'anonymous'}/bookmarks` : null

  const fetcher = async () => {
    try {
      const res = await getPostById(post.network_id, post.id, address)
      const freshPost = Array.isArray(res?.data) ? res.data[0] : res?.data

      if (!freshPost) return null

      return {
        isBookmarked: freshPost.is_bookmarked === true || freshPost.is_bookmarked === 1,
        bookmarkCount: Number(freshPost.total_bookmarks) || 0,
        folderId: freshPost.folder_id ?? null,
        isProcessing: false,
      }
    } catch (error) {
      console.error('Failed to sync bookmark state via API:', error)
      return {
        isBookmarked: post.is_bookmarked === 1 || post.is_bookmarked === true,
        bookmarkCount: Number(post.total_bookmarks) || 0,
        folderId: post.folder_id ?? null,
        isProcessing: false,
      }
    }
  }

  const { data: interactionState, mutate } = useSWR(cacheKey, fetcher, {
    fallbackData: {
      isBookmarked: post.is_bookmarked === 1 || post.is_bookmarked === true,
      bookmarkCount: Number(post.total_bookmarks) || 0,
      folderId: post.folder_id ?? null,
      isProcessing: false,
    },
    // The feed row already carries is_bookmarked/total_bookmarks; without this
    // flag every mounted card refetches its own post row on page load.
    // Bookmark actions revalidate explicitly via mutate().
    revalidateOnMount: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  const foldersKey = isConnected ? getBookmarkFoldersKey(address) : null
  const { data: folders, mutate: mutateFolders } = useSWR(foldersKey, foldersFetcher)

  const invalidateSavedLists = () => {
    if (!address) return
    mutateGlobal(isSavedListKey)
  }

  const saveBookmark = async (folderId = null) => {
    const previousData = interactionState

    try {
      mutate({ isBookmarked: true, bookmarkCount: previousData.bookmarkCount + 1, folderId, isProcessing: true }, { revalidate: false })

      const res = await fetch(`/api/v1/networks/${post.network_id}/${post.id}/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, folder_id: folderId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to save post')

      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })
      invalidateSavedLists()
      toast('Post saved!', 'success')
    } catch (err) {
      console.error('Save failed:', err)
      toast(err.message || 'Failed to save post.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const removeBookmark = async () => {
    const previousData = interactionState

    try {
      mutate(
        { isBookmarked: false, bookmarkCount: Math.max(0, previousData.bookmarkCount - 1), folderId: null, isProcessing: true },
        { revalidate: false }
      )

      const params = new URLSearchParams({ wallet_address: address })
      const res = await fetch(`/api/v1/networks/${post.network_id}/${post.id}/bookmark?${params.toString()}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to remove saved post')

      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })

      if (address) {
        mutateGlobal(
          isSavedListKey,
          (pages) =>
            Array.isArray(pages)
              ? pages.map((pageData) =>
                  pageData?.data
                    ? {
                        ...pageData,
                        data: pageData.data.filter((p) => !(p.id === post.id && p.network_id === post.network_id)),
                        meta: pageData.meta ? { ...pageData.meta, total: Math.max(0, (pageData.meta.total ?? 1) - 1) } : pageData.meta,
                      }
                    : pageData
                )
              : pages,
          { revalidate: false }
        )
      }

      toast('Removed from saved posts', 'success')
    } catch (err) {
      console.error('Remove save failed:', err)
      toast(err.message || 'Failed to remove saved post.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const moveToFolder = async (folderId, close) => {
    close?.()

    if (!interactionState.isBookmarked) {
      await saveBookmark(folderId)
      return
    }

    if (folderId === interactionState.folderId) return

    const previousData = interactionState

    try {
      mutate({ ...previousData, folderId, isProcessing: true }, { revalidate: false })

      const res = await fetch(`/api/v1/networks/${post.network_id}/${post.id}/bookmark`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, folder_id: folderId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to move saved post')

      mutate((prev) => ({ ...prev, isProcessing: false }), { revalidate: true })
      invalidateSavedLists()
      toast('Moved to folder', 'success')
    } catch (err) {
      console.error('Move failed:', err)
      toast(err.message || 'Failed to move saved post.', 'error')
      mutate(previousData, { revalidate: false })
    }
  }

  const createFolder = async (close) => {
    const trimmedName = newFolderName.trim()
    if (!trimmedName) return

    try {
      const res = await fetch('/api/v1/networks/posts/bookmark-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, name: trimmedName }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to create folder')

      setNewFolderName('')
      setIsCreatingFolder(false)
      mutateFolders((prev) => [...(prev || []), body.data], { revalidate: true })
      await moveToFolder(body.data.id, close)
    } catch (err) {
      console.error('Create folder failed:', err)
      toast(err.message || 'Failed to create folder.', 'error')
    }
  }

  const isLoading = interactionState.isProcessing
  const iconColor = interactionState.isBookmarked ? 'var(--blue-500, red)' : 'currentColor'
  const iconWeight = interactionState.isBookmarked ? 'fill' : 'regular'

  const savedOn = post?.bookmarked_at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.bookmarked_at))
    : null

  if (!isMounted) return null

  return (
    <NativePopover
      placement="bottom-end"
      type="auto"
      onBeforeToggle={(e) => {
        if (e.newState === 'open' && !isConnected) {
          e.preventDefault()
          toast('Please connect wallet', 'error')
        }
      }}
      trigger={
        <button
          data-action="bookmark"
          disabled={isLoading}
          aria-label={interactionState.isBookmarked ? 'Manage saved post' : 'Save post'}
          title={savedOn ? `Saved on ${savedOn}` : undefined}
        >
          <BookmarkIcon width={17} height={17} color={iconColor} weight={iconWeight} />
        </button>
      }
    >
      {({ close }) => (
        <div className={`${postStyles.post__dropdown} flex flex-column align-items-center justify-content-start gap-050`}>
          <ul>
            {interactionState.isBookmarked && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    removeBookmark()
                  }}
                >
                  <span>Remove from saved</span>
                  <XCircleIcon width={14} height={14} />
                </button>
              </li>
            )}
            <li>
              <button type="button" onClick={() => moveToFolder(null, close)}>
                <span>All</span>
                {!interactionState.folderId && interactionState.isBookmarked && <CheckIcon width={14} height={14} />}
              </button>
            </li>
            {(folders || []).map((folder) => (
              <li key={folder.id}>
                <button type="button" onClick={() => moveToFolder(folder.id, close)}>
                  <span>{folder.name}</span>
                  {interactionState.folderId === folder.id && <CheckIcon width={14} height={14} />}
                </button>
              </li>
            ))}
            <li>
              {isCreatingFolder ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    createFolder(close)
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    maxLength={100}
                    placeholder="Folder name"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </form>
              ) : (
                <button type="button" onClick={() => setIsCreatingFolder(true)}>
                  <span>New folder</span>
                  <PlusIcon width={14} height={14} />
                </button>
              )}
            </li>
          </ul>
        </div>
      )}
    </NativePopover>
  )
}

export default Bookmark
