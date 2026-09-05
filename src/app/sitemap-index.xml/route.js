import { countListableProfiles, sitemapChunkCount } from '@/lib/profileSitemap'

/**
 * The sitemap index: one file a crawler can start from that reaches every sitemap we publish.
 *
 * Next generates the profile chunks but no index over them, and the number of chunks moves with
 * the user table, so robots.txt cannot list them by hand. This route enumerates them live.
 */

export const revalidate = 3600

export async function GET() {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/$/, '')
  const total = await countListableProfiles()
  const chunks = Array.from({ length: sitemapChunkCount(total) }, (_, id) => id)

  const locations = [
    `${baseUrl}/sitemap.xml`,
    ...chunks.map((id) => `${baseUrl}/profiles/sitemap/${id}.xml`),
  ]

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
