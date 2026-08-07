/**
 * @file api/v1/users/search/route.js
 * @description People search behind every recipient field in the app — the one place that knows
 * where a wallet address can be found by name.
 *
 * Four sources answer at once, because no single one knows everybody:
 *   - `follows` — who the viewer already follows, which is who they almost always mean
 *   - the `users` table — every wallet Hup has seen, including UP names cached by profileHelper
 *   - the LUKSO Envio index — Universal Profiles Hup has never seen, searched by name
 *   - ENS — the only name→address resolver that isn't a search at all, it either hits or it doesn't
 *
 * A pasted address short-circuits all of it: the answer is already known, so the only work left is
 * putting a face on it so the sender can see who they're about to pay.
 *
 * Every source is allowed to fail. A dead upstream degrades the list, never the request — callers
 * keep a plain address field as the floor.
 */

import { NextResponse } from 'next/server'
import { getAddress } from 'viem'
import { normalize } from 'viem/ens'
import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { fulfillUniversalProfiles } from '@/lib/profileHelper'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const MIN_QUERY_LENGTH = 2
const AVATAR_WIDTH = 96

// ENS lives on Ethereum mainnet and nowhere else — a `.eth` name means the same wallet whichever
// chain the transfer ends up on, so resolution is chain-independent from the caller's point of view
const ENS_CHAIN_ID = 1

// Upstreams get a short leash: a recipient list that arrives after the user has finished typing
// the address by hand is worse than a shorter list that arrives while they're still reading
const UPSTREAM_TIMEOUT_MS = 3500

// Ordering between sources. Lower wins, and the first source to claim an address sets its label.
const SOURCE_RANK = { address: 0, ens: 1, following: 2, hup: 3, lukso: 4 }

/** Resolves to null instead of hanging or throwing, whatever the upstream does. */
const settle = async (promise) => {
  try {
    return await promise
  } catch {
    return null
  }
}

const withTimeout = (promise, ms = UPSTREAM_TIMEOUT_MS) =>
  settle(Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]))

const checksum = (value) => {
  try {
    return getAddress(String(value).toLowerCase())
  } catch {
    return null
  }
}

const avatarUrl = (src) => resolveStorageImageUrl(src, { width: AVATAR_WIDTH })

// A UP name is whatever its owner wrote in its metadata, so it is never proof of identity — the
// picker always shows the address next to it, which is why every entry carries one.
const entry = ({ address, name, avatar, source, ensName = null, followerCount = null }) => {
  const checksummed = checksum(address)
  if (!checksummed) return null

  const trimmedName = typeof name === 'string' ? name.trim() : ''

  return {
    address: checksummed,
    name: trimmedName || null,
    avatar: avatar || null,
    source,
    ensName: ensName || null,
    followerCount: Number.isFinite(followerCount) ? followerCount : null,
  }
}

// ---------------------------------------------------------------------------
// ENS
// ---------------------------------------------------------------------------

/** Forward-resolves a name to an address, or null when it isn't a name / doesn't resolve. */
async function resolveEnsName(query) {
  if (!query.includes('.')) return null

  const client = getServerPublicClient(ENS_CHAIN_ID)
  if (!client) return null

  let normalized = null
  try {
    normalized = normalize(query)
  } catch {
    // Not a well-formed ENS label — nothing to resolve
    return null
  }

  const address = await withTimeout(client.getEnsAddress({ name: normalized }))
  return address ? { address, ensName: normalized } : null
}

/** Reverse-resolves an address to its primary ENS name, so a pasted address can still show one. */
const lookupEnsName = (address) => {
  const client = getServerPublicClient(ENS_CHAIN_ID)
  if (!client) return Promise.resolve(null)

  return withTimeout(client.getEnsName({ address }))
}

// ---------------------------------------------------------------------------
// LUKSO Envio
// ---------------------------------------------------------------------------

const PROFILE_FIELDS = `
  id
  name
  fullName
  profileImages { src }
  followed_aggregate { aggregate { count } }
`

async function queryEnvio(query, variables) {
  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) return null

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!response.ok) return null

  return response.json()
}

const mapProfile = (profile, source) =>
  entry({
    address: profile?.id,
    name: profile?.name || profile?.fullName,
    avatar: avatarUrl(profile?.profileImages?.[0]?.src),
    source,
    followerCount: profile?.followed_aggregate?.aggregate?.count ?? null,
  })

/**
 * Universal Profiles whose name matches, most-followed first. Ordering by an aggregate is the same
 * trick the LSP7 search uses, but it is the one part of this query the index could refuse — so a
 * rejected order_by retries unordered rather than losing the whole source.
 */
async function searchLuksoProfiles(query, limit) {
  const variables = { q: `%${query}%`, limit }
  const where = `where: {_or: [{name: {_ilike: $q}}, {fullName: {_ilike: $q}}]}`

  const ordered = await settle(
    queryEnvio(
      `query SearchProfiles($q: String!, $limit: Int!) {
        Profile(${where} limit: $limit order_by: {followed_aggregate: {count: desc}}) {${PROFILE_FIELDS}}
      }`,
      variables,
    ),
  )

  const body =
    ordered?.data?.Profile && !ordered?.errors
      ? ordered
      : await settle(
          queryEnvio(
            `query SearchProfiles($q: String!, $limit: Int!) {
              Profile(${where} limit: $limit) {${PROFILE_FIELDS}}
            }`,
            variables,
          ),
        )

  return (body?.data?.Profile || [])
    .map((profile) => mapProfile(profile, 'lukso'))
    .filter(Boolean)
    .sort((a, b) => (b.followerCount ?? 0) - (a.followerCount ?? 0))
}

/** One profile by address — the face for a pasted address that Hup itself has never seen. */
async function fetchLuksoProfile(address) {
  const body = await settle(
    queryEnvio(
      `query ProfileById($id: String!) {
        Profile(where: {id: {_eq: $id}}) {${PROFILE_FIELDS}}
      }`,
      { id: address.toLowerCase() },
    ),
  )

  const profile = body?.data?.Profile?.[0]
  return profile ? mapProfile(profile, 'lukso') : null
}

// ---------------------------------------------------------------------------
// Hup database
// ---------------------------------------------------------------------------

const USER_COLUMNS = `u.wallet_address, u.name AS display_name, u.profileImage AS profile_image`

/**
 * Wallets Hup knows, matched on display name or address.
 *
 * Names match as a substring but addresses only as a prefix: a bare hex fragment matches half the
 * table, while the first characters of an address are exactly how someone half-pastes one. An
 * empty `name` is profileHelper's negative cache for "checked, has no profile", not a real name.
 */
async function searchDbUsers(query, limit) {
  const [rows] = await pool.execute(
    `SELECT ${USER_COLUMNS}
       FROM users u
      WHERE (u.name IS NOT NULL AND u.name <> '' AND u.name LIKE ?)
         OR u.wallet_address LIKE ?
      ORDER BY (u.name = ?) DESC, (u.name LIKE ?) DESC, CHAR_LENGTH(COALESCE(u.name, '')) ASC, u.last_seen_at DESC
      LIMIT ?`,
    [`%${query}%`, `${query.toLowerCase()}%`, query, `${query}%`, limit],
  )

  return rows
}

/** Names and avatars for a known set of addresses, keyed lowercase. */
async function fetchDbUsers(addresses) {
  if (addresses.length === 0) return new Map()

  const placeholders = addresses.map(() => '?').join(',')
  const [rows] = await pool.execute(
    `SELECT ${USER_COLUMNS} FROM users u WHERE u.wallet_address IN (${placeholders})`,
    addresses.map((address) => address.toLowerCase()),
  )

  return new Map(rows.map((row) => [String(row.wallet_address).toLowerCase(), row]))
}

/**
 * Which of `addresses` the viewer follows. Bound as parameters rather than joined against `users`
 * — the two tables disagree on collation (see the leaderboard route), and a column-to-column
 * compare across them is the thing that trips over it.
 */
async function filterFollowed(viewer, addresses) {
  if (!viewer || addresses.length === 0) return new Set()

  const placeholders = addresses.map(() => '?').join(',')
  const [rows] = await pool.execute(
    `SELECT DISTINCT followed_address FROM follows
      WHERE follower_address = ? AND is_following = 1 AND followed_address IN (${placeholders})`,
    [viewer.toLowerCase(), ...addresses.map((address) => address.toLowerCase())],
  )

  return new Set(rows.map((row) => String(row.followed_address).toLowerCase()))
}

/** Most recently followed accounts — what an empty field offers the moment it is focused. */
async function recentlyFollowed(viewer, limit) {
  const [rows] = await pool.execute(
    `SELECT followed_address, MAX(updated_at) AS followed_at
       FROM follows
      WHERE follower_address = ? AND is_following = 1
      GROUP BY followed_address
      ORDER BY followed_at DESC
      LIMIT ?`,
    [viewer.toLowerCase(), limit],
  )

  return rows.map((row) => String(row.followed_address))
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Merges the sources into one ranked list. The first source to claim an address decides its label
 * and keeps its own name; later sources only fill blanks, so a Hup display name is never
 * overwritten by the UP metadata it was cached from.
 */
function merge(groups) {
  const byAddress = new Map()

  for (const group of groups) {
    for (const item of group) {
      if (!item) continue
      const key = item.address.toLowerCase()
      const existing = byAddress.get(key)
      if (!existing) {
        byAddress.set(key, { ...item })
        continue
      }
      existing.name = existing.name || item.name
      existing.avatar = existing.avatar || item.avatar
      existing.ensName = existing.ensName || item.ensName
      existing.followerCount = existing.followerCount ?? item.followerCount
      if (SOURCE_RANK[item.source] < SOURCE_RANK[existing.source]) existing.source = item.source
    }
  }

  return byRank([...byAddress.values()])
}

const byRank = (entries) =>
  entries.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || (b.followerCount ?? 0) - (a.followerCount ?? 0))

/**
 * Fills nameless entries from their Universal Profile, in place. The helper does the upstream
 * batch and caches what it finds back into `users`, so a wallet only ever costs that round trip
 * once — the same warm-up the NFT sellers list relies on.
 */
async function fillMissingProfiles(entries) {
  const rows = entries.map((item) => ({
    wallet_address: item.address,
    display_name: item.name,
    profile_image: item.avatar,
  }))

  await settle(fulfillUniversalProfiles(rows, pool))

  rows.forEach((row, index) => {
    entries[index].name = entries[index].name || row.display_name || null
    entries[index].avatar = entries[index].avatar || avatarUrl(row.profile_image)
  })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || '').trim()
    const viewer = checksum(searchParams.get('viewer') || '')
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit'), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)

    // A pasted address is already the answer — the only question left is whose it is
    if (ADDRESS_PATTERN.test(query)) {
      const address = checksum(query)
      const [dbRows, upProfile, ensName] = await Promise.all([
        settle(fetchDbUsers([address])),
        fetchLuksoProfile(address),
        lookupEnsName(address),
      ])

      const row = dbRows?.get(address.toLowerCase())
      const resolved = entry({
        address,
        name: row?.display_name || upProfile?.name || ensName,
        avatar: avatarUrl(row?.profile_image) || upProfile?.avatar,
        source: 'address',
        ensName,
        followerCount: upProfile?.followerCount ?? null,
      })

      return NextResponse.json({ success: true, data: [resolved].filter(Boolean) })
    }

    // An untouched field offers the people the viewer follows rather than sitting empty
    if (query.length < MIN_QUERY_LENGTH) {
      if (!viewer) return NextResponse.json({ success: true, data: [] })

      const addresses = await recentlyFollowed(viewer, limit)
      const rows = await fetchDbUsers(addresses)
      const data = addresses
        .map((address) => {
          const row = rows.get(address.toLowerCase())
          return entry({ address, name: row?.display_name, avatar: avatarUrl(row?.profile_image), source: 'following' })
        })
        .filter(Boolean)

      await fillMissingProfiles(data)
      return NextResponse.json({ success: true, data })
    }

    const [ens, dbRows, luksoProfiles] = await Promise.all([
      resolveEnsName(query),
      settle(searchDbUsers(query, limit)),
      settle(searchLuksoProfiles(query, limit)),
    ])

    // The ENS hit gets the same identity treatment a pasted address does — a name that resolves is
    // only half an answer if the sender can't tell whose wallet it landed on
    const ensRow = ens ? (await settle(fetchDbUsers([ens.address])))?.get(ens.address.toLowerCase()) : null
    const ensEntry = ens
      ? entry({
          address: ens.address,
          name: ensRow?.display_name || ens.ensName,
          avatar: avatarUrl(ensRow?.profile_image),
          source: 'ens',
          ensName: ens.ensName,
        })
      : null

    const dbEntries = (dbRows || [])
      .map((row) =>
        entry({
          address: row.wallet_address,
          name: row.display_name,
          avatar: avatarUrl(row.profile_image),
          source: 'hup',
        }),
      )
      .filter(Boolean)

    const merged = merge([[ensEntry].filter(Boolean), dbEntries, luksoProfiles || []])

    // Following is a property of who the viewer is, not of where the row came from, so it is
    // applied after the merge — a UP found by name still floats up if the viewer follows it
    const followed = await settle(
      filterFollowed(
        viewer,
        merged.map((item) => item.address),
      ),
    )
    if (followed?.size) {
      for (const item of merged) {
        if (followed.has(item.address.toLowerCase()) && SOURCE_RANK.following < SOURCE_RANK[item.source]) {
          item.source = 'following'
        }
      }
      byRank(merged)
    }

    const data = merged.slice(0, limit)
    await fillMissingProfiles(data)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[USER_SEARCH_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
