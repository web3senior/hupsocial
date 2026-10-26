/**
 * @file lib/notificationRows.js
 * @description The one shape a `notifications` row leaves the server in, shared by the paged
 * REST route and the live SSE stream so a toast and a feed row always read the same fields.
 */

export const NOTIFICATION_COLUMNS = `
  id,
  recipient_wallet_address,
  actor_wallet_address,
  action_type,
  entity_type,
  entity_id,
  network_id,
  block_number,
  tx_hash,
  log_index,
  title,
  message,
  action_url,
  data,
  is_read,
  read_at,
  created_at
`

export function serializeNotification(row) {
  return {
    id: String(row.id),
    recipient_wallet_address: row.recipient_wallet_address,
    actor_wallet_address: row.actor_wallet_address,
    action_type: row.action_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    network_id: toNullableNumber(row.network_id),
    block_number: toNullableNumber(row.block_number),
    tx_hash: row.tx_hash,
    log_index: toNullableNumber(row.log_index),
    title: row.title,
    message: row.message,
    action_url: row.action_url,
    data: parseJson(row.data),
    is_read: Boolean(row.is_read),
    read_at: toSerializableDate(row.read_at),
    created_at: toSerializableDate(row.created_at),
  }
}

function parseJson(value) {
  if (!value) return null
  // mysql2 already parses JSON-typed columns; only TEXT columns arrive as a string
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toNullableNumber(value) {
  return value === null || value === undefined ? null : Number(value)
}

function toSerializableDate(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}
