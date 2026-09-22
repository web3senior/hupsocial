/**
 * @file api/v1/tasks/[networkId]/[postId]/route.js
 * @description One task with everything its card and review dialog need: the indexed task row
 * (null while the post is still unfunded), its submissions (the post's live direct replies), the
 * payouts, and each submitter's verified ERC-8004 agent id on this chain.
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SUBMISSIONS = 200

const parseContent = (content) => {
  try {
    return typeof content === 'string' ? JSON.parse(content) : content || null
  } catch {
    return null
  }
}

export async function GET(request, { params }) {
  try {
    const { networkId: rawNetworkId, postId } = await params
    const networkId = parseInt(rawNetworkId, 10)
    if (!networkId || !/^\d+$/.test(String(postId))) {
      return NextResponse.json({ success: false, error: 'A numeric network id and post id are required' }, { status: 400 })
    }

    const [taskRows] = await pool.execute(
      `SELECT network_id, contract_address, post_id, poster AS wallet_address, category, payment_token, is_lsp7,
              token_symbol, token_decimals, reward_per_slot, fee_per_slot, fee_bps, slots, paid_slots, deadline,
              is_sealed, task_pubkey, closed_reason, closed_at, refunded, hidden, tx_hash, posted_at
         FROM task_bounties
        WHERE network_id = ? AND post_id = ?
        LIMIT 1`,
      [networkId, postId],
    )
    const task = taskRows[0] ?? null

    const [postRows] = await pool.execute(
      'SELECT wallet_address, content, comment_count, is_deleted FROM posts WHERE id = ? AND network_id = ? LIMIT 1',
      [postId, networkId],
    )
    const post = postRows[0] ?? null

    const [replies] = await pool.execute(
      `SELECT id, wallet_address, content, created_at
         FROM posts
        WHERE is_comment = ? AND network_id = ? AND is_deleted = 0
        ORDER BY id ASC
        LIMIT ${MAX_SUBMISSIONS}`,
      [postId, networkId],
    )

    const [payouts] = await pool.execute(
      `SELECT reply_id, worker, amount, fee_amount, agent_id, rating, feedback_given, reveal_key, paid_at, tx_hash
         FROM task_payouts
        WHERE network_id = ? AND post_id = ?
        ORDER BY paid_at ASC`,
      [networkId, postId],
    )
    const payoutByReply = new Map(payouts.map((row) => [String(row.reply_id), row]))

    const wallets = [...new Set(replies.map((row) => String(row.wallet_address).toLowerCase()))]
    const agentByWallet = new Map()
    if (wallets.length > 0) {
      const [identities] = await pool.query(
        'SELECT wallet_address, agent_id FROM agent_identities WHERE network_id = ? AND wallet_address IN (?)',
        [networkId, wallets],
      )
      for (const row of identities) agentByWallet.set(String(row.wallet_address).toLowerCase(), String(row.agent_id))
    }

    const posterWallet = String(task?.wallet_address || post?.wallet_address || '').toLowerCase()
    const submissions = replies.map((row) => {
      const wallet = String(row.wallet_address).toLowerCase()
      const content = parseContent(row.content)
      const payout = payoutByReply.get(String(row.id)) ?? null
      return {
        reply_id: String(row.id),
        wallet_address: row.wallet_address,
        created_at: row.created_at,
        is_poster: wallet === posterWallet,
        text: content?.elements?.find((element) => element?.type === 'text')?.data?.text ?? '',
        media: content?.elements?.find((element) => element?.type === 'media')?.data?.items ?? [],
        sealed: content?.taskSubmission ?? null,
        agent_id: agentByWallet.get(wallet) ?? null,
        payout,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        task,
        post: post ? { wallet_address: post.wallet_address, comment_count: post.comment_count, is_deleted: post.is_deleted, hupTask: parseContent(post.content)?.hupTask ?? null } : null,
        submissions,
        payouts,
      },
    })
  } catch (error) {
    console.error('[GET_TASK_DETAIL_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
