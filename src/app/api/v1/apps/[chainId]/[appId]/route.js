import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

/**
 * Resolves a single registered app for in-post embedding.
 *
 * This route is the only thing standing between a post's `{ appId, chainId }` reference and an
 * iframe that can ask viewers to sign transactions, so the embeddable gate lives in the SQL
 * rather than in the caller: a non-embeddable, hidden, or delisted app is a 404 here. A client
 * bug therefore fails closed instead of rendering an unreviewed frame.
 *
 * @param {Request} request
 * @param {{params: Promise<{chainId: string, appId: string}>}} context
 */
export async function GET(request, context) {
  const { chainId, appId } = await context.params

  const networkId = Number(chainId)
  const onchainId = Number(appId)

  if (!Number.isSafeInteger(networkId) || !Number.isSafeInteger(onchainId) || networkId <= 0 || onchainId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid app reference' }, { status: 400 })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         a.app_id,
         a.network_id,
         a.name,
         a.description,
         a.frame_url,
         a.aspect_ratio,
         a.logo,
         a.owner,
         a.reviewed_at,
         ac.name AS category_name,
         n.name AS network_name
       FROM apps a
       LEFT JOIN apps_category ac ON ac.id = a.app_category_id
       LEFT JOIN networks n ON n.id = a.network_id
       WHERE a.source = 'onchain'
         AND a.network_id = ?
         AND a.app_id = ?
         AND a.embeddable = 1
         AND a.hidden = 0
         AND a.delisted = 0
         AND a.status = '1'
         AND a.frame_url IS NOT NULL
       LIMIT 1`,
      [networkId, onchainId],
    )

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'App is not available for embedding' }, { status: 404 })
    }

    const row = rows[0]

    // The frame runs with allow-same-origin so real apps can use storage and WebCrypto. That is
    // safe only while the frame is genuinely cross-origin: an app served from Hup's own origin
    // would become same-origin with the parent, letting it read Hup's localStorage (burner
    // session keys included) and strip its own sandbox attribute. Refuse those outright.
    const hostOrigin = new URL(request.url).origin
    if (safeOrigin(row.frame_url) === hostOrigin) {
      console.error('[APP_EMBED_BLOCKED]: same-origin frame URL', { appId: onchainId, networkId })
      return NextResponse.json({ success: false, error: 'App is not available for embedding' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        appId: Number(row.app_id),
        chainId: Number(row.network_id),
        name: row.name || 'Untitled app',
        description: row.description || '',
        frameUrl: row.frame_url,
        // The frame's origin is what the bridge checks every inbound message against
        origin: safeOrigin(row.frame_url),
        aspectRatio: row.aspect_ratio || '1:1',
        logo: row.logo || null,
        owner: row.owner || null,
        reviewedAt: row.reviewed_at != null ? Number(row.reviewed_at) : null,
        category: row.category_name || 'Uncategorized',
        network: row.network_name || null,
      },
    })
  } catch (error) {
    console.error('[APP_EMBED_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to resolve app',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function safeOrigin(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
