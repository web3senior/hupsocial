import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { resolveStorageUrl } from '@/lib/storageHelper' /* Adjust this import path to match your helper file location */

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    /* Construct the internal URL for your proxy route and leaderboard endpoint */
    const origin = new URL(request.url).origin
    const upProxyUrl = `${origin}/api/universal-profile`
    const leaderboardUrl = `${origin}/api/v1/leaderboard?wallet_address=${encodeURIComponent(address)}`

    let leaderboardRank = null
    let leaderboardScore = 0
    let leaderboardTotalPosts = 0

    /* Fetch the user's leaderboard ranking metadata from your updated leaderboard endpoint */
    try {
      const lbResponse = await fetch(leaderboardUrl)
      if (lbResponse.ok) {
        const lbData = await lbResponse.json()
        if (lbData.success && lbData.data) {
          leaderboardRank = lbData.data.rank || null
          leaderboardScore = lbData.data.score || 0
          leaderboardTotalPosts = lbData.data.total_posts || 0
        }
      }
    } catch (lbError) {
      /* Log internally but continue so the endpoint remains resilient */
      console.error('Internal Leaderboard look up failed:', lbError.message)
    }

    try {
      /* Hit your internal Universal Profile endpoint */
      const myHeaders = new Headers()
      myHeaders.append('Content-Type', 'application/json')

      const raw = JSON.stringify({
        addr: address.toLowerCase(), // Preserve original casing in payload to match working query state
      })

      const requestOptions = {
        method: 'POST',
        headers: myHeaders,
        body: raw,
        redirect: 'follow',
      }

      const upResponse = await fetch(upProxyUrl, requestOptions)

      if (upResponse.ok) {
        const upData = await upResponse.json()

        /* Check if the profile data exists and has valid metadata */
        const profile = upData?.data?.Profile?.[0]

        if (profile && (profile.name || profile.fullName)) {
          /* Fallback to profileImages array elements if they exist as per incoming payload */
          profile.profileImage = profile.profileImages && profile.profileImages.length > 0 ? profile.profileImages[0].src : null

          profile.wallet_address = address.toLowerCase() // Ensure wallet address is included in the response for consistency

          /* Append leaderboard tracking data fields */
          profile.leaderboard_rank = leaderboardRank
          profile.leaderboard_score = leaderboardScore
          profile.total_posts = leaderboardTotalPosts

          return NextResponse.json({
            source: 'universal_profile',
            data: profile,
          })
        }
      }
    } catch (upError) {
      /* Quietly catch internal fetch errors to ensure fallback execution succeeds */
      console.error('Internal Universal Profile lookup failed:', upError.message)
    }

    /* Fallback to Database if the UP endpoint fails or returns no profile */
    const [rows] = await pool.execute(
      `SELECT 
        u.*, 
        (SELECT COUNT(*) FROM posts p WHERE p.wallet_address = u.wallet_address) as total_posts
      FROM users u
      WHERE u.wallet_address = ?`,
      [address],
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const dbProfile = rows[0]

    /* Resolve profile image from any protocol (IPFS, 0G, etc.) */
    dbProfile.profileImage = resolveStorageUrl(dbProfile.profileImage)

    /* Append leaderboard tracking data fields to database fallback too */
    dbProfile.leaderboard_rank = leaderboardRank
    dbProfile.leaderboard_score = leaderboardScore
    dbProfile.total_posts = leaderboardTotalPosts

    return NextResponse.json({
      source: 'database',
      data: dbProfile,
    })
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
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
    const profileImage = formData.get('profileImage')
    const tags = formData.get('tags')
    const links = formData.get('links')

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

    // FIXED: Better string validation for the 0G root hash.
    // If it's an empty file object from the form submit, typeof won't be a string.
    // We also make sure it's not an empty string string.
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

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const walletAddress = address.toLowerCase()

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

    return NextResponse.json(rows[0])
  } catch (error) {
    console.error('Database Error:', error.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
