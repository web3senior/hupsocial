import { NextResponse } from 'next/server'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import pool from '@/lib/db'
import { AVATAR_MAX_SIZE, resolveAvatarImageUrl } from '@/lib/storageHelper'
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

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    /* Leaderboard rank/score are intentionally NOT part of this response — computing
       them is far heavier than a profile read, and their only consumer (the OG share
       card) queries /api/v1/leaderboard itself. */

    /* The UP lookup and the DB fallback run in parallel: the local query is cheap,
       and paying for it upfront means a UP miss (or a slow/hung upstream, bounded
       by the helper's timeout) adds zero extra latency before the fallback. */
    /* The badge joins from the users row itself, so it needs nothing from the two reads
       beside it and adds no latency running in the same batch. It is re-verified against
       community_members on every call — see lib/badge.js for why it is never stored already
       resolved. */
    const [upData, [rows], badge] = await Promise.all([
      queryUniversalProfile(address),
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

    /* Hup-native, like birthday: a Universal Profile describes a person, not where they told
       Hup they are from, so both branches below take this from our own users row. Sequential
       rather than part of the batch above because it reads that row's value; it costs one
       indexed lookup, and only for profiles that actually publish a country. */
    const origin = await resolveOrigin(rows[0]?.origin_code)

    /* Check if the profile data exists and has valid metadata */
    const profile = upData?.data?.Profile?.[0]

    if (profile && (profile.name || profile.fullName)) {
      /* Hup-first editing. A Universal Profile edited here is written to our own row straight
         away and pushed onchain afterwards, so between those two moments — and for as long as a
         signature is never given — the indexer is still serving the metadata the user has just
         replaced. The stamp says which copy is newer, by equality against the indexer's own
         value: see cidex/scripts/add-profile-sync-stamp.sql. */
      const liveStamp = String(profile.lastMetadataUpdate ?? '')
      const storedStamp = rows[0]?.profile_sync_stamp ?? null
      const hupIsAhead = storedStamp !== null && storedStamp === liveStamp

      if (hupIsAhead) {
        profile.name = rows[0].name
        profile.description = rows[0].description
        profile.tags = parseJsonList(rows[0].tags)
        profile.links = parseJsonList(rows[0].links)
        /* fullName is the indexer's own "name#tag" rendering of the name that was just replaced.
           Dropping it lets a byline rebuild one from the name above instead of showing the old
           one — see the displayName memo in components/Profile.jsx. */
        profile.fullName = null
        /* The stored reference rather than the resolved URL: a retry has to put this picture back
           into an LSP3 document, and a proxy URL cannot be turned back into a CID. */
        profile.profileImageRef = rows[0].profileImage || null
        /* What the editor offers a Sync button for. */
        profile.syncPending = true
      } else if (storedStamp !== null) {
        /* The chain has moved past the edit — our own write landed, or the profile was changed on
           another client. Either way the indexer is authoritative again and the marker has done
           its job. Fire and forget: a failed clear costs one more comparison on the next read,
           never the profile itself. */
        pool
          .execute('UPDATE users SET profile_sync_stamp = NULL WHERE wallet_address = ?', [address])
          .catch((clearError) => console.error('[SYNC_STAMP_CLEAR_ERROR]:', clearError.message))
      }

      /* Fallback to profileImages array elements if they exist as per incoming payload */
      profile.profileImage = hupIsAhead
        ? resolveAvatarImageUrl(rows[0].profileImage, AVATAR_MAX_SIZE)
        : profile.profileImages && profile.profileImages.length > 0
          ? resolveAvatarImageUrl(profile.profileImages[0].src, AVATAR_MAX_SIZE)
          : null

      profile.wallet_address = normalizeAddress(address) // Ensure wallet address is included in the response for consistency

      // Birthday is a Hup-native field with no UP metadata equivalent — always
      // sourced from our own users row, even when the profile itself is a UP.
      profile.birthday = rows[0]?.birthday ?? null
      // Same for the community badge: a UP describes a person, not their Hup memberships.
      profile.badge = badge
      profile.origin = origin
      /* Read from the profile's OWN tags and description, so the mark travels with the metadata
         rather than with anything Hup remembers about the account — see lib/agentProfile.js. */
      profile.agent = resolveAgentProfile(profile)

      return NextResponse.json({
        source: 'universal_profile',
        data: profile,
      })
    }

    /* Fallback to Database if the UP endpoint fails or returns no profile */

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const dbProfile = rows[0]

    // The notification email is private contact data on a public endpoint —
    // never let SELECT u.* leak it now that the column is actually populated.
    delete dbProfile.email
    delete dbProfile.email_verified_at
    delete dbProfile.email_notifications

    /* Resolve profile image from any protocol (IPFS, UP cloud, http, etc.) */
    dbProfile.profileImage = resolveAvatarImageUrl(dbProfile.profileImage, AVATAR_MAX_SIZE)

    /* Only meaningful beside a Universal Profile, which this branch by definition is not. */
    delete dbProfile.profile_sync_stamp

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

    return NextResponse.json({
      source: 'database',
      data: dbProfile,
    })
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
