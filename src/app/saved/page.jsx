'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'
import { BookmarkSimpleIcon, DotsThreeIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { PostCard } from '@/components/Post'
import NativePopover from '@/components/ui/NativePopover'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { getSavedPostsKey, getBookmarkFoldersKey } from '@/lib/savedPostsKey'
import postStyles from '@/components/Post.module.scss'
import styles from './page.module.scss'

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Saved posts failed to load')
  }

  return json
}

const foldersFetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Failed to load folders')
  }

  return json.data
}

export default function SavedPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const [isAddingFolder, setIsAddingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const selectedFolderId = searchParams.get('folder')

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(queryInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [queryInput])

  const foldersKey = isConnected ? getBookmarkFoldersKey(address) : null
  const { data: folders, mutate: mutateFolders } = useSWR(foldersKey, foldersFetcher)

  const getKey = (pageIndex, previousPageData) => {
    if (previousPageData && !previousPageData.meta?.hasMore) return null
    return getSavedPostsKey(pageIndex, address, selectedFolderId, searchQuery)
  }

  const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite(getKey, fetcher, {
    revalidateOnMount: true,
    revalidateOnFocus: true,
    revalidateIfStale: true,
  })

  useEffect(() => {
    setSize(1)
  }, [selectedFolderId, searchQuery, setSize])

  const posts = data?.flatMap((pageData) => pageData.data || []) || []
  const hasMore = Boolean(data?.[data.length - 1]?.meta?.hasMore)
  const isLoadingMore = isValidating && size > 1
  const isLoadingFirstPage = isConnected && !data && !error

  const loadMore = useCallback(() => {
    if (!isValidating) setSize((prev) => prev + 1)
  }, [isValidating, setSize])

  const handlePostPrefetch = (item) => {
    router.prefetch(`/networks/${item.network_id}/${item.id}`)
  }

  const handlePostClick = (item) => {
    router.push(`/networks/${item.network_id}/${item.id}`)
  }

  const selectFolder = (folderId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (folderId) params.set('folder', String(folderId))
    else params.delete('folder')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const createFolder = async (e) => {
    e.preventDefault()
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

      mutateFolders((prev) => [...(prev || []), body.data], { revalidate: false })
      setNewFolderName('')
      setIsAddingFolder(false)
      selectFolder(body.data.id)
    } catch (err) {
      toast(err.message || 'Failed to create folder.', 'error')
    }
  }

  const renameFolder = async (e, folder) => {
    e.preventDefault()
    const trimmedName = renameValue.trim()
    if (!trimmedName || trimmedName === folder.name) {
      setRenamingFolderId(null)
      return
    }

    try {
      const res = await fetch(`/api/v1/networks/posts/bookmark-folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, name: trimmedName }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to rename folder')

      mutateFolders((prev) => (prev || []).map((f) => (f.id === folder.id ? { ...f, name: trimmedName } : f)), { revalidate: false })
      setRenamingFolderId(null)
    } catch (err) {
      toast(err.message || 'Failed to rename folder.', 'error')
    }
  }

  const deleteFolder = async (folder, close) => {
    close?.()
    if (!window.confirm(`Delete "${folder.name}"? Saved posts inside will move back to All.`)) return

    try {
      const params = new URLSearchParams({ wallet_address: address })
      const res = await fetch(`/api/v1/networks/posts/bookmark-folders/${folder.id}?${params.toString()}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to delete folder')

      mutateFolders((prev) => (prev || []).filter((f) => f.id !== folder.id), { revalidate: false })
      if (String(folder.id) === selectedFolderId) selectFolder(null)
    } catch (err) {
      toast(err.message || 'Failed to delete folder.', 'error')
    }
  }

  const selectedFolder = folders?.find((f) => String(f.id) === selectedFolderId)

  return (
    <>
      <PageTitle name="Saved" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          {!mounted ? null : !isConnected ? (
            <div className={styles.emptyState}>
              <BookmarkSimpleIcon size={48} />
              <h3>Connect your wallet</h3>
              <p>Connect your wallet to see the posts you've saved.</p>
            </div>
          ) : (
            <>
              <label className={clsx(styles.search, 'rounded-full')}>
                <MagnifyingGlassIcon size={18} aria-hidden="true" />
                <input
                  type="search"
                  className={styles.search__input}
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="Search saved posts"
                  aria-label="Search saved posts"
                />
              </label>

              <div className={styles.page__folders}>
                <button
                  type="button"
                  className={clsx(styles.page__folder, !selectedFolderId && styles['page__folder--active'])}
                  onClick={() => selectFolder(null)}
                >
                  <span>All</span>
                </button>

                {(folders || []).map((folder) =>
                  renamingFolderId === folder.id ? (
                    <form key={folder.id} className={styles.page__folderAdd} onSubmit={(e) => renameFolder(e, folder)}>
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        maxLength={100}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={(e) => renameFolder(e, folder)}
                      />
                    </form>
                  ) : (
                    <div
                      key={folder.id}
                      className={clsx(styles.page__folder, String(folder.id) === selectedFolderId && styles['page__folder--active'])}
                    >
                      <span onClick={() => selectFolder(folder.id)}>{folder.name}</span>
                      <span className={styles.page__folder__count} onClick={() => selectFolder(folder.id)}>
                        {folder.post_count}
                      </span>
                      <NativePopover
                        placement="bottom-start"
                        trigger={
                          <button type="button" className={styles.page__folder__menu} aria-label={`Manage ${folder.name}`}>
                            <DotsThreeIcon width={13} height={13} />
                          </button>
                        }
                      >
                        {({ close }) => (
                          <div className={postStyles.post__dropdown}>
                            <ul>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingFolderId(folder.id)
                                    setRenameValue(folder.name)
                                    close()
                                  }}
                                >
                                  <span>Rename</span>
                                  <PencilSimpleIcon width={14} height={14} />
                                </button>
                              </li>
                              <li>
                                <button type="button" onClick={() => deleteFolder(folder, close)}>
                                  <span>Delete</span>
                                  <TrashIcon width={14} height={14} />
                                </button>
                              </li>
                            </ul>
                          </div>
                        )}
                      </NativePopover>
                    </div>
                  )
                )}

                {isAddingFolder ? (
                  <form className={styles.page__folderAdd} onSubmit={createFolder}>
                    <input
                      autoFocus
                      type="text"
                      value={newFolderName}
                      maxLength={100}
                      placeholder="Folder name"
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onBlur={() => !newFolderName.trim() && setIsAddingFolder(false)}
                    />
                  </form>
                ) : (
                  <button type="button" className={styles.page__folderAdd} onClick={() => setIsAddingFolder(true)}>
                    <PlusIcon width={14} height={14} />
                    <span>New folder</span>
                  </button>
                )}
              </div>

              {isLoadingFirstPage ? (
                <SavedSkeleton />
              ) : posts.length === 0 ? (
                <div className={styles.emptyState}>
                  <BookmarkSimpleIcon size={48} />
                  <h3>{searchQuery ? 'No matches found' : selectedFolder ? 'This folder is empty' : 'No saved posts yet'}</h3>
                  <p>
                    {searchQuery
                      ? `No saved posts match "${searchQuery}".`
                      : selectedFolder
                        ? 'Move saved posts here from the bookmark button on any post.'
                        : "Tap the bookmark icon on any post to save it here for later."}
                  </p>
                </div>
              ) : (
                <>
                  {posts.map((item, i) => (
                    <section
                      key={`${item.network_id}-${item.id}`}
                      className={clsx(styles.post, 'animate', 'fade')}
                      onClick={() => handlePostClick(item)}
                      onMouseEnter={() => handlePostPrefetch(item)}
                      onTouchStart={() => handlePostPrefetch(item)}
                    >
                      <PostCard item={item} networkName={item.network_name} actions={['like', 'comment', 'share', 'repost', 'view', 'bookmark']} />
                      {i < posts.length - 1 && <hr />}
                    </section>
                  ))}

                  {hasMore && (
                    <div className="flex justify-content-center p-100">
                      <button className={styles.loadMore} onClick={loadMore} disabled={isLoadingMore}>
                        {isLoadingMore ? 'Loading...' : 'Load More'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function SavedSkeleton() {
  return (
    <div className={styles.skeletonList} aria-label="Loading saved posts">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <span />
          <div>
            <p />
            <p />
          </div>
        </div>
      ))}
    </div>
  )
}
