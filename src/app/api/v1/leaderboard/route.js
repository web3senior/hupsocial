/**
 * @file app/api/v1/public/rankings/route.js
 * @description Fixed Geo-spatial merchant rankings with correct SQL clause ordering.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Pagination
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 10
    const offset = (page - 1) * limit

    // Filters
    const typeId = searchParams.get('type_id')
    const countryId = searchParams.get('country_id')

    // Geo Filters
    const lat = parseFloat(searchParams.get('lat'))
    const lng = parseFloat(searchParams.get('lng'))
    const radius = parseFloat(searchParams.get('radius')) || 10

    let queryParams = []
    
    // 1. Define the distance calculation (Haversine)
    let distanceField = (lat && lng) 
      ? `, (6371 * acos(cos(radians(?)) * cos(radians(m.latitude)) * cos(radians(m.longitude) - radians(?)) + sin(radians(?)) * sin(radians(m.latitude)))) AS distance`
      : `, NULL AS distance`
    
    if (lat && lng) queryParams.push(lat, lng, lat)

    // 2. Build the Base Query
    let query = `
      SELECT 
        m.id, 
        m.business_name, 
        m.logo_url,
        m.latitude,
        m.longitude,
        mt.name as business_type
        ${distanceField},
        COUNT(DISTINCT t.id) as tx_count,
        IFNULL(SUM(t.amount), 0) as total_volume,
        IFNULL(AVG(f.rating), 0) as avg_rating
      FROM merchants m
      LEFT JOIN merchant_types mt ON m.business_type_id = mt.id
      LEFT JOIN transactions t ON m.id = t.merchant_id AND t.status = 'confirmed'
      LEFT JOIN feedback f ON m.id = f.merchant_id
      WHERE m.is_active = 1
    `

    // 3. Add WHERE filters
    if (typeId) {
      query += ` AND m.business_type_id = ?`
      queryParams.push(typeId)
    }
    if (countryId) {
      query += ` AND m.country_id = ?`
      queryParams.push(countryId)
    }

    // 4. GROUP BY must come BEFORE HAVING
    query += ` GROUP BY m.id, mt.name`

    // 5. Apply Geo-Radius Filter using HAVING
    if (lat && lng && radius) {
      query += ` HAVING distance <= ?`
      queryParams.push(radius)
    }

    // 6. ORDER BY and LIMIT
    query += (lat && lng) 
      ? ` ORDER BY distance ASC, total_volume DESC` 
      : ` ORDER BY total_volume DESC, avg_rating DESC`
    
    query += ` LIMIT ? OFFSET ?`
    queryParams.push(limit + 1, offset)

    const [rows] = await pool.execute(query, queryParams)

    const hasMore = rows.length > limit
    const rankingsToSend = hasMore ? rows.slice(0, limit) : rows
    const nextPage = hasMore ? page + 1 : null

    

    return NextResponse.json({
      success: true,
      data: rankingsToSend.map(row => ({
        ...row,
        total_volume: parseFloat(row.total_volume).toFixed(2),
        avg_rating: parseFloat(row.avg_rating).toFixed(1),
        distance_km: row.distance ? parseFloat(row.distance).toFixed(2) : null
      })),
      nextPage,
      meta: {
        page,
        count: rankingsToSend.length,
        location_filtered: !!(lat && lng),
        radius_used: lat && lng ? `${radius}km` : null,
        hasMore
      }
    })

  } catch (error) {
    console.error('[RANKINGS_GEO_ERROR]:', error.message)
    return NextResponse.json(
      { success: false, error: 'Location search failed', details: error.message }, 
      { status: 500 }
    )
  }
}