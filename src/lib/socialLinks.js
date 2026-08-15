/**
 * @file lib/socialLinks.js
 * @description The one website/socials link model the app's branding forms share. Drops store it
 * as LSP4's `links` array (OpenSea reads the same shape from contract-level metadata) and
 * communities store it under the same key in their IPFS metadata JSON, so the build/parse pair
 * lives here rather than in either feature's module.
 */

/** The socials a branding form offers as dedicated fields, in display order. */
export const SOCIAL_LINKS = [
  { key: 'website', title: 'Website', placeholder: 'https://example.com' },
  { key: 'x', title: 'X', placeholder: 'https://x.com/…' },
  { key: 'discord', title: 'Discord', placeholder: 'https://discord.gg/…' },
  { key: 'telegram', title: 'Telegram', placeholder: 'https://t.me/…' },
  { key: 'instagram', title: 'Instagram', placeholder: 'https://instagram.com/…' },
]

const SOCIAL_DOMAINS = {
  x: ['x.com', 'twitter.com'],
  discord: ['discord.gg', 'discord.com'],
  telegram: ['t.me', 'telegram.me'],
  instagram: ['instagram.com'],
}

/** A blank value for the dedicated fields — every form seeds its state from this. */
export const emptySocials = () => Object.fromEntries(SOCIAL_LINKS.map(({ key }) => [key, '']))

/**
 * Folds a branding form's dedicated fields plus free-form extras into the one links array
 * both metadata shapes carry (title + url entries, empty fields dropped).
 */
export const buildLinks = (socials = {}, extra = []) => [
  ...SOCIAL_LINKS.filter(({ key }) => socials[key]?.trim()).map(({ key, title }) => ({ title, url: socials[key].trim() })),
  ...extra.map((row) => ({ title: row.title?.trim() ?? '', url: row.url?.trim() ?? '' })).filter((row) => row.url),
]

/**
 * The inverse: splits a stored links array back into the dedicated social fields (matched by
 * title, then by domain for links other tools wrote) and the free-form remainder.
 */
export const parseLinks = (links = []) => {
  const socials = emptySocials()
  const extra = []

  // Metadata JSON is creator-supplied and may predate this shape entirely — anything that
  // isn't an array parses as "no links" rather than throwing inside the form that seeds from it
  for (const link of Array.isArray(links) ? links : []) {
    if (!link?.url) continue
    const title = String(link.title ?? '').toLowerCase()

    let key = SOCIAL_LINKS.find((social) => social.title.toLowerCase() === title || social.key === title)?.key
    if (title === 'twitter') key = 'x'
    if (!key) {
      let host = ''
      try {
        host = new URL(link.url).hostname.replace(/^www\./, '')
      } catch {
        host = ''
      }
      key = Object.keys(SOCIAL_DOMAINS).find((candidate) => SOCIAL_DOMAINS[candidate].some((domain) => host === domain || host.endsWith(`.${domain}`)))
    }

    if (key && !socials[key]) socials[key] = link.url
    else extra.push({ title: link.title ?? '', url: link.url })
  }

  return { socials, extra }
}

/**
 * Display list for a stored links array: keeps only entries with a usable http(s) url, labels
 * the untitled ones by hostname, and caps the count so a spam-stuffed metadata blob can't
 * overrun the UI it renders into.
 */
export const displayLinks = (links = [], limit = 8) =>
  (Array.isArray(links) ? links : [])
    .map((link) => {
      const url = String(link?.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return null

      let host = ''
      try {
        host = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        return null
      }

      return { title: String(link?.title ?? '').trim() || host, url }
    })
    .filter(Boolean)
    .slice(0, limit)
