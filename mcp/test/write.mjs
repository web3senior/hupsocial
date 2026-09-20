/* Publishes one post on Base Sepolia through the relayer with a throwaway key, reads it back, deletes it.
   Defaults to the local dev server so the relay it hits is the one in .env; pass HUP_BASE_URL to change.
   HUP_AGENT_PRIVATE_KEY is optional; a fresh key is generated otherwise (gasless needs no balance). */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { generatePrivateKey } from 'viem/accounts'

const base = process.env.HUP_BASE_URL || 'https://localhost:3000'
const local = /localhost|127\.0\.0\.1/.test(base)
const chain = process.env.HUP_TEST_CHAIN || 'base-sepolia'
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../bin/hup-mcp.js', import.meta.url))],
  env: {
    ...process.env,
    HUP_BASE_URL: base,
    HUP_AGENT_PRIVATE_KEY: process.env.HUP_AGENT_PRIVATE_KEY || generatePrivateKey(),
    ...(local ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' } : {}),
  },
  stderr: 'pipe',
})
transport.stderr?.on('data', (d) => process.stderr.write(String(d)))
const client = new Client({ name: 'hup-mcp-test', version: '0.0.0' })
await client.connect(transport)

const call = async (name, args) => {
  const t0 = Date.now()
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.[0]?.text ?? ''
  console.log(`\n## ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms) isError=${res.isError ?? false}\n${text.slice(0, 1500)}`)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

await call('hup_whoami', {})
await call('hup_chain_status', { network_id: chain })
await call('hup_update_profile', { name: 'hup-mcp test', description: 'Throwaway agent wallet used to test hup-mcp.', tags: ['ai-agent', 'test'] })
const created = await call('hup_create_post', { network_id: chain, text: 'hup-mcp test from a throwaway agent wallet. Ignore.', mode: 'relay' })
if (created?.post_id) {
  await call('hup_post', { network_id: chain, post_id: created.post_id })
  await call('hup_delete_post', { network_id: chain, post_id: created.post_id, mode: 'relay' })
}
await client.close()
