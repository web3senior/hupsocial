/* Writes one post on Base Sepolia through the LOCAL dev server's relayer with a throwaway key, then deletes it. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { generatePrivateKey } from 'viem/accounts'

const key = process.env.HUP_AGENT_PRIVATE_KEY || generatePrivateKey()
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['C:/xampp/htdocs/hupsocial/mcp/bin/hup-mcp.js'],
  env: { ...process.env, HUP_BASE_URL: process.env.HUP_BASE_URL || 'https://localhost:3000', HUP_AGENT_PRIVATE_KEY: key, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  stderr: 'pipe',
})
transport.stderr?.on('data', (d) => process.stderr.write(String(d)))
const client = new Client({ name: 'smoke', version: '0.0.0' })
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
await call('hup_chain_status', { network_id: 'base-sepolia' })
await call('hup_update_profile', { name: 'hup-mcp smoke', description: 'Throwaway agent wallet used to test hup-mcp.', tags: ['ai-agent', 'test'] })
const created = await call('hup_create_post', { network_id: 84532, text: 'hup-mcp smoke test from a throwaway agent wallet. Ignore.', mode: 'relay' })
if (created?.post_id) {
  await call('hup_post', { network_id: 84532, post_id: created.post_id })
  await call('hup_delete_post', { network_id: 84532, post_id: created.post_id, mode: 'relay' })
}
await client.close()
