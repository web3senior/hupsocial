import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { S3Client } from '@aws-sdk/client-s3'
import pool from '@/lib/db'
import { collectStorageReferences, hostedKey } from '@/lib/postStorage'
import { cleanDeletedPost, queuePostCleanup } from '@/lib/postStorageCleanup'
import { hostedClient } from '@/lib/postStorageServer'
import { unpinFromFilebase } from '@/lib/filebase'
import { fetchArticleBody } from '@/lib/article'

const cid = `ipfs://Qm${'a'.repeat(44)}`
const origin = 'https://hup.social'
const hosted = `${origin}/api/post-storage/files/12345678-1234-1234-1234-123456789abc.json`
const originalExecute = pool.execute
const originalSend = S3Client.prototype.send
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
let calls
let unpinned
let deleted
let job
let post
let shared
let scheduled
let failUnpin
let profileReference
let objectKeys

beforeEach(() => {
  calls = []
  unpinned = []
  deleted = []
  post = { metadata: cid, content: JSON.stringify({ elements: [{ type: 'media', data: { items: [{ cid: hosted, poster: cid }] } }] }), is_deleted: 0 }
  job = { refs: JSON.stringify([cid, hosted]), is_deleted: 1, completed: 0 }
  shared = false
  scheduled = false
  failUnpin = false
  profileReference = false
  objectKeys = []
  process.env.FILEBASE_IPFS_RPC_TOKEN = 'test-token'
  process.env.HUP_STORAGE_BUCKET = 'hosted-test'
  process.env.HUP_STORAGE_KEY = 'test-key'
  process.env.HUP_STORAGE_SECRET = 'test-secret'
  process.env.HUP_STORAGE_ORIGIN = origin
  pool.execute = async (sql, args = []) => {
    calls.push({ sql, args })
    if (sql.includes('SELECT metadata, content')) return [[post].filter(Boolean)]
    if (sql.includes('SELECT c.*, p.is_deleted')) return [[job].filter(Boolean)]
    if (sql.includes('SELECT 1 FROM posts')) return [shared ? [{}] : []]
    if (sql.includes('information_schema.TABLES')) return [[{}]]
    if (sql.includes('SELECT 1 FROM scheduled_posts')) return [scheduled ? [{}] : []]
    if (sql.includes('information_schema.COLUMNS')) return [[{ TABLE_NAME: 'users', COLUMN_NAME: 'profileImage' }]]
    if (sql.includes('SELECT 1 FROM users')) return [profileReference ? [{}] : []]
    if (sql.includes('SELECT object_key FROM post_storage_objects')) return [objectKeys.map((object_key) => ({ object_key }))]
    if (sql.includes('SELECT * FROM post_storage_assets')) return [[{ deleted: 0 }]]
    return [[]]
  }
  S3Client.prototype.send = async (command) => { deleted.push(command.input); return {} }
  globalThis.fetch = async (url) => {
    unpinned.push(url)
    return new Response(failUnpin ? 'denied' : '{}', { status: failUnpin ? 403 : 200 })
  }
})

after(async () => {
  pool.execute = originalExecute
  S3Client.prototype.send = originalSend
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  await pool.end()
})

test('collects nested media and posters, deduplicates, ignores external URLs', () => {
  assert.deepEqual(collectStorageReferences({ metadata: cid, media: [cid, hosted, 'https://example.com/photo.png'] }), [cid, hosted])
})

test('hosted references reject other origins, credentials and query strings', () => {
  assert.equal(hostedKey(hosted, origin), '12345678-1234-1234-1234-123456789abc.json')
  for (const uri of [hosted.replace(origin, 'https://evil.test'), hosted + '?x=1', hosted.replace('https://', 'https://user@'), `${origin}/api/post-storage/files/../private`]) {
    assert.equal(hostedKey(uri, origin), null)
  }
})

test('hosted articles load without caching and are unavailable after deletion', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, hosted)
    assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'error')
    return Response.json({ markdown: '# Article' })
  }
  assert.equal(await fetchArticleBody(hosted), '# Article')
  globalThis.fetch = async () => new Response(null, { status: 410 })
  assert.equal(await fetchArticleBody(hosted), null)
})

test('article bodies cannot fetch arbitrary web URLs', async () => {
  let requests = 0
  globalThis.fetch = async () => { requests++; return Response.json({ markdown: 'unsafe' }) }
  assert.equal(await fetchArticleBody('http://127.0.0.1/admin'), null)
  assert.equal(requests, 0)
})

test('queue snapshots trusted metadata and nested attachments', async () => {
  assert.equal(await queuePostCleanup(42, '1'), true)
  const insert = calls.find(({ sql }) => sql.includes('INSERT IGNORE INTO post_storage_cleanup'))
  assert.deepEqual(JSON.parse(insert.args[2]), [cid, hosted])
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
})

test('unknown posts cannot create cleanup jobs', async () => {
  post = null
  assert.equal(await queuePostCleanup(42, '999'), false)
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT IGNORE INTO post_storage_cleanup')), false)
})

test('independent NFT and app attachment assets are not cleanup targets', async () => {
  post.content = JSON.stringify({ nftDrop: { image: hosted }, miniApp: { logo: hosted } })
  await queuePostCleanup(42, '1')
  const insert = calls.find(({ sql }) => sql.includes('INSERT IGNORE INTO post_storage_cleanup'))
  assert.deepEqual(JSON.parse(insert.args[2]), [cid])
})

test('live or reverted posts never delete storage', async () => {
  job.is_deleted = 0
  assert.deepEqual(await cleanDeletedPost(42, '1'), { pending: true })
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE posts')), false)
})

test('confirmed deletion unpins IPFS, deletes hosted files and clears indexed content', async () => {
  assert.deepEqual(await cleanDeletedPost(42, '1'), { completed: true })
  assert.equal(unpinned.length, 1)
  assert.equal(deleted.length, 1)
  assert.equal(deleted[0].Bucket, 'hosted-test')
  assert.ok(calls.some(({ sql }) => sql.includes('UPDATE posts SET content = NULL')))
})

test('active posts retain shared files', async () => {
  shared = true
  await cleanDeletedPost(42, '1')
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
})

test('scheduled posts retain shared files', async () => {
  scheduled = true
  await cleanDeletedPost(42, '1')
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
})

test('profile assets survive deletion of a post embedding them', async () => {
  profileReference = true
  await cleanDeletedPost(42, '1')
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
})

test('duplicate S3 uploads of a CID all get removed', async () => {
  objectKeys = ['uploads/first.jpg', 'uploads/second.jpg']
  process.env.FILEBASE_S3_BUCKET = 'ipfs-test'
  await cleanDeletedPost(42, '1')
  assert.deepEqual(deleted.filter((object) => object.Bucket === 'ipfs-test').map((object) => object.Key), objectKeys)
})

test('Filebase failures remain retryable and never complete the job', async () => {
  failUnpin = true
  await assert.rejects(cleanDeletedPost(42, '1'), /unpin failed/)
  assert.ok(calls.some(({ sql }) => sql.includes('last_error = ?')))
  assert.equal(calls.some(({ sql }) => sql.includes('completed = 1')), false)
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE posts')), false)
})

test('completed jobs are idempotent', async () => {
  job.completed = 1
  await cleanDeletedPost(42, '1')
  assert.equal(unpinned.length, 0)
  assert.equal(deleted.length, 0)
})

test('hosted mode cannot reuse the configured IPFS bucket', () => {
  process.env.FILEBASE_S3_BUCKET = 'hosted-test'
  assert.throws(() => hostedClient(), /not configured|separate non-IPFS bucket/)
})

test('an already unpinned CID is a successful retry; auth failures are not', async () => {
  globalThis.fetch = async () => new Response('not pinned or pinned indirectly', { status: 500 })
  await unpinFromFilebase(cid.slice(7))
  globalThis.fetch = async () => new Response('not pinned', { status: 403 })
  await assert.rejects(unpinFromFilebase(cid.slice(7)), /403/)
})
