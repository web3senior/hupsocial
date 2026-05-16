import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request, { params }) {
  try {
    const { address } = await params

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

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

    return NextResponse.json(rows[0])
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
    const [existing] = await pool.execute(
      'SELECT wallet_address FROM users WHERE wallet_address = ?',
      [address]
    )

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