/**
 * @file lib/commentsRequest.js
 * @description The one URL a comment thread is fetched from. Shared by the client cache store
 * that requests it and the post page that preloads it, so the preload the server puts in the
 * document is byte-for-byte the request the browser makes once it hydrates.
 */

export const COMMENTS_PAGE_SIZE = 30

/**
 * @param {string|number} networkId
 * @param {string|number} postId The thread root — a repost resolves to its original before this.
 * @param {string|null} [address] The viewer, whose is_liked the API computes per row.
 * @param {number} [page]
 * @returns {string}
 */
export const commentsPageUrl = (networkId, postId, address = null, page = 1) => {
  let url = `/api/v1/networks/${networkId}/${postId}/comments?page=${page}&limit=${COMMENTS_PAGE_SIZE}`
  if (address) url += `&viewer_address=${encodeURIComponent(address)}`
  return url
}
