// Server-only AES-256-GCM helpers for gated store content.
//
// Content is encrypted with a RANDOM per-post key (32 bytes of fresh entropy, no formula), stored
// in the `store_content_keys` table wrapped (encrypted) with a master secret from env. Compromising
// the env secret alone exposes nothing without the DB rows, and vice versa; there is no master key
// that can derive the whole catalog offline.
//
// Env convention:
//   STORE_CONTENT_KEY_SECRET      — the v1 master secret
//   STORE_CONTENT_KEY_SECRET_V2   — added when rotating; likewise _V3, ...
//   STORE_CONTENT_KEY_VERSION     — master-secret version used to wrap NEW keys (default 1)
//
// Rotation: add the new secret, bump the version — new listings wrap under it immediately. Old
// rows stay readable via their recorded wrap_version; re-wrap them under the new master (no IPFS
// re-uploads needed) to fully retire a leaked secret.
//
// Blob layout: magic "HUPS" (4 bytes) + format version (1 byte) + iv (12) + authTag (16) + ciphertext.

import crypto from 'crypto'
import pool from '@/lib/db'

const MAGIC = Buffer.from('HUPS', 'utf8')
const BLOB_VERSION = 0

export const CURRENT_KEY_VERSION = Number(process.env.STORE_CONTENT_KEY_VERSION || 1)

function secretForVersion(version) {
  if (version === 1) {
    return process.env.STORE_CONTENT_KEY_SECRET_V1 || process.env.STORE_CONTENT_KEY_SECRET
  }
  return process.env[`STORE_CONTENT_KEY_SECRET_V${version}`]
}

export function isConfigured() {
  return Boolean(secretForVersion(CURRENT_KEY_VERSION))
}

// --- Keystore: random per-post keys wrapped with the master secret ---

function masterKey(version) {
  const secret = secretForVersion(version)
  if (!secret) throw new Error(`No secret configured for wrap version ${version}`)
  return crypto.createHash('sha256').update(secret).digest()
}

function wrapKey(rawKey, wrapVersion) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(wrapVersion), iv)
  const ciphertext = Buffer.concat([cipher.update(rawKey), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}

function unwrapKey(wrapped, wrapVersion) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(wrapVersion), wrapped.subarray(0, 12))
  decipher.setAuthTag(wrapped.subarray(12, 28))
  return Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()])
}

let tableReady = null

function ensureTable() {
  if (!tableReady) {
    tableReady = pool.execute(`
      CREATE TABLE IF NOT EXISTS store_content_keys (
        network_id INT UNSIGNED NOT NULL,
        post_id BIGINT UNSIGNED NOT NULL,
        wrapped_key VARBINARY(128) NOT NULL,
        wrap_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (network_id, post_id)
      )
    `)
  }
  return tableReady
}

async function loadContentKey(networkId, postId) {
  await ensureTable()
  const [rows] = await pool.execute(
    'SELECT wrapped_key, wrap_version FROM store_content_keys WHERE network_id = ? AND post_id = ?',
    [networkId, postId],
  )
  if (rows.length === 0) return null
  return unwrapKey(rows[0].wrapped_key, Number(rows[0].wrap_version))
}

async function getOrCreateContentKey(networkId, postId) {
  const existing = await loadContentKey(networkId, postId)
  if (existing) return existing

  const rawKey = crypto.randomBytes(32)
  await pool.execute(
    'INSERT IGNORE INTO store_content_keys (network_id, post_id, wrapped_key, wrap_version) VALUES (?, ?, ?, ?)',
    [networkId, postId, wrapKey(rawKey, CURRENT_KEY_VERSION), CURRENT_KEY_VERSION],
  )

  // Re-read to survive a concurrent insert racing this one — the row wins, not our local copy
  const stored = await loadContentKey(networkId, postId)
  if (!stored) throw new Error('Failed to persist content key')
  return stored
}

// --- Content encryption ---

export async function encryptContent(networkId, postId, plaintext) {
  const key = await getOrCreateContentKey(networkId, postId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

  return Buffer.concat([MAGIC, Buffer.from([BLOB_VERSION]), iv, cipher.getAuthTag(), ciphertext])
}

export async function decryptContent(networkId, postId, blob) {
  if (blob.length <= 33 || !blob.subarray(0, 4).equals(MAGIC) || blob[4] !== BLOB_VERSION) {
    throw new Error('Unrecognized content blob format')
  }

  const key = await loadContentKey(networkId, postId)
  if (!key) throw new Error('No content key found for this listing')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(5, 17))
  decipher.setAuthTag(blob.subarray(17, 33))
  return Buffer.concat([decipher.update(blob.subarray(33)), decipher.final()])
}
