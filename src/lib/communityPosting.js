/**
 * @file lib/communityPosting.js
 * @description Whether a wallet can post into a community, answered from the indexed directory
 * row (with the `viewer` standing the communities API attaches). It follows HupCommunity's
 * canPost() in the contract's own order, minus the trailing isEligible() balance re-check no
 * index can answer: a member holding a gating asset is presumed to still hold it, and the post's
 * own transaction, plus cidex's canPost() check before tagging it, is what settles that.
 */

// HupCommunity's announcement type: only moderators (and the creator) write there
const COMMUNITY_TYPE_ANNOUNCEMENT = 1

const sameAddress = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase())

/**
 * @param {object} row A community row from /api/v1/networks/communities, `viewer` attached.
 * @param {string} address The wallet that would post.
 * @returns {boolean}
 */
export const canPostInCommunity = (row, address) => {
  if (!row || !address || !Number(row.is_active)) return false
  const viewer = row.viewer ?? {}
  if (Number(viewer.is_banned)) return false
  if (sameAddress(row.creator_address, address) || sameAddress(row.governor_address, address) || Number(viewer.is_moderator)) return true
  if (Number(row.community_type) === COMMUNITY_TYPE_ANNOUNCEMENT) return false
  return Boolean(Number(viewer.is_member) && Number(viewer.can_post))
}
