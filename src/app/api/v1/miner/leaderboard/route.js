/**
 * @file api/v1/miner/leaderboard/route.js
 * @description Hup Miner leaderboards, read from the miner_runs table that cidex populates from
 * RunPlayed events — the app never scans the chain itself. Three ranges:
 *
 *   ?range=daily   — today's runs, ranked by score (one run per player per day by contract rule)
 *   ?range=weekly  — last 7 days, ranked by total score, with best run and days played
 *   ?range=all     — all time, ranked by best single run
 *
 * Optionally pass ?player=0x… to also get that player's own row/rank for the same range.
 * CORS is open: the game frame runs on its own origin and this data is public by construction.
 */

import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { monadTestnet } from 'wagmi/chains'
import pool from '@/lib/db'

const NETWORK_ID = monadTestnet.id
const PAGE_SIZE = 50

// Same day arithmetic as the contract: UTC day number = unix seconds / 86400
const currentUtcDay = () => Math.floor(Date.now() / 1000 / 86400)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonResponse = (body, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS })

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || 'daily'
    const playerParam = searchParams.get('player')
    const player = playerParam && isAddress(playerParam) ? playerParam.toLowerCase() : null

    const today = currentUtcDay()

    let rows
    if (range === 'daily') {
      ;[rows] = await pool.execute(
        `SELECT player, score, digs, CAST(packed_outcomes AS CHAR) AS packedOutcomes, streak, tx_hash AS txHash
         FROM miner_runs
         WHERE network_id = ? AND day = ?
         ORDER BY score DESC, block_number ASC
         LIMIT ${PAGE_SIZE}`,
        [NETWORK_ID, today],
      )
    } else if (range === 'weekly') {
      ;[rows] = await pool.execute(
        `SELECT player, SUM(score) AS totalScore, MAX(score) AS bestScore, COUNT(*) AS daysPlayed, MAX(streak) AS streak
         FROM miner_runs
         WHERE network_id = ? AND day > ?
         GROUP BY player
         ORDER BY totalScore DESC, bestScore DESC
         LIMIT ${PAGE_SIZE}`,
        [NETWORK_ID, today - 7],
      )
    } else if (range === 'all') {
      ;[rows] = await pool.execute(
        `SELECT player, MAX(score) AS bestScore, SUM(score) AS totalScore, COUNT(*) AS runs
         FROM miner_runs
         WHERE network_id = ?
         GROUP BY player
         ORDER BY bestScore DESC, totalScore DESC
         LIMIT ${PAGE_SIZE}`,
        [NETWORK_ID],
      )
    } else {
      return jsonResponse({ success: false, error: 'range must be daily, weekly, or all' }, 400)
    }

    const data = {
      range,
      day: today,
      leaderboard: rows.map((row, index) => ({ rank: index + 1, ...row })),
    }

    // The asking player's own standing for the same range, even when outside the page
    if (player) {
      if (range === 'daily') {
        const [[own]] = await pool.execute(
          `SELECT player, score, digs, streak,
             (SELECT COUNT(*) + 1 FROM miner_runs r2 WHERE r2.network_id = ? AND r2.day = ? AND r2.score > r.score) AS playerRank
           FROM miner_runs r
           WHERE network_id = ? AND day = ? AND player = ?
           LIMIT 1`,
          [NETWORK_ID, today, NETWORK_ID, today, player],
        )
        data.me = own ? { ...own, rank: Number(own.playerRank) } : null
      } else {
        const sinceDay = range === 'weekly' ? today - 7 : -1
        const [[own]] = await pool.execute(
          `SELECT player, SUM(score) AS totalScore, MAX(score) AS bestScore, COUNT(*) AS runs
           FROM miner_runs
           WHERE network_id = ? AND day > ? AND player = ?
           GROUP BY player
           LIMIT 1`,
          [NETWORK_ID, sinceDay, player],
        )
        data.me = own || null
      }
    }

    return jsonResponse({ success: true, data })
  } catch (err) {
    console.error('Miner leaderboard failed:', err)
    return jsonResponse({ success: false, error: 'Leaderboard unavailable' }, 500)
  }
}
