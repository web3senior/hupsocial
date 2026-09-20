/**
 * @file lib/username.js
 * @description The one place that knows what a Hup username is. Imported by the claim route, the
 * profile read, the router and the form, so all four agree on what is valid, what is taken and
 * what a handle looks like written down.
 *
 * ASCII only, and starting with a letter: a handle is a global namespace anyone can type from
 * memory, so it can never be confusable with another handle in a different script, and never with
 * a wallet address.
 */

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

const SHAPE = /^[a-z][a-z0-9_]{2,19}$/
const DOUBLE_UNDERSCORE = /__/

/* The floor: every top-level route in src/app — Next matches those before the [wallet]
   catch-all, so a handle among them would be unreachable at its bare path — plus the names nobody
   but Hup should be able to answer to. Kept in code so the browser refuses them as they are typed
   and so they hold before any migration lands. The curated long tail (brands, chains, vernacular)
   lives in the reserved_usernames table, read server-side by lib/reservedUsernames.js. */
const RESERVED = new Set([
  'activity', 'admin', 'api', 'apps', 'articles', 'bazaar', 'chat', 'communities', 'compose',
  'connect', 'drops', 'events', 'fund', 'gas', 'help', 'insights', 'install', 'leaderboard',
  'liked', 'networks', 'nfts', 'notifications', 'offline', 'p2p', 'polls', 'predict', 'premium',
  'privacy_policy', 'profiles', 'register', 'revenue', 'saved', 'screensaver', 'search',
  'secure_account', 'settings', 'share', 'shorts', 'unlock',
  'about', 'auth', 'billing', 'blog', 'contact', 'developer', 'developers', 'docs', 'download',
  'explore', 'faq', 'feed', 'home', 'hup', 'hupsocial', 'legal', 'login', 'logout', 'me',
  'messages', 'moderator', 'official', 'privacy', 'root', 'security', 'signin', 'signup',
  'staff', 'status', 'support', 'system', 'terms', 'trending', 'undefined', 'null', 'user',
  'users', 'verify', 'wallet', 'www',
])

/**
 * The comparable form of a handle: what the UNIQUE index is built on, so two accounts can never
 * hold the same name in different casing whatever collation the database was created with.
 * @param {*} value
 * @returns {string} The folded handle, or '' when there was nothing to fold.
 */
export const usernameKey = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()

/**
 * Whether a handle may be claimed, and why not when it may not.
 * @param {*} value The handle as typed, with or without its leading `@`.
 * @returns {{ok: boolean, key?: string, display?: string, error?: string}}
 */
export const validateUsername = (value) => {
  const display = String(value ?? '').normalize('NFKC').trim().replace(/^@+/, '')
  const key = display.toLowerCase()

  if (!key) return { ok: false, error: 'Pick a username' }
  if (key.length < USERNAME_MIN_LENGTH) return { ok: false, error: `At least ${USERNAME_MIN_LENGTH} characters` }
  if (key.length > USERNAME_MAX_LENGTH) return { ok: false, error: `At most ${USERNAME_MAX_LENGTH} characters` }
  if (!SHAPE.test(key)) return { ok: false, error: 'Letters, numbers and underscores only, starting with a letter' }
  if (key.endsWith('_') || DOUBLE_UNDERSCORE.test(key)) return { ok: false, error: 'Underscores cannot double up or end the name' }
  if (RESERVED.has(key)) return { ok: false, error: 'That name is reserved' }

  return { ok: true, key, display }
}

/** `@alice`, or '' — so a caller can render the result without testing it first. */
export const formatUsername = (value) => {
  const handle = String(value ?? '').trim().replace(/^@+/, '')
  return handle ? `@${handle}` : ''
}

/**
 * Reads a `/[wallet]` route segment as a handle. Only a segment that could actually be one comes
 * back, so an address, a typo or a stray path never costs a database lookup.
 * @param {*} segment The raw route param, `@alice` or `alice`.
 * @returns {{key: string, prefixed: boolean}|null}
 */
export const readHandleSegment = (segment) => {
  const raw = String(segment ?? '').trim()
  if (!raw) return null

  const prefixed = raw.startsWith('@') || raw.startsWith('%40')
  const key = usernameKey(raw.replace(/^%40/i, '@'))

  return validateUsername(key).ok ? { key, prefixed } : null
}

/** The canonical path for a profile: its handle when it has one, its address when it does not. */
export const profilePath = (address, username) => (username ? `/@${username}` : `/${address}`)

/* Placeholder names the app shows for an account that has set none — never a handle suggestion.
   Listed in the folded form the slug below produces, since that is what they are compared against:
   `new-user` reaches the check as `new_user`. */
const PLACEHOLDER_NAMES = new Set(['new_user', 'hup_user', 'unnamed', 'anonymous', 'user'])

/**
 * A handle worth offering someone who has not picked one, from the name they already go by.
 * Returns '' when nothing valid survives, which is the field's own empty state.
 * @param {*} name A display name.
 * @returns {string}
 */
export const suggestUsername = (name) => {
  const candidate = String(name ?? '')
    .normalize('NFKD')
    /* Marks left behind by the decomposition, then everything that is not a handle character. */
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, USERNAME_MAX_LENGTH)
    .replace(/_+$/, '')

  if (PLACEHOLDER_NAMES.has(candidate)) return ''
  return validateUsername(candidate).ok ? candidate : ''
}

/** How long a handle stays locked to its previous owner after they move off it. */
export const USERNAME_RELEASE_LOCK_DAYS = 30

/** How long after claiming a handle before it can be changed again. */
export const USERNAME_CHANGE_COOLDOWN_HOURS = 24

/**
 * The exact string a wallet signs to claim a handle. Built in one place because the browser signs
 * it and the server re-reads it — a character of drift between the two rejects every claim.
 * @param {{username: string, address: string, nonce: string, issuedAt: number}} claim
 * @returns {string}
 */
export const usernameClaimMessage = ({ username, address, nonce, issuedAt }) =>
  [
    'Claim a Hup username',
    '',
    `Username: @${usernameKey(username)}`,
    `Wallet: ${String(address ?? '').toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${issuedAt}`,
  ].join('\n')
