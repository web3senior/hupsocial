import { existsSync } from 'node:fs'
import mysql from 'mysql2/promise'

// Match Next's development env precedence without printing credentials.
for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}

if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST)) {
  throw new Error('Sample threads may only be seeded into a local database.')
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

const fixture = 'local-thread-connector-sample-v1'

try {
  await db.beginTransaction()
  const [[existing]] = await db.execute('SELECT id, network_id FROM posts WHERE metadata = ? AND is_comment IS NULL AND is_deleted = 0 LIMIT 1', [fixture])
  let root = existing

  if (!root) {
    const [[author]] = await db.query('SELECT network_id, contract_address, wallet_address FROM posts WHERE is_deleted = 0 AND is_repost IS NULL ORDER BY created_at DESC LIMIT 1')
    if (!author) throw new Error('An existing local post is required to select a network and author.')
    const [[last]] = await db.execute('SELECT MAX(id) AS id FROM posts WHERE network_id = ?', [author.network_id])
    const firstId = BigInt(last.id || 0) + 1n
    const texts = [
      'Local sample thread: connector layout test.\n\nThis longer opening post checks that the line follows the entire card, including the part counter, timestamp, and action row.\n\nResize the page to compare desktop and mobile spacing.',
      'A short middle post. The connector should stay centered beneath the avatar and continue toward the next part.',
      'End of the sample thread.\n\nThere should be no connector below this final avatar. This fixture only exists in the local database.',
    ]

    for (const [index, text] of texts.entries()) {
      const id = String(firstId + BigInt(index))
      const parent = index ? String(firstId + BigInt(index - 1)) : null
      const content = JSON.stringify({
        version: '1',
        elements: [{ type: 'text', data: { text } }, { type: 'media', data: { items: [] } }],
        thread: { part: index + 1, of: texts.length },
      })
      await db.execute(
        'INSERT INTO posts (id, network_id, contract_address, wallet_address, content_type, parent_id, is_comment, metadata, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
        [id, author.network_id, author.contract_address, author.wallet_address, index ? 1 : 0, parent, parent, fixture, content, index],
      )
    }
    root = { id: String(firstId), network_id: author.network_id }
  }

  await db.commit()
  console.log(`Sample thread: http://localhost:3000/networks/${root.network_id}/${root.id}`)
} catch (error) {
  await db.rollback()
  throw error
} finally {
  await db.end()
}
