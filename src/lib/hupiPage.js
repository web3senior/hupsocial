/**
 * @file lib/hupiPage.js
 * @description Which Hup page a path is, as far as Hupi cares: a post or a profile. Shared by the
 * panel (to offer "Summarise this post") and the route (to let Hupi read it), so both agree on
 * what "this" means. Pure — no server imports.
 */

import { isEvmAddress } from '@/lib/address'
import { readHandleSegment } from '@/lib/username'

const POST_PATH = /^\/networks\/(\d+)\/(\d+)\/?$/
// Profiles are linked as /@handle or /0x…; a bare /word is far more often an app route
const PROFILE_PATH = /^\/(@[^/]+|0x[0-9a-fA-F]{40})\/?$/

/**
 * @param {*} path A pathname, e.g. "/networks/1/42" or "/@alice".
 * @returns {{kind: 'post', networkId: number, postId: number, path: string}
 *   | {kind: 'profile', address: string|null, handle: string|null, path: string}
 *   | null}
 */
export const parseHupiPage = (path) => {
  const value = typeof path === 'string' ? path.slice(0, 200) : ''

  const post = value.match(POST_PATH)
  if (post) return { kind: 'post', networkId: Number(post[1]), postId: Number(post[2]), path: value }

  const profile = value.match(PROFILE_PATH)
  if (!profile) return null

  let segment = profile[1]
  try {
    segment = decodeURIComponent(segment)
  } catch {
    return null
  }
  if (isEvmAddress(segment)) return { kind: 'profile', address: segment.toLowerCase(), handle: null, path: value }

  const handle = readHandleSegment(segment)
  return handle ? { kind: 'profile', address: null, handle: handle.key, path: value } : null
}
