/**
 * @file lib/tokenPage.js
 * @description The shape of a token's author-written landing page, and the one place its fields
 * are cleaned.
 *
 * Keyed on the token's contract address rather than on a Hup launch id, because the address is
 * the only identity a token has off Hup — which is what lets a contract this app never launched
 * have a page here too.
 *
 * Shared by the API that stores them and the form that edits them, so the browser and the server
 * agree on what a valid page is rather than each having an opinion. The server's copy is the one
 * that counts — the form's only job is to say so before a save is wasted.
 *
 * Everything here ends up rendered as text or as an anchor on a public page, so the cleaning is
 * about what a link is allowed to be as much as how long a field can get: a `javascript:` href
 * pasted into a token's website field would run for every visitor.
 */

export const TOKEN_PAGE_TABLE = 'token_pages'

export const TAGLINE_MAX = 160
export const ABOUT_MAX = 2_000
export const LINK_TITLE_MAX = 40
export const LINK_URL_MAX = 255
export const MAX_LINKS = 5

/** Column names, in the order the write statement uses them. */
export const TOKEN_PAGE_FIELDS = [
  'tagline',
  'about',
  'banner_cid',
  'website',
  'x_handle',
  'telegram',
  'discord',
  'farcaster',
  'links',
]

/** A page nobody has written yet — also what an un-migrated database reads as. */
export const emptyTokenPage = () => ({
  tagline: null,
  about: null,
  banner_cid: null,
  website: null,
  x_handle: null,
  telegram: null,
  discord: null,
  farcaster: null,
  links: [],
  updated_at: null,
})

const trimToNull = (value, max) => {
  if (typeof value !== 'string') return null
  // Collapsed at the edges only — a creator's own line breaks inside `about` are theirs to keep
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, max)
}

/**
 * A URL safe to put in an href, or null. Only http(s) survives: every other scheme either does
 * nothing useful in a link or does something the creator's audience did not ask for.
 * @param {*} value
 * @returns {string|null}
 */
export const safeUrl = (value) => {
  const raw = trimToNull(value, LINK_URL_MAX)
  if (!raw) return null

  // A creator types "hup.social", not "https://hup.social" — assume the scheme rather than
  // rejecting the most natural thing to type
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().slice(0, LINK_URL_MAX)
  } catch {
    return null
  }
}

/**
 * A social handle from whatever the creator pasted — the handle itself, an @handle, or the full
 * profile URL they copied out of the address bar.
 * @param {*} value
 * @param {RegExp} pattern What that network allows in a handle.
 * @param {number} max
 * @returns {string|null}
 */
const handleFrom = (value, pattern, max) => {
  const raw = trimToNull(value, LINK_URL_MAX)
  if (!raw) return null

  // Takes the last path segment of a pasted URL, and tolerates a trailing slash or query
  const fromUrl = raw.match(/^(?:https?:\/\/)?(?:[\w.-]+\.)?[\w-]+\.[a-z]{2,}\/([^/?#]+)/i)
  const candidate = (fromUrl ? fromUrl[1] : raw).replace(/^@/, '')

  return pattern.test(candidate) ? candidate.slice(0, max) : null
}

/**
 * The creator's own list of links, cleaned and capped. A row missing either half is dropped
 * rather than half-rendered.
 * @param {*} value An array, or the JSON text a database column holds.
 * @returns {Array<{title: string, url: string}>}
 */
export const sanitizeLinks = (value) => {
  let list = value
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []

  return list
    .map((entry) => ({
      title: trimToNull(entry?.title, LINK_TITLE_MAX),
      url: safeUrl(entry?.url),
    }))
    .filter((entry) => entry.title && entry.url)
    .slice(0, MAX_LINKS)
}

/**
 * Cleans a whole page submission into exactly the fields that get stored.
 * @param {Object} input Whatever the form sent.
 * @returns {Object} The stored shape, with `links` still an array.
 */
export const sanitizeTokenPage = (input = {}) => ({
  tagline: trimToNull(input.tagline, TAGLINE_MAX),
  about: trimToNull(input.about, ABOUT_MAX),
  // A storage reference the uploader produced, not something typed — kept as-is beyond its length
  banner_cid: trimToNull(input.banner_cid, 255),
  website: safeUrl(input.website),
  x_handle: handleFrom(input.x_handle, /^\w{1,15}$/, 64),
  telegram: handleFrom(input.telegram, /^[A-Za-z0-9_+]{3,64}$/, 255),
  // Discord invites are codes, and the code is the only part worth storing
  discord: handleFrom(input.discord, /^[A-Za-z0-9-]{2,64}$/, 255),
  farcaster: handleFrom(input.farcaster, /^[A-Za-z0-9_.-]{1,64}$/, 64),
  links: sanitizeLinks(input.links),
})

/**
 * A stored row as the page reads it. Only the page's own columns — the launch row it was joined
 * onto keeps its own keys.
 * @param {Object|null} row
 * @returns {Object}
 */
export const serializeTokenPage = (row) => {
  if (!row) return emptyTokenPage()

  return {
    tagline: row.tagline ?? null,
    about: row.about ?? null,
    banner_cid: row.banner_cid ?? null,
    website: row.website ?? null,
    x_handle: row.x_handle ?? null,
    telegram: row.telegram ?? null,
    discord: row.discord ?? null,
    farcaster: row.farcaster ?? null,
    links: sanitizeLinks(row.links),
    updated_at: row.page_updated_at ?? row.updated_at ?? null,
  }
}

/** Where each social handle actually points. One definition, so the form and the page never disagree. */
export const SOCIAL_URLS = {
  x_handle: (handle) => `https://x.com/${handle}`,
  telegram: (handle) => `https://t.me/${handle}`,
  discord: (code) => `https://discord.gg/${code}`,
  farcaster: (handle) => `https://farcaster.xyz/${handle}`,
}

/**
 * What a creator signs to authorise a page edit. Defined here so the wallet's prompt and the
 * server's check are built from one string — a mismatch between them reads as a forged signature.
 */
export const TOKEN_PAGE_EDIT_ACTION = 'Update this token page on Hup'

/** The launch a page-edit signature is good for, and only that launch. */
export const tokenPageEditSubject = (networkId, tokenAddress) => `Token ${networkId}/${String(tokenAddress).toLowerCase()}`

/** Whether a page has anything on it at all — what tells the token page to show a prompt instead. */
export const isTokenPageEmpty = (page) =>
  !page ||
  (!page.tagline &&
    !page.about &&
    !page.banner_cid &&
    !page.website &&
    !page.x_handle &&
    !page.telegram &&
    !page.discord &&
    !page.farcaster &&
    (page.links?.length ?? 0) === 0)
