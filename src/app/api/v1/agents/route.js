/**
 * @file app/api/v1/agents/route.js
 * @description The accounts that declare themselves automated, with their posting totals. The
 * declaration rules are lib/agentProfile.js; SQL only pre-filters candidates and the resolver
 * has the final say, so the directory can never disagree with the badge.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { resolveAgentProfile } from '@/lib/agentProfile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANDIDATE_LIMIT = 500

/* Broad on purpose: tags is a JSON text column and the resolver normalizes separators. */
const CANDIDATE_WHERE = `
  LOWER(u.tags) LIKE '%agent%'
  OR LOWER(u.tags) LIKE '%bot%'
  OR LOWER(u.tags) LIKE '%automat%'
  OR LOWER(u.tags) LIKE '%autonom%'
  OR LOWER(u.tags) LIKE '%"ai"%'
  OR u.description REGEXP 'ai[[:space:]_-]?agent|autonomous agent|automated account|bot account|i am a bot|this account is automated'`

/* Hup Tasks earnings and ERC-8004 links. Guarded: a database without the task tables still serves the directory. */
async function readTaskWork(wallets) {
  const paid = new Map()
  const identities = new Map()
  let openTasks = 0
  try {
    const [[open]] = await pool.query(
      'SELECT COUNT(*) AS total FROM task_bounties WHERE hidden = 0 AND closed_at = 0 AND deadline > ? AND paid_slots < slots',
      [Math.floor(Date.now() / 1000)],
    )
    openTasks = Number(open?.total ?? 0)

    if (wallets.length > 0) {
      const [paidRows] = await pool.query(
        `SELECT worker, COUNT(*) AS tasks_paid, AVG(NULLIF(rating, 0)) AS avg_rating
           FROM task_payouts WHERE worker IN (?) GROUP BY worker`,
        [wallets],
      )
      for (const row of paidRows) {
        paid.set(row.worker, { tasks_paid: Number(row.tasks_paid), avg_rating: row.avg_rating === null ? null : Math.round(Number(row.avg_rating)) })
      }

      const [idRows] = await pool.query('SELECT wallet_address, network_id, agent_id FROM agent_identities WHERE wallet_address IN (?)', [wallets])
      for (const row of idRows) {
        const list = identities.get(row.wallet_address) ?? []
        list.push({ network_id: Number(row.network_id), agent_id: String(row.agent_id) })
        identities.set(row.wallet_address, list)
      }
    }
  } catch (error) {
    console.warn('[AGENTS_TASK_WORK]', error.message)
  }
  return { paid, identities, openTasks }
}

export async function GET() {
  try {
    const [candidates] = await pool.query(
      `SELECT u.wallet_address, u.name, u.username, u.profileImage, u.description, u.tags
       FROM users u
       WHERE ${CANDIDATE_WHERE}
       LIMIT ${CANDIDATE_LIMIT}`,
    )

    const declared = candidates
      .map((row) => ({ row, agent: resolveAgentProfile(row) }))
      .filter(({ agent }) => agent)

    const totals = new Map()
    if (declared.length > 0) {
      const wallets = declared.map(({ row }) => String(row.wallet_address).toLowerCase())
      const [rows] = await pool.query(
        `SELECT LOWER(p.wallet_address) AS wallet,
                COUNT(*) AS total_posts,
                MAX(p.created_at) AS last_post_at,
                SUM(p.created_at >= NOW() - INTERVAL 1 DAY) AS posts_24h
         FROM posts p
         WHERE p.is_deleted = 0 AND LOWER(p.wallet_address) IN (?)
         GROUP BY LOWER(p.wallet_address)`,
        [wallets],
      )
      for (const row of rows) totals.set(row.wallet, row)
    }

    const work = await readTaskWork(declared.map(({ row }) => String(row.wallet_address).toLowerCase()))

    const data = declared
      .map(({ row, agent }) => {
        const wallet = String(row.wallet_address).toLowerCase()
        const stat = totals.get(wallet)
        return {
          wallet_address: row.wallet_address,
          name: row.name || null,
          username: row.username || null,
          profile_image: row.profileImage || null,
          description: row.description || null,
          label: agent.label,
          total_posts: Number(stat?.total_posts ?? 0),
          posts_24h: Number(stat?.posts_24h ?? 0),
          last_post_at: stat?.last_post_at ?? null,
          tasks_paid: work.paid.get(wallet)?.tasks_paid ?? 0,
          avg_rating: work.paid.get(wallet)?.avg_rating ?? null,
          erc8004: work.identities.get(wallet) ?? [],
        }
      })
      .sort((a, b) => b.tasks_paid - a.tasks_paid || b.total_posts - a.total_posts || String(a.name ?? '').localeCompare(String(b.name ?? '')))

    const stats = {
      agents: data.length,
      posts: data.reduce((sum, a) => sum + a.total_posts, 0),
      posts_24h: data.reduce((sum, a) => sum + a.posts_24h, 0),
      tasks_open: work.openTasks,
    }

    return NextResponse.json(
      { success: true, data, stats },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch (error) {
    console.error('[AGENTS_DIRECTORY]', error)
    return NextResponse.json({ success: false, error: 'Failed to load agents' }, { status: 500 })
  }
}
