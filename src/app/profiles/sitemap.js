import { countListableProfiles, listProfiles, sitemapChunkCount } from '@/lib/profileSitemap'

/**
 * Profiles, one sitemap per 25,000 accounts, served at /profiles/sitemap/{id}.xml.
 *
 * Each account is listed twice: the page, and the plain-text llms.txt beside it. Nothing probes
 * that second URL on its own, so this is where an agent that never opened the profile learns it
 * exists. The main sitemap keeps articles and static routes; profiles live here so that file
 * never nears the 50,000-URL ceiling.
 */

export const revalidate = 3600

export async function generateSitemaps() {
  const total = await countListableProfiles()
  return Array.from({ length: sitemapChunkCount(total) }, (_, id) => ({ id }))
}

export default async function sitemap({ id }) {
  const chunk = await id
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/$/, '')
  const profiles = await listProfiles(chunk)

  return profiles.flatMap((row) => {
    const lastModified = row.lastUpdate ? new Date(row.lastUpdate) : undefined
    // The same path the page canonicalizes to, so the two never disagree
    const path = row.username ? `@${row.username}` : row.wallet_address
    return [
      {
        url: `${baseUrl}/${path}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.6,
      },
      {
        url: `${baseUrl}/${path}/llms.txt`,
        lastModified,
        changeFrequency: 'daily',
        priority: 0.5,
      },
    ]
  })
}
