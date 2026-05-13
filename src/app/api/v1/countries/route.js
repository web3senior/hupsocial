/**
 * @file api/v1/public/countries/route.js
 * @description Fetches the list of supported countries for merchant registration.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    /* Fetch countries ordered alphabetically */
    /* Assuming schema: id, name, code (ISO), phone_code */
    const [countries] = await pool.execute(
      `SELECT 
        id, 
        name, 
        iso_code
      FROM countries 
      ORDER BY name ASC`
    )

    

    /* SUCCESS BRANCH */
    return NextResponse.json({
      success: true,
      data: countries,
      meta: {
        count: countries.length,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('[COUNTRIES_API_ERROR]:', error.message)

    /* ERROR BRANCH: Guaranteed response to satisfy Next.js runtime */
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch country list',
        details: error.message 
      }, 
      { status: 500 }
    )
  }
}