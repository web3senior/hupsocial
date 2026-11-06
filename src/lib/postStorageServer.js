import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import pool from '@/lib/db'
import { HOSTED_PATH, hostedKey } from '@/lib/postStorage'
import { invalidateMedia } from '@/lib/mediaCache'

let schemaReady
export function ensurePostStorage() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.execute(`CREATE TABLE IF NOT EXISTS post_storage_assets (
        uri VARCHAR(768) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        object_key VARCHAR(255) NULL,
        provider VARCHAR(16) NOT NULL,
        deleted TINYINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`)
      await pool.execute(`CREATE TABLE IF NOT EXISTS post_storage_cleanup (
        network_id BIGINT NOT NULL,
        post_id BIGINT UNSIGNED NOT NULL,
        refs LONGTEXT NOT NULL,
        completed TINYINT NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (network_id, post_id)
      )`)
      await pool.execute(`CREATE TABLE IF NOT EXISTS post_storage_objects (
        object_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        uri VARCHAR(768) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        INDEX post_storage_objects_uri (uri)
      )`)
    })().catch((error) => { schemaReady = null; throw error })
  }
  return schemaReady
}

export function storageOrigin() {
  const origin = new URL(process.env.HUP_STORAGE_ORIGIN || 'https://hup.social')
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('HUP_STORAGE_ORIGIN must use HTTPS')
  return origin.origin
}

export function hostedStorageConfigured() {
  return Boolean(process.env.HUP_STORAGE_BUCKET && process.env.HUP_STORAGE_KEY && process.env.HUP_STORAGE_SECRET && process.env.HUP_STORAGE_BUCKET !== process.env.FILEBASE_S3_BUCKET)
}

export function hostedClient() {
  if (!hostedStorageConfigured()) throw new Error('Hup storage is not configured')
  if (process.env.HUP_STORAGE_BUCKET === process.env.FILEBASE_S3_BUCKET) throw new Error('Hup storage requires a separate non-IPFS bucket')
  return new S3Client({
    endpoint: process.env.HUP_STORAGE_ENDPOINT || 'https://s3.filebase.io',
    region: process.env.HUP_STORAGE_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.HUP_STORAGE_KEY, secretAccessKey: process.env.HUP_STORAGE_SECRET },
  })
}

export function newHostedObject(name = '') {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase()
  const key = `${randomUUID()}${extension ? `.${extension}` : ''}`
  return { key, uri: `${storageOrigin()}${HOSTED_PATH}${key}` }
}

export async function registerStorageAsset(uri, provider, key = null) {
  await ensurePostStorage()
  // A successful upload of the same bytes makes that CID available again.
  await pool.execute(`INSERT INTO post_storage_assets (uri, provider, object_key) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE object_key = COALESCE(VALUES(object_key), object_key), deleted = 0`, [uri, provider, key])
  if (key && provider === 'ipfs') {
    await pool.execute('INSERT IGNORE INTO post_storage_objects (object_key, uri) VALUES (?, ?)', [key, uri])
  }
}

export async function putHostedObject(body, name, contentType) {
  const { key, uri } = newHostedObject(name)
  await hostedClient().send(new PutObjectCommand({
    Bucket: process.env.HUP_STORAGE_BUCKET, Key: key, Body: body,
    ContentType: contentType, CacheControl: 'no-store',
  }))
  await registerStorageAsset(uri, 'hosted', key)
  return uri
}

export async function isStorageDeleted(uri) {
  await ensurePostStorage()
  const [[row]] = await pool.execute('SELECT deleted FROM post_storage_assets WHERE uri = ?', [uri])
  return Boolean(row?.deleted)
}

export async function deleteStorageAsset(uri) {
  await ensurePostStorage()
  const [[asset]] = await pool.execute('SELECT * FROM post_storage_assets WHERE uri = ?', [uri])
  if (asset?.deleted) return
  const key = hostedKey(uri, storageOrigin())
  if (key) {
    await hostedClient().send(new DeleteObjectCommand({ Bucket: process.env.HUP_STORAGE_BUCKET, Key: key }))
  } else if (/^ipfs:\/\/[A-Za-z0-9]+$/.test(uri)) {
    // RPC uploads are pinned by CID; large S3 uploads also have an object to delete.
    const [objects] = await pool.execute('SELECT object_key FROM post_storage_objects WHERE uri = ?', [uri])
    const keys = new Set(objects.map((object) => object.object_key))
    if (asset?.object_key) keys.add(asset.object_key)
    if (keys.size) {
      const client = new S3Client({
        endpoint: 'https://s3.filebase.io', region: 'auto', forcePathStyle: true,
        credentials: { accessKeyId: process.env.FILEBASE_S3_KEY, secretAccessKey: process.env.FILEBASE_S3_SECRET },
      })
      for (const objectKey of keys) {
        await client.send(new DeleteObjectCommand({ Bucket: process.env.FILEBASE_S3_BUCKET, Key: objectKey }))
      }
    }
    const { unpinFromFilebase } = await import('@/lib/filebase')
    await unpinFromFilebase(uri.slice(7))
  } else return
  await pool.execute(`INSERT INTO post_storage_assets (uri, provider, deleted) VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE deleted = 1`, [uri, key ? 'hosted' : 'ipfs'])
  if (!key) invalidateMedia(uri.slice(7))
}
