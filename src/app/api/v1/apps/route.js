import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const [appRows] = await pool.execute(`
      SELECT
        a.id,
        a.network_id,
        a.app_category_id,
        a.owner,
        a.name,
        a.tags,
        a.repo,
        a.links,
        a.url,
        a.logo,
        a.description,
        ac.name AS category_name,
        n.name AS network_name
      FROM apps a
      LEFT JOIN apps_category ac ON ac.id = a.app_category_id
      LEFT JOIN networks n ON n.id = a.network_id
      WHERE a.status = '1'
      ORDER BY a.name ASC
    `)

    const [categoryRows] = await pool.execute(`
      SELECT ac.id, ac.name, COUNT(a.id) AS app_count
      FROM apps_category ac
      LEFT JOIN apps a ON a.app_category_id = ac.id AND a.status = '1'
      GROUP BY ac.id, ac.name
      HAVING app_count > 0
      ORDER BY ac.name ASC
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
    name: row.name || 'Untitled app',
    description: row.description || '',
    url: row.url || null,
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
