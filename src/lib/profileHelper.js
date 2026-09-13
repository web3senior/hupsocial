/**
 * @file lib/profileHelper.js
 * @description Fills the author identity a list of rows is missing — display name and avatar —
 * by reading each wallet's Universal Profile from LUKSO, and caches the answer in `users` so
 * the same wallet is never read twice.
 */

import { isEvmAddress } from './address'
import { readUniversalProfiles } from './lukso'

export async function fulfillUniversalProfiles(items, pool) {
  try {
    // Only EVM addresses can be Universal Profiles; a Solana (base58) author is skipped so it is
    // neither read for nor written back lowercased — base58 is case-sensitive.
    const missingAddresses = [
      ...new Set(
        items
          .filter(item => item.display_name === null && isEvmAddress(item.wallet_address))
          .map(item => item.wallet_address.toLowerCase())
      )
    ]

    if (missingAddresses.length === 0) return

    // One multicall for every pointer, then the documents they name. An address missing from
    // this map was never answered for and is left alone: it must not be cached either way.
    const answers = await readUniversalProfiles(missingAddresses)

    const profileMap = {}
    for (const [address, profile] of answers) {
      if (!profile) continue

      profileMap[address] = {
        display_name: profile.name || profile.fullName || null,
        profile_image: profile.profileImages?.[0]?.src ?? null,
        description: profile.description || null,
        tags: profile.tags || [],
        links: profile.links || [],
      }
    }

    // Fulfill item details in-place
    for (const item of items) {
      const lowerAddr = item.wallet_address?.toLowerCase()
      if (lowerAddr && profileMap[lowerAddr]) {
        const profile = profileMap[lowerAddr]
        if (item.display_name === null) {
          item.display_name = profile.display_name
        }
        if (item.profile_image === null) {
          item.profile_image = profile.profile_image
        }
      }
    }

    // Perform database cache insertion/upsert
    for (const addr of Object.keys(profileMap)) {
      const profile = profileMap[addr]
      // Cache in DB (even if name/image is null, we set it to '' so we don't query again)
      const nameVal = profile.display_name !== null ? profile.display_name : ''
      const imageVal = profile.profile_image !== null ? profile.profile_image : ''

      try {
        await pool.execute(
          `
          INSERT INTO users (
            wallet_address,
            name,
            description,
            profileImage,
            tags,
            links,
            created_at,
            last_seen_at,
            lastUpdate
          )
          VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), CURRENT_TIMESTAMP)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            description = VALUES(description),
            profileImage = VALUES(profileImage),
            tags = VALUES(tags),
            links = VALUES(links),
            last_seen_at = NOW(),
            lastUpdate = CURRENT_TIMESTAMP
          `,
          [
            addr,
            nameVal,
            profile.description,
            imageVal,
            JSON.stringify(profile.tags),
            JSON.stringify(profile.links)
          ]
        )
      } catch (dbError) {
        console.error(`Failed to cache profile in DB for address ${addr}:`, dbError.message)
      }
    }

    // Wallets the chain answered about and had no profile for: cached as empty so they are not
    // read again. An address the chain never answered for is deliberately not in this list.
    for (const [addr, profile] of answers) {
      if (profile) continue

      try {
        await pool.execute(
          `
          INSERT INTO users (
            wallet_address,
            name,
            profileImage,
            created_at,
            last_seen_at,
            lastUpdate
          )
          VALUES (?, '', '', NOW(), NOW(), CURRENT_TIMESTAMP)
          ON DUPLICATE KEY UPDATE
            name = '',
            profileImage = '',
            last_seen_at = NOW(),
            lastUpdate = CURRENT_TIMESTAMP
          `,
          [addr]
        )
      } catch (dbError) {
        console.error(`Failed to cache EOA flag in DB for address ${addr}:`, dbError.message)
      }
    }
  } catch (error) {
    console.error('Error in fulfillUniversalProfiles pipeline:', error.message)
  }
}
