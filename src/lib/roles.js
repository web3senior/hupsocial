/**
 * @file lib/roles.js
 * @description Roles an admin gives a wallet by hand — the Hupster ambassador mark first. Shared by
 * the client and the server: the mark, the /hupsters page, the admin tab and the routes all read
 * the catalogue here, so renaming the program is this file and nothing else. The stored value is
 * the slug, never the label.
 */

export const ROLES = {
  ambassador: {
    label: 'Hupster',
    description: 'Hup ambassador',
  },
}

export const ROLE_IDS = Object.keys(ROLES)

export const isRole = (value) => typeof value === 'string' && Object.hasOwn(ROLES, value)

/**
 * The tag a Hupster puts on the Hup post that links to what they published elsewhere. Posts by
 * Hupsters carrying it make up the /hupsters proof feed, where anyone can check the link and tip.
 */
export const HUPSTER_TAG = 'hupsters'

/** What a Hupster gets. Shown on /hupsters; each is given by the team, not by code. */
export const HUPSTER_PERKS = [
  { id: 'mark', title: 'The Hupster mark', body: 'A megaphone beside your name on every post and on your profile.' },
  { id: 'premium', title: 'Hup Premium, on us', body: 'Complimentary Premium for as long as you are a Hupster.' },
  { id: 'tips', title: 'Tips for your posts', body: 'Your proof posts are listed where the community can check them and tip.' },
]

// Applications carry at most this many proof links, and a note of at most this many characters.
export const APPLICATION_MAX_LINKS = 3
export const APPLICATION_MESSAGE_MAX = 500

// How long a declined applicant waits before the form opens again.
export const REAPPLY_AFTER_DAYS = 14

const ACTION_VERBS = { grant: 'Grant', revoke: 'Revoke', decline: 'Decline' }

export const isRoleAction = (value) => Object.hasOwn(ACTION_VERBS, value)

/**
 * The message the admin signs to grant, revoke or decline, built the same way on the client and
 * the server so the signature recovers to the admin wallet.
 * @param {{ action: 'grant'|'revoke'|'decline', wallet: string, role: string, nonce: string }} params
 * @returns {string}
 */
export const roleMessage = ({ action, wallet, role, nonce }) =>
  `${ACTION_VERBS[action]} a Hup role.\nWallet: ${wallet}\nRole: ${role}\nNonce: ${nonce}`

/**
 * The message an applicant signs, proving the application comes from the wallet it names.
 * @param {{ wallet: string, nonce: string }} params
 * @returns {string}
 */
export const applicationMessage = ({ wallet, nonce }) => `Apply to be a ${ROLES.ambassador.label}.\nWallet: ${wallet}\nNonce: ${nonce}`

/**
 * The proof links an applicant typed, one per line: trimmed, http(s) only, deduplicated, capped.
 * @param {string|string[]} raw
 * @returns {string[]}
 */
export const parseProofLinks = (raw) => {
  const lines = Array.isArray(raw) ? raw : String(raw ?? '').split(/\s+/)
  const links = []
  for (const line of lines) {
    const value = String(line).trim()
    if (!value || value.length > 300) continue
    try {
      const url = new URL(value)
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !links.includes(url.href)) links.push(url.href)
    } catch {
      // Not a URL; dropped rather than stored as text a reviewer would click
    }
    if (links.length === APPLICATION_MAX_LINKS) break
  }
  return links
}
