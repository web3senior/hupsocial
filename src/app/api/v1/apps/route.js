import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  // Moderators need to see what they hid in order to unhide it — hiding drops status to '0',
  // which would otherwise remove the listing and its moderation controls together, leaving no
  // way back. Not a confidentiality boundary: the same state is readable onchain by anyone.
  const includeHidden = new URL(request.url).searchParams.get('includeHidden') === '1'

  try {
    const [appRows] = await pool.execute(
      `
      SELECT
        a.id,
        a.source,
        a.app_id,
        a.network_id,
        a.app_category_id,
        a.owner,
        a.name,
        a.tags,
        a.repo,
        a.links,
        a.url,
        a.frame_url,
        a.aspect_ratio,
        a.embeddable,
        a.featured,
        a.hidden,
        a.delisted,
        a.logo,
        a.description,
        ac.name AS category_name,
        n.name AS network_name
      FROM apps a
      LEFT JOIN apps_category ac ON ac.id = a.app_category_id
      LEFT JOIN networks n ON n.id = a.network_id
      ${includeHidden ? "WHERE (a.status = '1' OR a.hidden = 1)" : "WHERE a.status = '1'"}
      ORDER BY a.featured DESC, a.name ASC
    `)

    const [categoryRows] = await pool.execute(`
      SELECT ac.id, ac.name, COUNT(a.id) AS app_count
      FROM apps_category ac
      LEFT JOIN apps a ON a.app_category_id = ac.id AND a.status = '1'
      GROUP BY ac.id, ac.name
      HAVING app_count > 0
      ORDER BY ac.name ASC
    `)

    const [networkRows] = await pool.execute(`
      SELECT n.id, n.name, COUNT(a.id) AS app_count
      FROM networks n
      LEFT JOIN apps a ON a.network_id = n.id AND a.status = '1'
      GROUP BY n.id, n.name
      HAVING app_count > 0
      ORDER BY n.name ASC
    `)

    return NextResponse.json({
      success: true,
      data: appRows.map(serializeApp),
      meta: {
        total: appRows.length,
        categories: categoryRows.map((row) => ({
          id: row.id,
          name: row.name,
          app_count: Number(row.app_count || 0),
        })),
        networks: networkRows.map((row) => ({
          id: row.id,
          name: row.name,
          app_count: Number(row.app_count || 0),
        })),
      },
    })
  } catch (error) {
    console.error('[APPS_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch apps',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function serializeApp(row) {
  return {
    id: row.id,
    // Registry listings carry their onchain id; curated rows predate the registry and have none
    source: row.source || 'curated',
    appId: row.app_id != null ? Number(row.app_id) : null,
    name: row.name || 'Untitled app',
    description: row.description || '',
    url: row.url || null,
    frameUrl: row.frame_url || null,
    aspectRatio: row.aspect_ratio || '1:1',
    // Only a moderator grant sets this, and any metadata edit clears it — posts must not embed
    // an app on any weaker signal than this flag.
    embeddable: row.embeddable === 1,
    featured: row.featured === 1,
    hidden: row.hidden === 1,
    // Owner-set and permanent — the contract has no un-delist, so moderators cannot restore it
    delisted: row.delisted === 1,
    logo: row.logo || null,
    repo: row.repo || null,
    owner: row.owner || null,
    tags: parseTags(row.tags),
    links: parseLinks(row.links),
    category: {
      id: row.app_category_id,
      name: row.category_name || 'Uncategorized',
    },
    network: {
      id: row.network_id,
      name: row.network_name || null,
    },
  }
}

function parseTags(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== '?')
}

function parseLinks(raw) {
  if (!raw) return []

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((link) => link && link.name && link.url)
    .map((link) => ({ name: link.name, url: normalizeLinkUrl(link.name, link.url) }))
    .filter((link) => link.url)
}

// The links column mixes full URLs with bare handles (e.g. {"name":"X","url":"stakingverse_io"})
function normalizeLinkUrl(name, url) {
  if (/^https?:\/\//i.test(url)) return url

  const handle = url.replace(/^@/, '')
  switch (name.toLowerCase()) {
    case 'x':
    case 'twitter':
      return `https://x.com/${handle}`
    case 'discord':
      return `https://discord.gg/${handle}`
    case 'telegram':
      return `https://t.me/${handle}`
    case 'github':
      return `https://github.com/${handle}`
    default:
      return null
  }
}
