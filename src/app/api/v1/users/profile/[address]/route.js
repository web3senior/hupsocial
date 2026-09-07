import { after, NextResponse } from 'next/server'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import pool from '@/lib/db'
import { AVATAR_MAX_SIZE, resolveAvatarImageUrl, resolveStorageImageUrl } from '@/lib/storageHelper'
import { queryUniversalProfile } from '@/lib/lukso'
import { resolveWornBadge, parseBadgeSelection, findWearableBadge } from '@/lib/badge'
import { resolveAgentProfile } from '@/lib/agentProfile'
import { describeOrigin, isCountryCode, normalizeOriginCode, parseOriginSelection } from '@/lib/origin'
import { hasColumn } from '@/lib/schema'

/** Stored JSON list columns come back as text; the indexer's own fields are already arrays. */
function parseJsonList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * The origin a profile shows, resolved to something renderable. An onchain origin needs nothing
 * but the build's own list; a country needs its name, and that is a second small query rather
 * than a join on the profile read below. That read is a bare `SELECT u.*`, which keeps working
 * against a database predating the origin column — welding a join onto it is exactly what 500'd
 * every profile in the app, and every avatar with it, when the badge columns went in. A failed
 * lookup here costs the country's name, never the profile.
 */
async function resolveOrigin(code) {
  const normalized = normalizeOriginCode(code)
  if (!normalized) return null
  if (!isCountryCode(normalized)) return describeOrigin(normalized)

  try {
    const [rows] = await pool.execute('SELECT name FROM countries WHERE iso_code = ? LIMIT 1', [normalized])
    return describeOrigin(normalized, rows[0]?.name)
  } catch (error) {
    console.error('[ORIGIN_RESOLVE_ERROR]:', error.message)
    /* The flag and the code alone still say where someone is from. */
    return describeOrigin(normalized)
  }
}

/* One width for every cover on the site, for the same reason the avatar ladder has rungs: the
   sharp proxy keys its cache and the CDN its object on the exact width, so a shared one is warm
   for everybody after the first visitor. A cover is laid out full-bleed across the profile card,
   which tops out around 600 CSS px — 1200 is that at 2x, and the proxy never enlarges past the
   original. */
const PROFILE_COVER_WIDTH = 1200

/* "This profile has no cover, and means it" — as opposed to never having set one here.
   Deliberately not the empty string: an older form already wrote empties into this column, and
   reading one of those as a removal would hide a Universal Profile's real cover from its own
   page. A ref is always an `ipfs://` URI, so a bare word can never collide with one. */
const COVER_REMOVED = 'removed'

/**
 * The three states `users.profileHeader` can hold, told apart in one place:
 * `ref` is the picture, `removed` is the user having taken it down, and `set` is the two of them
 * together — everything else, legacy empties included, is "never set here".
 */
const readStoredCover = (value) => ({
  ref: value && value !== COVER_REMOVED ? value : null,
  removed: value === COVER_REMOVED,
  set: Boolean(value),
})

/** A stored cover reference as something an <img> can use. */
const resolveCoverUrl = (src) => (src ? resolveStorageImageUrl(src, { width: PROFILE_COVER_WIDTH }) : null)

/* Both columns land together in cidex/scripts/add-profile-index-cache.sql, so probing one probes both. */
const CACHE_COLUMN = 'is_universal_profile'

/* How old a row's indexer answer may be before it is asked again, behind the response. A wallet
   the indexer had nothing for can only become a Universal Profile by being deployed, so it waits longer. */
const UP_RECHECK_MS = 10 * 60_000
const EOA_RECHECK_MS = 60 * 60_000

const checkedAt = new Map()

const isUniversalProfile = (profile) => Boolean(profile && (profile.name || profile.fullName))

/** The row's copy of the indexer document, in the indexer's own shape. */
const indexedFromRow = (row) => {
  const cover = readStoredCover(row.profileHeader).ref
  return {
    id: row.wallet_address,
    name: row.name,
    description: row.description,
    tags: parseJsonList(row.tags),
    links: parseJsonList(row.links),
    lastMetadataUpdate: row.profile_indexed_stamp,
    profileImages: row.profileImage ? [{ src: row.profileImage }] : [],
    backgroundImages: cover ? [{ src: cover }] : [],
  }
}

/**
 * Remembers the indexer's answer on the row. The Hup-first rule is applied by the statement
 * itself — a row whose sync stamp still equals the indexer's keeps its own copy — so an edit
 * saved while the indexer was answering is never overwritten. Never inserts: an unknown address
 * must not become a user by being read.
 * @param {string} address
 * @param {object|null} profile The indexer document, or null when it has no profile for the wallet.
 */
async function cacheIndexerAnswer(address, profile) {
  if (!profile) {
    await pool.execute('UPDATE users SET is_universal_profile = 0, profile_indexed_stamp = NULL WHERE wallet_address = ?', [address])
    return
  }

  const stamp = String(profile.lastMetadataUpdate ?? '')
  const keep = 'profile_sync_stamp <=> ?'
  const copy = [
    profile.name || profile.fullName || '',
    profile.description ?? null,
    profile.profileImages?.[0]?.src ?? null,
    profile.backgroundImages?.[0]?.src ?? null,
    JSON.stringify(profile.tags ?? []),
    JSON.stringify(profile.links ?? []),
  ]

  await pool.execute(
    `UPDATE users SET
      is_universal_profile = 1,
      profile_indexed_stamp = ?,
      name = IF(${keep}, name, ?),
      description = IF(${keep}, description, ?),
      profileImage = IF(${keep}, profileImage, ?),
      profileHeader = IF(${keep}, profileHeader, ?),
      tags = IF(${keep}, tags, ?),
      links = IF(${keep}, links, ?),
      profile_sync_stamp = IF(${keep}, profile_sync_stamp, NULL)
    WHERE wallet_address = ?`,
    [stamp, ...copy.flatMap((value) => [stamp, value]), stamp, address],
  )
}

/** Without the cache columns, the one write the read has always done: drop a sync stamp the chain has moved past. */
async function dropOvertakenSyncStamp(address, storedStamp, profile) {
  if (storedStamp === null || storedStamp === String(profile.lastMetadataUpdate ?? '')) return
  await pool.execute('UPDATE users SET profile_sync_stamp = NULL WHERE wallet_address = ?', [address])
}

const logCacheError = (error) => console.error('[PROFILE_INDEX_CACHE_ERROR]:', error.message)

/** Asks the indexer again behind the response once the row's answer is old enough. */
function scheduleIndexerRecheck(address, row) {
  const key = address.toLowerCase()
  const maxAge = row.is_universal_profile ? UP_RECHECK_MS : EOA_RECHECK_MS
  if (Date.now() - (checkedAt.get(key) ?? 0) < maxAge) return
  checkedAt.set(key, Date.now())

  after(async () => {
    try {
      const upData = await queryUniversalProfile(address)
      if (!Array.isArray(upData?.data?.Profile)) return
      const live = upData.data.Profile[0]
      await cacheIndexerAnswer(address, isUniversalProfile(live) ? live : null)
    } catch (error) {
      logCacheError(error)
    }
  })
}

/**
 * A Universal Profile as the read serves it, from the indexer document — live, or the row's copy
 * of it. The row can be AHEAD of that document: see cidex/scripts/add-profile-sync-stamp.sql.
 */
function shapeUniversalProfile(profile, row, address, { badge, origin }) {
  const liveStamp = String(profile.lastMetadataUpdate ?? '')
  const storedStamp = row?.profile_sync_stamp ?? null
  const hupIsAhead = storedStamp !== null && storedStamp === liveStamp
  const storedCover = readStoredCover(row?.profileHeader)

  if (hupIsAhead) {
    profile.name = row.name
    profile.description = row.description
    profile.tags = parseJsonList(row.tags)
    profile.links = parseJsonList(row.links)
    /* fullName is the indexer's own "name#tag" rendering of the name that was just replaced.
       Dropping it lets a byline rebuild one from the name above instead of showing the old
       one — see the displayName memo in components/Profile.jsx. */
    profile.fullName = null
    /* The stored reference rather than the resolved URL: a retry has to put this picture back
       into an LSP3 document, and a proxy URL cannot be turned back into a CID. */
    profile.profileImageRef = row.profileImage || null
    profile.profileHeaderRef = storedCover.ref
    profile.coverRemoved = storedCover.removed
    /* What the editor offers a Sync button for. */
    profile.syncPending = true
  }

  profile.profileImage = hupIsAhead
    ? resolveAvatarImageUrl(row.profileImage, AVATAR_MAX_SIZE)
    : profile.profileImages && profile.profileImages.length > 0
      ? resolveAvatarImageUrl(profile.profileImages[0].src, AVATAR_MAX_SIZE)
      : null

  /* The LSP3 backgroundImage, which the indexer serves as `backgroundImages`.
     Unlike the avatar above, a Hup row that is ahead does NOT simply win here: most rows
     have never held a cover, and reading that as "no cover" would blank a real one off the
     profile for as long as an edit sat unsigned. Only a row that has actually set the cover
     one way or the other — a picture, or a removal — speaks for it. */
  const indexedCover = profile.backgroundImages?.[0]?.src ?? null
  profile.profileHeader = resolveCoverUrl(hupIsAhead && storedCover.set ? storedCover.ref : indexedCover)

  profile.wallet_address = normalizeAddress(address)

  // Birthday is a Hup-native field with no UP metadata equivalent — always
  // sourced from our own users row, even when the profile itself is a UP.
  profile.birthday = row?.birthday ?? null
  // Same for the community badge: a UP describes a person, not their Hup memberships.
  profile.badge = badge
  profile.origin = origin
  /* Read from the profile's OWN tags and description, so the mark travels with the metadata
     rather than with anything Hup remembers about the account — see lib/agentProfile.js. */
  profile.agent = resolveAgentProfile(profile)

  return profile
}

/** A profile the indexer has nothing for, from the row alone. */
function shapeDatabaseProfile(row, { badge, origin }) {
  const dbProfile = row

  // The notification email is private contact data on a public endpoint —
  // never let SELECT u.* leak it now that the column is actually populated.
  delete dbProfile.email
  delete dbProfile.email_verified_at
  delete dbProfile.email_notifications

  /* Resolve profile image from any protocol (IPFS, UP cloud, http, etc.) */
  dbProfile.profileImage = resolveAvatarImageUrl(dbProfile.profileImage, AVATAR_MAX_SIZE)
  dbProfile.profileHeader = resolveCoverUrl(readStoredCover(dbProfile.profileHeader).ref)

  /* Only meaningful beside a Universal Profile, which this branch by definition is not. */
  delete dbProfile.profile_sync_stamp
  delete dbProfile.is_universal_profile
  delete dbProfile.profile_indexed_stamp

  /* The raw pointer columns say nothing a client can render, and a stale one must never be
     mistaken for a badge — only the verified resolution above is exposed. */
  delete dbProfile.badge_network_id
  delete dbProfile.badge_contract_address
  delete dbProfile.badge_community_id
  dbProfile.badge = badge

  /* The raw code says nothing a client can render — no flag, no name — so only the resolved
     form is exposed, exactly as the badge is. */
  delete dbProfile.origin_code
  dbProfile.origin = origin

  /* Same mark, same rule, off the cached copy of the same two fields — the resolver takes the
     JSON-string form of `tags` this branch carries as readily as the array the branch above has. */
  dbProfile.agent = resolveAgentProfile(dbProfile)

  return dbProfile
}

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    /* Leaderboard rank/score are intentionally NOT part of this response — computing
       them is far heavier than a profile read, and their only consumer (the OG share
       card) queries /api/v1/leaderboard itself. */

    /* The row first, on its own: a primary-key read on the local database that already holds
       everything the header, the byline and the page show once the indexer has been asked
       about this wallet once. */
    /* The badge joins from the users row itself, so it needs nothing from the read beside it
       and adds no latency running in the same batch. It is re-verified against
       community_members on every call — see lib/badge.js for why it is never stored already
       resolved. */
    const [[rows], badge] = await Promise.all([
      pool.execute(
        `SELECT
          u.*,
          (SELECT COUNT(*) FROM posts p WHERE p.wallet_address = u.wallet_address) as total_posts
        FROM users u
        WHERE u.wallet_address = ?`,
        [address],
      ),
      /* A badge is decoration on a profile, never a precondition for one. Left unguarded it
         shares this Promise.all's fate: one failed join — a schema not yet migrated, a
         communities table mid-rebuild — rejects the batch and 500s every profile read in the
         app, taking every avatar with it. Degrade to no badge instead. */
      resolveWornBadge(address).catch((badgeError) => {
        console.error('[BADGE_RESOLVE_ERROR]:', badgeError.message)
        return null
      }),
    ])
    const row = rows[0]

    /* Hup-native, like birthday: a Universal Profile describes a person, not where they told
       Hup they are from, so both branches below take this from our own users row. Sequential
       rather than part of the batch above because it reads that row's value; it costs one
       indexed lookup, and only for profiles that actually publish a country. */
    const origin = await resolveOrigin(row?.origin_code)

    /* The indexer is asked on the response path only when the row cannot answer for it: the
       row has never recorded what the indexer said, or the columns that record it are not
       migrated in yet (then this read behaves exactly as it did before them). */
    const cacheable = await hasColumn('users', CACHE_COLUMN)

    if (cacheable && row && row.is_universal_profile !== null) {
      scheduleIndexerRecheck(address, row)

      if (row.is_universal_profile) {
        return NextResponse.json({
          source: 'universal_profile',
          data: shapeUniversalProfile(indexedFromRow(row), row, address, { badge, origin }),
        })
      }

      return NextResponse.json({ source: 'database', data: shapeDatabaseProfile(row, { badge, origin }) })
    }

    const upData = await queryUniversalProfile(address)
    const answered = Array.isArray(upData?.data?.Profile)
    const live = answered ? upData.data.Profile[0] : null
    const isUP = isUniversalProfile(live)

    /* A failed lookup (timeout, upstream down) remembers nothing, so the next read asks again. */
    if (row && answered) {
      const storedStamp = row.profile_sync_stamp ?? null
      checkedAt.set(address.toLowerCase(), Date.now())
      after(() => {
        const write = cacheable ? cacheIndexerAnswer(address, isUP ? live : null) : isUP ? dropOvertakenSyncStamp(address, storedStamp, live) : Promise.resolve()
        return write.catch(logCacheError)
      })
    }

    if (isUP) {
      return NextResponse.json({
        source: 'universal_profile',
        data: shapeUniversalProfile(live, row, address, { badge, origin }),
      })
    }

    /* Fallback to Database if the UP endpoint fails or returns no profile */

    if (!row) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json({ source: 'database', data: shapeDatabaseProfile(row, { badge, origin }) })
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/* Columns a save can touch that the database it is running against may not have yet: production
   is migrated by hand, so every one of these lands here days before it lands there. Naming a
   missing column rejects the whole statement, which is how a marker nobody asked for takes the
   name and description someone did type down with it — the field is dropped from the update
   instead, and starts being written by itself once the migration runs (see lib/schema.js). */
const OPTIONAL_COLUMNS = {
  badge_network_id: 'cidex/scripts/add-community-badges.sql',
  origin_code: 'the users.origin_code migration',
  profile_sync_stamp: 'cidex/scripts/add-profile-sync-stamp.sql',
  profileHeader: 'cidex/scripts/add-profile-header.sql',
}

/**
 * Whether an optional profile column can be written here.
 * @param {keyof OPTIONAL_COLUMNS} column The column the save wants to set.
 * @returns {Promise<boolean>} True when it exists; false, with a warning naming the migration.
 */
async function canWrite(column) {
  if (await hasColumn('users', column)) return true
  console.warn(`[PROFILE_COLUMN_MISSING]: users.${column} — this field was not saved. Apply ${OPTIONAL_COLUMNS[column]}.`)
  return false
}

export async function PUT(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    const formData = await request.formData()

    const name = formData.get('name')
    const description = formData.get('description')
    const birthday = formData.get('birthday')
    const profileImage = formData.get('profileImage')
    const profileHeader = formData.get('profileHeader')
    const removeProfileHeader = formData.get('removeProfileHeader') === '1'
    const tags = formData.get('tags')
    const links = formData.get('links')
    const badge = parseBadgeSelection(formData.get('badge'))
    const origin = parseOriginSelection(formData.get('origin'))
    const syncStamp = formData.get('syncStamp')

    // Verify profile exists before executing update
    const [existing] = await pool.execute('SELECT wallet_address FROM users WHERE wallet_address = ?', [address])

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const updateFields = []
    const queryValues = []

    // Ensure we don't write blank, empty, or null variations improperly
    if (name !== null) {
      updateFields.push('`name` = ?')
      queryValues.push(name)
    }
    if (description !== null) {
      updateFields.push('`description` = ?')
      queryValues.push(description)
    }
    if (birthday !== null) {
      updateFields.push('`birthday` = ?')
      queryValues.push(birthday.trim() === '' ? null : birthday)
    }

    // The form sends the already-pinned reference as a string; an untouched file input sends an
    // empty File object instead, which must never overwrite the stored picture. Both the type
    // check and the emptiness check are load-bearing.
    if (typeof profileImage === 'string' && profileImage.trim() !== '') {
      updateFields.push('`profileImage` = ?')
      queryValues.push(profileImage)
    }

    /* The cover, on the same "an empty field changes nothing" rule as the picture above — a
       removal has to say so out loud, and is stored as its own marker rather than as nothing at
       all, because for a Universal Profile "removed" and "never set here" are opposite answers. */
    const coverRef = typeof profileHeader === 'string' && profileHeader.trim() !== '' ? profileHeader : null
    if ((coverRef || removeProfileHeader) && (await canWrite('profileHeader'))) {
      updateFields.push('`profileHeader` = ?')
      queryValues.push(coverRef ?? COVER_REMOVED)
    }

    if (tags !== null) {
      updateFields.push('`tags` = ?')
      queryValues.push(tags)
    }
    if (links !== null) {
      updateFields.push('`links` = ?')
      queryValues.push(links)
    }

    /* Which community's tag this wallet wears. Only the pointer is written — the tag itself is
       resolved and re-verified on every read, so a badge set here still vanishes on its own the
       moment the wallet leaves that community or is banned from it. */
    if (badge.action === 'invalid') {
      return NextResponse.json({ error: 'Invalid badge selection' }, { status: 400 })
    }
    const badgeStorable = badge.action === 'clear' || badge.action === 'set' ? await canWrite('badge_network_id') : false
    if (badge.action === 'clear' && badgeStorable) {
      updateFields.push('`badge_network_id` = NULL', '`badge_contract_address` = NULL', '`badge_community_id` = NULL')
    }
    if (badge.action === 'set' && badgeStorable) {
      const wearable = await findWearableBadge(address, badge.selection)
      if (!wearable) {
        return NextResponse.json({ error: 'You are not a member of that community, or it has no tag' }, { status: 403 })
      }
      updateFields.push('`badge_network_id` = ?', '`badge_contract_address` = ?', '`badge_community_id` = ?')
      queryValues.push(wearable.networkId, wearable.contractAddress, wearable.communityId)
    }

    /* Where this wallet says it is from — a real country, or one of the onchain origins. Absent
       leaves it alone, empty clears it. A country is re-checked against the same `countries`
       table the picker was filled from, so the two can never disagree about which codes exist; an
       onchain slug was already checked against the build's own list while parsing. */
    if (origin.action === 'invalid') {
      return NextResponse.json({ error: 'Invalid origin selection' }, { status: 400 })
    }
    const originStorable = origin.action === 'clear' || origin.action === 'set' ? await canWrite('origin_code') : false
    if (origin.action === 'clear' && originStorable) {
      updateFields.push('`origin_code` = NULL')
    }
    if (origin.action === 'set' && originStorable) {
      if (isCountryCode(origin.code)) {
        const [known] = await pool.execute('SELECT iso_code FROM countries WHERE iso_code = ? LIMIT 1', [origin.code])
        if (known.length === 0) {
          return NextResponse.json({ error: 'Unknown country' }, { status: 400 })
        }
      }
      updateFields.push('`origin_code` = ?')
      queryValues.push(origin.code)
    }

    /* Sent only by the owner's editor, and only for a Universal Profile: it carries the indexer
       stamp this save has just overtaken, which is what makes the read above prefer this row
       until the matching onchain write lands. */
    if (typeof syncStamp === 'string' && (await canWrite('profile_sync_stamp'))) {
      updateFields.push('`profile_sync_stamp` = ?')
      queryValues.push(syncStamp)
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    }

    queryValues.push(address)

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')}, lastUpdate = CURRENT_TIMESTAMP
      WHERE wallet_address = ?
    `

    await pool.execute(updateQuery, queryValues)

    return NextResponse.json({ success: true, message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    if (!isWalletAddress(address)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const walletAddress = normalizeAddress(address)

    await pool.execute(
      `
      INSERT INTO users (
        wallet_address,
        created_at,
        last_seen_at,
        lastUpdate
      )
      VALUES (?, NOW(), NOW(), CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        last_seen_at = NOW()
      `,
      [walletAddress],
    )

    const [rows] = await pool.execute(
      `
      SELECT
        u.*,
        (SELECT COUNT(*) FROM posts p WHERE p.wallet_address = u.wallet_address) as total_posts
      FROM users u
      WHERE u.wallet_address = ?
      `,
      [walletAddress],
    )

    // Anyone can POST any address (ensureProfile does, on every connect), so the
    // echoed row must not carry the owner's private notification email.
    const created = rows[0]
    delete created.email
    delete created.email_verified_at
    delete created.email_notifications

    return NextResponse.json(created)
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
