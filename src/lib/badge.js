/**
 * @file lib/badge.js
 * @description The badge worn beside a name — Hup's answer to a Discord server tag: a short code
 * lent by a community the wallet actually belongs to.
 *
 * A badge is a claim about membership, so none of it is trusted from the `users` row alone. That
 * row stores a POINTER only — which community this wallet chose to wear — and every read re-joins
 * `community_members` to confirm the wallet is still a member and still not banned. Resolving at
 * read time rather than stamping the tag onto the user when they pick it is the whole design: a
 * denormalized copy would leave someone wearing a community's colours long after leaving it.
 *
 * The join is pinned to the HupCommunity deployment this build talks to, exactly as every post
 * query is (lib/communityJoin.js): a community id only identifies a community within one
 * deployment, and a pointer written against a retired one must not resolve.
 *
 * Addresses compare through LOWER() on both sides, the same way the feed's membership check does
 * — cidex writes checksummed addresses into `community_members` while the app writes lowercase
 * ones into `users`. That costs the wallet index on the picker query, which is why the picker is
 * an on-demand read (opening the edit modal), never part of a render path.
 */

import pool from '@/lib/db'
import { communityJoinPin } from '@/lib/communityJoin'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

// The pill renders the logo at 10px; ask for more so it stays sharp on dense screens.
const LOGO_WIDTH = 48

// No realistic wallet joins more communities than a picker can show, and the cap keeps a
// pathological membership list from turning the modal into a scroll marathon.
const MAX_WEARABLE = 50

// The community columns a badge is made of, aliased once so both queries below agree.
const BADGE_COLUMNS = `
    c.network_id AS network_id,
    c.contract_address AS contract_address,
    c.id AS community_id,
    c.tag AS tag,
    c.name AS community_name,
    c.logo_url AS logo_url`

// A community only lends its tag while it is live and actually publishes one.
const GRANTS_A_TAG = `c.is_active = 1 AND c.tag IS NOT NULL AND c.tag <> ''`

/** The wire shape, in one place, so the pill, the picker and the setter can never disagree. */
function toBadge(row) {
  if (!row) return null

  return {
    tag: row.tag,
    communityId: Number(row.community_id),
    communityName: row.community_name,
    networkId: Number(row.network_id),
    contractAddress: String(row.contract_address).toLowerCase(),
    logoUrl: resolveStorageImageUrl(row.logo_url, { width: LOGO_WIDTH, still: true }) || null,
  }
}

/**
 * The badge a wallet is entitled to wear right now, or null. Membership is re-checked here on
 * every call — leaving or being banned takes the badge away on the next read, with no write.
 * @param {string} walletAddress
 * @returns {Promise<object|null>}
 */
export async function resolveWornBadge(walletAddress) {
  if (!walletAddress) return null

  const [rows] = await pool.execute(
    `SELECT ${BADGE_COLUMNS}
     FROM users u
     JOIN communities c
       ON c.network_id = u.badge_network_id
      AND c.contract_address = u.badge_contract_address
      AND c.id = u.badge_community_id
      ${communityJoinPin('c')}
     JOIN community_members m
       ON m.network_id = c.network_id
      AND m.contract_address = c.contract_address
      AND m.community_id = c.id
      AND LOWER(m.wallet_address) = LOWER(?)
     WHERE LOWER(u.wallet_address) = LOWER(?)
       AND u.badge_community_id IS NOT NULL
       AND ${GRANTS_A_TAG}
       AND m.is_member = 1
       AND m.is_banned = 0
     LIMIT 1`,
    [walletAddress, walletAddress],
  )

  return toBadge(rows[0])
}

/**
 * Every badge this wallet could wear — the picker's list, and the same rule the setter validates
 * against, so "what you were offered" and "what you are allowed" are one definition.
 * @param {string} walletAddress
 * @returns {Promise<object[]>}
 */
export async function listWearableBadges(walletAddress) {
  if (!walletAddress) return []

  const [rows] = await pool.execute(
    `SELECT ${BADGE_COLUMNS}
     FROM community_members m
     JOIN communities c
       ON c.network_id = m.network_id
      AND c.contract_address = m.contract_address
      AND c.id = m.community_id
      ${communityJoinPin('c')}
     WHERE LOWER(m.wallet_address) = LOWER(?)
       AND m.is_member = 1
       AND m.is_banned = 0
       AND ${GRANTS_A_TAG}
     ORDER BY c.name ASC, c.id ASC
     LIMIT ?`,
    [walletAddress, MAX_WEARABLE],
  )

  return rows.map(toBadge)
}

/**
 * Reads the `badge` field of a profile update. The outcomes are deliberately distinct: an absent
 * field must not disturb a badge the user already wears, while an empty one is an explicit
 * "wear nothing".
 * @param {FormDataEntryValue|null} raw
 * @returns {{action: 'absent'|'clear'|'invalid'|'set', selection?: object}}
 */
export function parseBadgeSelection(raw) {
  if (raw === null || raw === undefined) return { action: 'absent' }

  const value = String(raw).trim()
  if (value === '' || value === 'null') return { action: 'clear' }

  try {
    const parsed = JSON.parse(value)
    const networkId = Number(parsed?.networkId)
    const communityId = Number(parsed?.communityId)
    const contractAddress = String(parsed?.contractAddress ?? '').toLowerCase()

    if (!Number.isInteger(networkId) || !Number.isInteger(communityId) || communityId < 0) return { action: 'invalid' }
    if (!/^0x[0-9a-f]{40}$/.test(contractAddress)) return { action: 'invalid' }

    return { action: 'set', selection: { networkId, contractAddress, communityId } }
  } catch {
    return { action: 'invalid' }
  }
}

/**
 * The chosen community, but only if the wallet may actually wear it. Set-time validation is a
 * courtesy — it answers the picker with a real error instead of a badge that silently never
 * renders — and never the thing standing between a stranger and someone else's colours; that is
 * resolveWornBadge, on every read.
 * @param {string} walletAddress
 * @param {{networkId: number, contractAddress: string, communityId: number}} selection
 * @returns {Promise<object|null>}
 */
export async function findWearableBadge(walletAddress, selection) {
  const wearable = await listWearableBadges(walletAddress)

  return (
    wearable.find(
      (badge) =>
        badge.networkId === selection.networkId &&
        badge.communityId === selection.communityId &&
        badge.contractAddress === selection.contractAddress,
    ) ?? null
  )
}
