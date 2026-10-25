/**
 * @file api/v1/networks/[networkId]/[postId]/thread/route.js
 * @description The rest of a thread an author published in one go, in order — parts 2…N under
 * the root, each a reply by the same author to the part before it, marked { part, of } in its
 * content by the composer.
 *
 * Followed one link at a time rather than by "every self-reply": a later reply the author adds
 * to their own post is a reply, not part of the thread, and only the marker tells the two apart.
 * A part that was deleted ends the chain there, so the page never skips over a hole. Posts from
 * before the marker existed have none, and come back as an empty thread.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'
import { parsePostContent, postRowSelect } from '@/lib/postRowQuery'

export const runtime = 'nodejs'

// The composer has no cap of its own; this bounds the walk against a hand-made marker
const MAX_PARTS = 50

// The marker's part number, or nothing for a row whose content isn't JSON
const PART_SQL = `CASE WHEN JSON_VALID(p.content) THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(p.content, '$.thread.part')) AS UNSIGNED) ELSE NULL END`

export async function GET(request, { params }) {
  try {
    const { networkId, postId } = await params
    const viewerAddress = new URL(request.url).searchParams.get('viewer_address')

    const [[root]] = await pool.execute(
      `SELECT id, contract_address, wallet_address, content FROM posts WHERE network_id = ? AND id = ? AND is_deleted = 0`,
      [networkId, postId],
    )
    const marker = root ? parsePostContent(root.content)?.thread : null
    if (!root || Number(marker?.part) !== 1) return NextResponse.json({ success: true, data: [] })

    const total = Math.min(Number(marker.of) || 0, MAX_PARTS)
    const author = String(root.wallet_address).toLowerCase()

    // Same parent test as the comments route: current rows carry it in parent_id, older ones
    // in is_comment
    const ids = []
    let parentId = root.id
    for (let part = 2; part <= total; part += 1) {
      const [[next]] = await pool.execute(
        `SELECT p.id FROM posts p
          WHERE p.network_id = ? AND p.contract_address <=> ? AND p.is_deleted = 0
            AND (NULLIF(p.parent_id, 0) = ? OR p.is_comment = ?)
            AND LOWER(p.wallet_address) = ?
            AND ${PART_SQL} = ?
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT 1`,
        [networkId, root.contract_address, parentId, parentId, author, part],
      )
      if (!next) break
      ids.push(next.id)
      parentId = next.id
    }

    if (ids.length === 0) return NextResponse.json({ success: true, data: [] })

    const [rows] = await pool.execute(
      `${postRowSelect(Boolean(viewerAddress))}
       WHERE p.network_id = ? AND p.id IN (${ids.map(() => '?').join(', ')})`,
      [...(viewerAddress ? [viewerAddress] : []), networkId, ...ids],
    )
    await fulfillUniversalProfiles(rows, pool)

    // IN () promises no order; the walk's is the thread's
    const byId = new Map(rows.map((row) => [String(row.id), row]))
    const data = ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((row) => ({ ...row, is_liked: Boolean(row.has_liked), content: parsePostContent(row.content) }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET_THREAD_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to fetch thread' }, { status: 500 })
  }
}
