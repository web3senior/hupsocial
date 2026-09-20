/* Drives every read tool through a real MCP client over stdio. No key needed.
   HUP_BASE_URL=https://localhost:3000 node mcp/test/read.mjs  (dev server; self-signed cert is tolerated) */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const base = process.env.HUP_BASE_URL || 'https://hup.social'
const local = /localhost|127\.0\.0\.1/.test(base)
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../bin/hup-mcp.js', import.meta.url))],
  env: { ...process.env, HUP_BASE_URL: base, ...(local ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' } : {}) },
  stderr: 'pipe',
})
const client = new Client({ name: 'hup-mcp-test', version: '0.0.0' })
await client.connect(transport)
const { tools } = await client.listTools()
console.log('tools:', tools.map((t) => t.name).join(', '))

const call = async (name, args, slice = 600) => {
  const t0 = Date.now()
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.[0]?.text ?? ''
  console.log(`\n## ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms) isError=${res.isError ?? false}\n${text.slice(0, slice)}`)
  return text
}

await call('hup_chains', {}, 300)
const feed = JSON.parse(await call('hup_feed', { limit: 2 }))
const first = feed.posts?.[0]
if (first) {
  await call('hup_post', { network_id: first.network_id, post_id: first.id, include_comments: true })
  await call('hup_post_markdown', { network_id: first.network_id, post_id: first.id }, 300)
  await call('hup_comments', { network_id: first.network_id, post_id: first.id, limit: 1 }, 300)
  await call('hup_profile', { user: first.author })
  await call('hup_user_posts', { user: first.author, limit: 1 }, 300)
  await call('hup_followers', { user: first.author, limit: 3 }, 300)
  await call('hup_following', { user: first.author, limit: 3 }, 300)
  await call('hup_notifications', { address: first.author, limit: 2 }, 400)
  await call('hup_communities', { network_id: first.network_id, limit: 2 }, 400)
}
await call('hup_feed', { feed_type: 'trending', limit: 1 }, 300)
await call('hup_search_posts', { q: 'hup' }, 300)
await call('hup_search_users', { q: 'a', limit: 3 }, 400)
await call('hup_leaderboard', { limit: 2, period: '7d' }, 400)
await call('hup_activity', { limit: 2, kinds: 'post,like' }, 400)
await call('hup_chain_status', { network_id: 'lukso' }, 300)
await call('hup_whoami', {}, 300)
await call('hup_feed', { network_id: 'nope' }, 300)
await client.close()
