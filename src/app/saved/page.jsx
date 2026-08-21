'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useConnection } from 'wagmi'
import {
  ArrowClockwiseIcon,
  BookmarkSimpleIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DotsThreeIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { PostCard } from '@/components/Post'
import NativePopover from '@/components/ui/NativePopover'
import useRailScroll from '@/hooks/useRailScroll'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { isTextSelectionDrag, rememberCardPointerDown } from '@/lib/cardClick'
import { getSavedPostsKey, getBookmarkFoldersKey } from '@/lib/savedPostsKey'
import DeleteFolderDialog from './_components/DeleteFolderDialog'
import postStyles from '@/components/Post.module.scss'
import styles from './page.module.scss'

// Fixed app header (0.7rem padding x2 + 38px controls), rounded up — the offset a programmatic
// scroll has to leave clear so the toolbar doesn't land underneath it
const HEADER_CLEARANCE = 64

const countFormat = new Intl.NumberFormat(undefined)
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const RELATIVE_UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

/**
 * "2 days ago" for a bookmark's created_at. Only ever rendered after mount (the whole page is
 * gated on useClientMounted), so a server/client clock split can't desync the markup.
 */
const toSavedAgo = (value) => {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''

  const deltaSeconds = Math.round((time - Date.now()) / 1000)
  const magnitude = Math.abs(deltaSeconds)
  const [unit, seconds] = RELATIVE_UNITS.find(([, size]) => magnitude >= size) || ['second', 1]

  return relativeTime.format(Math.round(deltaSeconds / seconds), unit)
}

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
  const [folderPendingDelete, setFolderPendingDelete] = useState(null)
  const [isDeletingFolder, setIsDeletingFolder] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const containerRef = useRef(null)
  const railRef = useRef(null)
  const sentinelRef = useRef(null)
  const searchInputRef = useRef(null)
  const activeChipRef = useRef(null)
  const deleteDialogRef = useRef(null)
  // Escape while renaming unmounts the input, and an unmount fires no blur — this flag is what
  // tells the blur handler (when it does run) that the edit was abandoned, not committed
  const renameAbortedRef = useRef(false)

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

  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    revalidateOnMount: true,
    revalidateOnFocus: true,
    revalidateIfStale: true,
    // Switching folder or typing a search swaps the key; without this the list would blank out
    // to a skeleton on every keystroke instead of dimming the results already on screen
    keepPreviousData: true,
  })

  const posts = useMemo(() => data?.flatMap((pageData) => pageData.data || []) || [], [data])
  const hasMore = Boolean(data?.[data.length - 1]?.meta?.hasMore)
  // The canonical SWR-infinite test for "a further page is in flight": the slot exists but its
  // data hasn't landed. `isValidating` alone also fires on every focus revalidation.
  const isLoadingMore = Boolean(size > 0 && data && typeof data[size - 1] === 'undefined')
  const hasLoadedOnce = Boolean(data)
  const showSkeleton = isConnected && !hasLoadedOnce && !error
  const isRefreshing = isValidating && hasLoadedOnce && !isLoadingMore
  const isSearchPending = queryInput.trim() !== searchQuery
  const total = data?.[0]?.meta?.total ?? null

  const foldersById = useMemo(() => new Map((folders || []).map((folder) => [String(folder.id), folder])), [folders])
  const selectedFolder = selectedFolderId ? foldersById.get(selectedFolderId) : null

  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(railRef, [folders, isAddingFolder, renamingFolderId])
  const railOverflows = canScrollLeft || canScrollRight

  const loadMore = useCallback(() => {
    if (!isValidating) setSize((prev) => prev + 1)
  }, [isValidating, setSize])

  // Auto-load on approach, with the button below as the manual fallback. The callback lives in a
  // ref so the observer never re-attaches just because `loadMore` closed over fresher state.
  const loadMoreRef = useRef(loadMore)
  useEffect(() => {
    loadMoreRef.current = loadMore
  }, [loadMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMoreRef.current()
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, posts.length])

  // Page size resets whenever the view changes, and a filter that returns fewer posts than the
  // one before would otherwise leave the reader stranded at the bottom of a shorter list
  const filterKey = `${selectedFolderId || ''}|${searchQuery}`
  const previousFilterRef = useRef(filterKey)
  useEffect(() => {
    setSize(1)

    if (previousFilterRef.current === filterKey) return
    previousFilterRef.current = filterKey

    const top = containerRef.current?.getBoundingClientRect().top
    if (typeof top === 'number' && top < HEADER_CLEARANCE) {
      // 'instant' is required: the app sets scroll-behavior: smooth globally, and a smooth jump
      // from deep in the list animates the whole way back up
      window.scrollTo({ top: window.scrollY + top - HEADER_CLEARANCE, behavior: 'instant' })
    }
  }, [filterKey, setSize])

  useEffect(() => {
    if (folderPendingDelete) deleteDialogRef.current?.open()
  }, [folderPendingDelete])

  // A folder reached from a post's meta line — or restored from the URL on load — can sit past the
  // visible end of the rail, which reads as an unfiltered page with a mysteriously short list
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [selectedFolderId, folders])

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

  const clearSearch = () => {
    setQueryInput('')
    setSearchQuery('')
    searchInputRef.current?.focus()
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

  const confirmDeleteFolder = async () => {
    const folder = folderPendingDelete
    if (!folder) return

    setIsDeletingFolder(true)
    try {
      const params = new URLSearchParams({ wallet_address: address })
      const res = await fetch(`/api/v1/networks/posts/bookmark-folders/${folder.id}?${params.toString()}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'Failed to delete folder')

      mutateFolders((prev) => (prev || []).filter((f) => f.id !== folder.id), { revalidate: false })
      if (String(folder.id) === selectedFolderId) selectFolder(null)
      deleteDialogRef.current?.close()
      toast(`"${folder.name}" deleted`, 'success')
    } catch (err) {
      toast(err.message || 'Failed to delete folder.', 'error')
    } finally {
      setIsDeletingFolder(false)
    }
  }

  const summary = (() => {
    if (total === null) return null
    if (searchQuery) return `${countFormat.format(total)} ${total === 1 ? 'result' : 'results'} for “${searchQuery}”`
    if (selectedFolder) return `${countFormat.format(total)} in ${selectedFolder.name}`
    return `${countFormat.format(total)} saved ${total === 1 ? 'post' : 'posts'}`
  })()

  return (
    <>
      <PageTitle name="Saved" />
      <div className={`${styles.page} animate fade`}>
        <div ref={containerRef} className={`__container ${styles.page__container}`} data-width="small">
          {!mounted ? null : !isConnected ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyState__icon}>
                <BookmarkSimpleIcon size={26} weight="fill" />
              </span>
              <h3>Connect your wallet</h3>
              <p>Saved posts live with your account. Connect to see the ones you&apos;ve kept.</p>
            </div>
          ) : (
            <>
              {/* Search and folders stay pinned under the app header: on a list hundreds of posts
                  long, filters you have to scroll back up to reach are filters nobody uses. */}
              <div className={styles.toolbar}>
                <div className={clsx(styles.search, 'rounded-full')}>
                  <MagnifyingGlassIcon size={18} aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    className={styles.search__input}
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && queryInput) {
                        e.preventDefault()
                        clearSearch()
                      }
                    }}
                    placeholder={selectedFolder ? `Search in ${selectedFolder.name}` : 'Search saved posts'}
                    aria-label="Search saved posts"
                  />
                  {(isSearchPending || (isRefreshing && searchQuery)) && <span className={styles.search__spinner} aria-hidden="true" />}
                  {queryInput && (
                    <button type="button" className={styles.search__clear} onClick={clearSearch} aria-label="Clear search">
                      <XIcon size={14} weight="bold" />
                    </button>
                  )}
                </div>

                <div className={styles.rail}>
                  <div
                    ref={railRef}
                    className={clsx(
                      styles.rail__track,
                      canScrollLeft && styles['rail__track--moreLeft'],
                      canScrollRight && styles['rail__track--moreRight']
                    )}
                    role="group"
                    aria-label="Filter saved posts by folder"
                  >
                    <button
                      type="button"
                      className={clsx(styles.folder, styles['folder--all'], !selectedFolderId && styles['folder--active'])}
                      aria-pressed={!selectedFolderId}
                      onClick={() => selectFolder(null)}
                    >
                      <span>All</span>
                    </button>

                    {(folders || []).map((folder) =>
                      renamingFolderId === folder.id ? (
                        <form key={folder.id} className={styles.folderAdd} onSubmit={(e) => renameFolder(e, folder)}>
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            maxLength={100}
                            aria-label={`Rename ${folder.name}`}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Escape') return
                              e.preventDefault()
                              renameAbortedRef.current = true
                              setRenamingFolderId(null)
                            }}
                            onBlur={(e) => {
                              if (renameAbortedRef.current) {
                                renameAbortedRef.current = false
                                return
                              }
                              renameFolder(e, folder)
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          key={folder.id}
                          ref={String(folder.id) === selectedFolderId ? activeChipRef : null}
                          className={clsx(styles.folder, String(folder.id) === selectedFolderId && styles['folder--active'])}
                        >
                          <button
                            type="button"
                            className={styles.folder__label}
                            aria-pressed={String(folder.id) === selectedFolderId}
                            onClick={() => selectFolder(folder.id)}
                          >
                            <span className={styles.folder__name}>{folder.name}</span>
                            <span className={styles.folder__count}>{countFormat.format(Number(folder.post_count) || 0)}</span>
                          </button>
                          <NativePopover
                            placement="bottom-start"
                            trigger={
                              <button type="button" className={styles.folder__menu} aria-label={`Manage ${folder.name}`}>
                                <DotsThreeIcon width={14} height={14} weight="bold" />
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
                                        renameAbortedRef.current = false
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
                                    <button
                                      type="button"
                                      onClick={() => {
                                        close()
                                        setFolderPendingDelete(folder)
                                      }}
                                    >
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
                      <form className={styles.folderAdd} onSubmit={createFolder}>
                        <input
                          autoFocus
                          type="text"
                          value={newFolderName}
                          maxLength={100}
                          placeholder="Folder name"
                          aria-label="New folder name"
                          onChange={(e) => setNewFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Escape') return
                            e.preventDefault()
                            setNewFolderName('')
                            setIsAddingFolder(false)
                          }}
                          onBlur={() => !newFolderName.trim() && setIsAddingFolder(false)}
                        />
                      </form>
                    ) : (
                      <button type="button" className={styles.folderAdd} onClick={() => setIsAddingFolder(true)}>
                        <PlusIcon width={14} height={14} />
                        <span>New folder</span>
                      </button>
                    )}
                  </div>

                  {/* Arrows only once the row actually overflows — on a row that fits they promise
                      folders that aren't there */}
                  {railOverflows && (
                    <div className={styles.rail__arrows}>
                      <button
                        type="button"
                        className={styles.rail__arrow}
                        aria-label="Scroll folders left"
                        disabled={!canScrollLeft}
                        onClick={() => scrollByPage(-1)}
                      >
                        <CaretLeftIcon size={13} weight="bold" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.rail__arrow}
                        aria-label="Scroll folders right"
                        disabled={!canScrollRight}
                        onClick={() => scrollByPage(1)}
                      >
                        <CaretRightIcon size={13} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {summary && posts.length > 0 && (
                <p className={styles.summary} aria-live="polite">
                  {summary}
                </p>
              )}

              {showSkeleton ? (
                <SavedSkeleton />
              ) : error && posts.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={clsx(styles.emptyState__icon, styles['emptyState__icon--error'])}>
                    <WarningCircleIcon size={26} weight="fill" />
                  </span>
                  <h3>Couldn&apos;t load your saved posts</h3>
                  <p>{error.message || 'Something went wrong on the way to the server.'}</p>
                  <button type="button" className={styles.emptyState__action} onClick={() => mutate()}>
                    <ArrowClockwiseIcon size={15} weight="bold" />
                    <span>Try again</span>
                  </button>
                </div>
              ) : posts.length === 0 ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyState__icon}>
                    {searchQuery ? <MagnifyingGlassIcon size={26} /> : selectedFolder ? <FolderSimpleIcon size={26} /> : <BookmarkSimpleIcon size={26} weight="fill" />}
                  </span>
                  <h3>{searchQuery ? 'No matches found' : selectedFolder ? 'This folder is empty' : 'Nothing saved yet'}</h3>
                  <p>
                    {searchQuery
                      ? `No saved posts match “${searchQuery}”.`
                      : selectedFolder
                        ? 'File a post here from the bookmark menu on any post you’ve saved.'
                        : 'Tap the bookmark icon on any post to keep it here for later.'}
                  </p>
                  {searchQuery ? (
                    <button type="button" className={styles.emptyState__action} onClick={clearSearch}>
                      <XIcon size={15} weight="bold" />
                      <span>Clear search</span>
                    </button>
                  ) : selectedFolder ? (
                    <button type="button" className={styles.emptyState__action} onClick={() => selectFolder(null)}>
                      <BookmarkSimpleIcon size={15} weight="fill" />
                      <span>Back to all saved</span>
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className={clsx(styles.list, isRefreshing && styles['list--busy'])}>
                    {posts.map((item, i) => {
                      const folder = item.folder_id ? foldersById.get(String(item.folder_id)) : null

                      return (
                        <section
                          key={`${item.network_id}-${item.id}`}
                          className={clsx(styles.post, 'animate', 'fade')}
                          onPointerDown={rememberCardPointerDown}
                          onClick={(e) => {
                            if (isTextSelectionDrag(e)) return
                            handlePostClick(item)
                          }}
                          onMouseEnter={() => handlePostPrefetch(item)}
                          onTouchStart={() => handlePostPrefetch(item)}
                        >
                          {/* Why this post is on this page — the one thing the feed card itself can
                              never say. The folder doubles as a filter shortcut. */}
                          <div className={styles.post__meta}>
                            <BookmarkSimpleIcon size={12} weight="fill" aria-hidden="true" />
                            <span>Saved {toSavedAgo(item.bookmarked_at)}</span>
                            {folder && !selectedFolderId && (
                              <>
                                <span className={styles.post__metaDot} aria-hidden="true" />
                                <button
                                  type="button"
                                  className={styles.post__metaFolder}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    selectFolder(folder.id)
                                  }}
                                >
                                  <FolderSimpleIcon size={12} aria-hidden="true" />
                                  <span>{folder.name}</span>
                                </button>
                              </>
                            )}
                          </div>

                          <PostCard
                            item={item}
                            networkName={item.network_name}
                            actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'bookmark']}
                          />
                          {i < posts.length - 1 && <hr />}
                        </section>
                      )
                    })}
                  </div>

                  {hasMore && (
                    <>
                      <div ref={sentinelRef} aria-hidden="true" />
                      <div className="flex justify-content-center p-100">
                        <button className={styles.loadMore} onClick={loadMore} disabled={isLoadingMore}>
                          {isLoadingMore ? 'Loading…' : 'Load more'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <DeleteFolderDialog
        ref={deleteDialogRef}
        folder={folderPendingDelete}
        isDeleting={isDeletingFolder}
        onConfirm={confirmDeleteFolder}
        onClosed={() => setFolderPendingDelete(null)}
      />
    </>
  )
}

function SavedSkeleton() {
  return (
    <div className={styles.skeletonList} aria-label="Loading saved posts">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <span className={styles.skeletonRow__avatar} />
          <div className={styles.skeletonRow__lines}>
            <p className={styles.skeletonRow__head} />
            <p />
            <p className={styles.skeletonRow__short} />
          </div>
        </div>
      ))}
    </div>
  )
}
