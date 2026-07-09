export const SAVED_POSTS_PAGE_SIZE = 20

export const getSavedPostsKey = (pageIndex, address, folderId, query) => {
  if (!address) return null

  const params = new URLSearchParams({
    wallet_address: address,
    page: String(pageIndex + 1),
    limit: String(SAVED_POSTS_PAGE_SIZE),
  })

  if (folderId) params.set('folder_id', String(folderId))
  if (query) params.set('q', query)

  return `/api/v1/networks/posts/bookmarked?${params.toString()}`
}

export const getBookmarkFoldersKey = (address) => {
  if (!address) return null

  return `/api/v1/networks/posts/bookmark-folders?${new URLSearchParams({ wallet_address: address }).toString()}`
}
