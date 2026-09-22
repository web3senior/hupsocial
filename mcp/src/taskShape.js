/**
 * @file mcp/src/taskShape.js
 * Compact, model-friendly views of Hup Tasks rows from the app API.
 */

import { formatUnits } from 'viem'

const amount = (units, decimals) => {
  try {
    return formatUnits(BigInt(units ?? 0), Number(decimals ?? 18))
  } catch {
    return String(units ?? '0')
  }
}

export function taskStatus(row) {
  if (!row) return 'unfunded'
  if (row.closed_reason === 'cancelled') return 'cancelled'
  if (row.closed_reason === 'reclaimed') return 'closed'
  if (Number(row.paid_slots) >= Number(row.slots)) return 'filled'
  if (Number(row.deadline) <= Math.floor(Date.now() / 1000)) return 'in_review'
  return 'open'
}

export function compactTask(row, base) {
  const symbol = row.token_symbol || ''
  const slots = Number(row.slots || 0)
  const paid = Number(row.paid_slots || 0)
  return {
    network_id: Number(row.network_id),
    post_id: String(row.post_id),
    url: `${base}/networks/${row.network_id}/${row.post_id}`,
    status: taskStatus(row),
    category: row.category,
    brief: row.post_text ?? undefined,
    poster: row.wallet_address,
    reward: `${amount(row.reward_per_slot, row.token_decimals)} ${symbol}`.trim(),
    reward_units: String(row.reward_per_slot),
    token: row.payment_token,
    token_symbol: symbol || null,
    token_decimals: Number(row.token_decimals ?? 18),
    slots,
    paid_slots: paid,
    slots_left: Math.max(0, slots - paid),
    replies: row.comment_count === undefined ? undefined : Number(row.comment_count || 0),
    sealed: Number(row.is_sealed) === 1,
    deadline: Number(row.deadline),
    deadline_iso: new Date(Number(row.deadline) * 1000).toISOString(),
    contract: row.contract_address ?? undefined,
  }
}

export function compactSubmission(row) {
  return {
    reply_id: row.reply_id,
    author: row.wallet_address,
    is_poster: Boolean(row.is_poster),
    text: row.sealed ? null : row.text,
    media: row.sealed ? [] : row.media ?? [],
    sealed: Boolean(row.sealed),
    agent_id: row.agent_id,
    paid: Boolean(row.payout),
    rating: row.payout ? Number(row.payout.rating) : undefined,
    revealed: Boolean(row.payout?.reveal_key),
    created_at: row.created_at,
  }
}
