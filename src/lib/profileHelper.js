/**
 * @file lib/profileHelper.js
 * @description Helper to fetch Universal Profiles from LUKSO API and cache them in the database.
 */

export async function fulfillUniversalProfiles(items, pool) {
  try {
    const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
    if (!endpoint) return

    // Find unique wallet addresses that have display_name === null
    const missingAddresses = [
      ...new Set(
        items
          .filter(item => item.display_name === null && item.wallet_address)
          .map(item => item.wallet_address.toLowerCase())
      )
    ]

    if (missingAddresses.length === 0) return

    const graphqlQuery = {
      query: `query MyQuery($ids: [String!]!) {
        Profile(where: {id: {_in: $ids}}) {
          id
          fullName
          name
          tags
          links { id title url }
          standard
          profileImages { src url }
          description
          url
        }
      }`,
      variables: { ids: missingAddresses },
      operationName: 'MyQuery'
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })

    if (!response.ok) {
      console.warn('LUKSO upstream API returned status:', response.status)
      return
    }

    const result = await response.json()
    const profiles = result?.data?.Profile || []

    const profileMap = {}
    for (const profile of profiles) {
      const profileImage = profile.profileImages && profile.profileImages.length > 0 
        ? profile.profileImages[0].src 
        : null
      
      profileMap[profile.id.toLowerCase()] = {
        display_name: profile.name || profile.fullName || null,
        profile_image: profileImage,
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

    // Handle missing addresses that were NOT returned by the Envio query (not UP/not indexable)
    // To avoid querying them repeatedly, cache them in DB as EOA / empty profiles
    const returnedAddresses = new Set(profiles.map(p => p.id.toLowerCase()))
    for (const addr of missingAddresses) {
      if (!returnedAddresses.has(addr)) {
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
    }
  } catch (error) {
    console.error('Error in fulfillUniversalProfiles pipeline:', error.message)
  }
}
