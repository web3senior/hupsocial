import pool from '@/lib/db'
import { articlePath } from '@/lib/article'

/**
 * The site's sitemap.
 *
 * This replaced a hand-generated public/sitemap.xml that held a single URL, stamped 2025-10-03 —
 * every article, and every static route added since, was invisible to crawlers. A file under
 * public/ would shadow this route, which is why that one had to go rather than sit alongside it.
 *
 * Articles are the only dynamic entries here for now: they are the pages written to be found in
 * search. Posts, profiles and markets are addressable too, but they number in the hundreds of
 * thousands and belong in their own paginated sitemaps (generateSitemaps) rather than bloating
 * this one past the 50,000-URL limit the protocol sets.
 */

/* Rebuilt at most this often. A sitemap is a hint to a crawler, not a live view, and the query
   below scans posts — paying for it on every request would be a self-inflicted load test. */
export const revalidate = 3600

/* Well inside the protocol's 50,000-URL ceiling, and far more articles than exist today. If this
   is ever the binding limit, the fix is generateSitemaps, not a bigger number. */
const ARTICLE_LIMIT = 5000

/* Everything reachable without an id. Deliberately hand-listed: the app has routes that should
   never be in an index (/compose, /settings, /unlock, /secure-account, anything behind a wallet),
   and enumerating the app directory would sweep those in. */
const STATIC_ROUTES = [
  { path: '/', priority: 1, changeFrequency: 'hourly' },
  { path: '/shorts', priority: 0.8, changeFrequency: 'hourly' },
  /* Above the other section indexes: it is the doorway to the pages here written to be found */
  { path: '/articles', priority: 0.9, changeFrequency: 'daily' },
  { path: '/apps', priority: 0.7, changeFrequency: 'daily' },
  { path: '/bazaar', priority: 0.7, changeFrequency: 'daily' },
  { path: '/communities', priority: 0.7, changeFrequency: 'daily' },
  { path: '/drops', priority: 0.7, changeFrequency: 'daily' },
  { path: '/events', priority: 0.7, changeFrequency: 'daily' },
  { path: '/jobs', priority: 0.7, changeFrequency: 'daily' },
  { path: '/launches', priority: 0.7, changeFrequency: 'daily' },
  { path: '/leaderboard', priority: 0.6, changeFrequency: 'daily' },
  { path: '/nfts', priority: 0.7, changeFrequency: 'daily' },
  { path: '/polls', priority: 0.7, changeFrequency: 'daily' },
  { path: '/predict', priority: 0.7, changeFrequency: 'daily' },
  { path: '/swap', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/networks', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/help', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/install', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/privacy-policy', priority: 0.3, changeFrequency: 'yearly' },
]

/**
 * Published articles, newest first.
 *
 * JSON_VALUE on an unindexed column means a scan, which is exactly why this route caches for an
 * hour rather than running per request. Returns [] on failure: a sitemap missing its articles is
 * a bad day for SEO, but a sitemap route that throws takes the whole file down with it.
 */
async function fetchArticles() {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.network_id, p.created_at,
              JSON_VALUE(p.content, '$.article.title') AS title
       FROM posts p
       WHERE p.is_deleted = 0
         AND JSON_VALID(p.content)
         AND JSON_VALUE(p.content, '$.article.bodyCid') IS NOT NULL
       ORDER BY p.created_at DESC
       LIMIT ${ARTICLE_LIMIT}`
    )
    return rows
  } catch (error) {
    console.error('[sitemap] could not list articles:', error.message)
    return []
  }
}

export default async function sitemap() {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/$/, '')
  const articles = await fetchArticles()

  return [
    ...STATIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
      url: `${baseUrl}${path}`,
      changeFrequency,
      priority,
    })),
    ...articles.map((row) => ({
      url: `${baseUrl}${articlePath(row.network_id, row.id, row.title)}`,
      lastModified: row.created_at ? new Date(row.created_at) : undefined,
      changeFrequency: 'monthly',
      /* Above the section indexes: an article is a destination, a listing page is a doorway */
      priority: 0.8,
    })),
  ]
}
