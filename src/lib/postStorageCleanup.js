import pool from '@/lib/db'
import { collectStorageReferences } from '@/lib/postStorage'
import { deleteStorageAsset, ensurePostStorage } from '@/lib/postStorageServer'

async function usedOutsidePosts(needle) {
  // A post can embed an existing avatar, community cover or app logo. Removing
  // that post must not unpin the original asset belonging to another surface.
  const [columns] = await pool.execute(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND (
      (TABLE_NAME = 'users' AND COLUMN_NAME IN ('profileImage', 'profileHeader')) OR
      (TABLE_NAME = 'communities' AND COLUMN_NAME IN ('logo_url', 'cover_url', 'metadata')) OR
      (TABLE_NAME = 'apps' AND COLUMN_NAME IN ('logo', 'metadata_cid'))
    )`)
  const allowed = {
    users: ['profileImage', 'profileHeader'],
    communities: ['logo_url', 'cover_url', 'metadata'],
    apps: ['logo', 'metadata_cid'],
  }
  for (const [table, names] of Object.entries(allowed)) {
    const present = names.filter((name) => columns.some((column) => column.TABLE_NAME === table && column.COLUMN_NAME === name))
    if (!present.length) continue
    const [[row]] = await pool.execute(`SELECT 1 FROM ${table} WHERE ${present.map((name) => `INSTR(BINARY ${name}, BINARY ?) > 0`).join(' OR ')} LIMIT 1`, present.map(() => needle))
    if (row) return true
  }
  return false
}

// Requests carry only a post identity. References always come from the indexer's
// trusted row, never a caller-supplied CID or a claimed wallet address.
export async function queuePostCleanup(networkId, postId) {
  await ensurePostStorage()
  const [[post]] = await pool.execute('SELECT metadata, content, is_deleted FROM posts WHERE network_id = ? AND id = ? LIMIT 1', [networkId, postId])
  if (!post) return false
  let content = post.content
  try { content = JSON.parse(content) } catch { /* Already parsed, or legacy text. */ }
  // Only post-owned content: attachment descriptors (NFTs, apps, polls, etc.)
  // can point to independently published assets and are not deletion targets.
  const media = content?.elements?.filter((element) => element?.type === 'media') ?? []
  const refs = collectStorageReferences({ metadata: post.metadata, media, article: content?.article })
  await pool.execute(`INSERT IGNORE INTO post_storage_cleanup (network_id, post_id, refs) VALUES (?, ?, ?)`, [networkId, postId, JSON.stringify(refs)])
  if (!Number(post.is_deleted)) {
    await pool.execute('UPDATE post_storage_cleanup SET refs = ? WHERE network_id = ? AND post_id = ? AND completed = 0', [JSON.stringify(refs), networkId, postId])
  }
  return true
}

export async function cleanDeletedPost(networkId, postId) {
  await ensurePostStorage()
  const [[job]] = await pool.execute(`SELECT c.*, p.is_deleted FROM post_storage_cleanup c
    JOIN posts p ON p.network_id = c.network_id AND p.id = c.post_id
    WHERE c.network_id = ? AND c.post_id = ? LIMIT 1`, [networkId, postId])
  if (!job || !Number(job.is_deleted)) return { pending: true }
  if (job.completed) return { completed: true }
  try {
    for (const uri of JSON.parse(job.refs)) {
      const needle = uri.startsWith('ipfs://') ? uri.slice(7) : uri
      const [[shared]] = await pool.execute(`SELECT 1 FROM posts
        WHERE is_deleted = 0 AND (INSTR(BINARY metadata, BINARY ?) > 0 OR INSTR(BINARY content, BINARY ?) > 0) LIMIT 1`, [needle, needle])
      if (shared) continue
      if (await usedOutsidePosts(needle)) continue
      // Queued scheduled posts are also live references.
      const [[scheduledTable]] = await pool.execute(`SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_posts' LIMIT 1`)
      if (scheduledTable) {
        const [[scheduled]] = await pool.execute(`SELECT 1 FROM scheduled_posts WHERE status IN ('scheduled', 'sending') AND (INSTR(BINARY metadata, BINARY ?) > 0 OR INSTR(BINARY content, BINARY ?) > 0) LIMIT 1`, [needle, needle])
        if (scheduled) continue
      }
      await deleteStorageAsset(uri)
    }
    // A scheduled post retains a preview after being sent. Clear that copy too,
    // but never touch a still-pending publication using the same document.
    const [[scheduledTable]] = await pool.execute(`SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_posts' LIMIT 1`)
    if (scheduledTable) {
      await pool.execute(`UPDATE scheduled_posts s JOIN posts p ON BINARY s.metadata = BINARY p.metadata
        SET s.content = '{}'
        WHERE p.network_id = ? AND p.id = ? AND p.is_deleted = 1 AND s.status NOT IN ('scheduled', 'sending')`, [networkId, postId])
    }
    // Retain the tombstone and blockchain provenance, remove Hup's indexed copy.
    await pool.execute('UPDATE posts SET content = NULL, metadata = NULL WHERE network_id = ? AND id = ? AND is_deleted = 1', [networkId, postId])
    await pool.execute('UPDATE post_storage_cleanup SET completed = 1, refs = ?, last_error = NULL WHERE network_id = ? AND post_id = ?', ['[]', networkId, postId])
    return { completed: true }
  } catch (error) {
    await pool.execute('UPDATE post_storage_cleanup SET last_error = ? WHERE network_id = ? AND post_id = ?', [error.message.slice(0, 1000), networkId, postId])
    throw error
  }
}

export async function processPostCleanupJobs() {
  await ensurePostStorage()
  const [jobs] = await pool.execute(`SELECT c.network_id, c.post_id FROM post_storage_cleanup c
    JOIN posts p ON p.network_id = c.network_id AND p.id = c.post_id
    WHERE c.completed = 0 AND p.is_deleted = 1 ORDER BY c.updated_at LIMIT 10`)
  const results = []
  for (const job of jobs) {
    try { results.push(await cleanDeletedPost(job.network_id, job.post_id)) }
    catch (error) { results.push({ error: error.message }) }
  }
  return results
}
