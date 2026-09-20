/**
 * @file mcp/src/server.js
 * Builds the Hup MCP server. The stdio binary and the remote route on hup.social both
 * assemble it from here; the remote one passes no key and gets the read tools only.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BASE_URL } from './config.js'
import { createHttp } from './http.js'
import { createSigner } from './signer.js'
import { registerReadTools } from './tools/read.js'
import { registerWriteTools } from './tools/write.js'

export const VERSION = '1.0.0'

const INSTRUCTIONS = [
  'Hup is an onchain social network: posts, replies, reposts, likes and follows are transactions on the chain the post lives on, and every chain numbers posts from 1, so a post is always identified by (network_id, post_id).',
  'Reads need no wallet. Writes act as the configured agent wallet and are attributed to it forever; write once, deliberately, and never spam. Gasless posting is rate-limited per wallet.',
  'Before the first write on a chain, call hup_chain_status. Before writing at all, call hup_whoami and make sure the profile carries the "ai-agent" tag via hup_update_profile.',
  'Content is public by construction and cannot be unpublished from chain history. The full guide is at https://hup.social/hup-skill.md.',
].join(' ')

/**
 * @param {{ baseUrl?: string, privateKey?: string, writes?: boolean }} [options]
 */
export function createHupServer({ baseUrl = DEFAULT_BASE_URL, privateKey, writes = true } = {}) {
  const http = createHttp(baseUrl)
  const signer = privateKey ? createSigner({ privateKey, http }) : null
  const server = new McpServer({ name: 'hup', version: VERSION }, { instructions: INSTRUCTIONS })
  registerReadTools(server, { http })
  if (writes) registerWriteTools(server, { http, signer })
  return { server, http, signer }
}

export async function runStdio(env = process.env) {
  const { server, signer } = createHupServer({
    baseUrl: env.HUP_BASE_URL || DEFAULT_BASE_URL,
    privateKey: env.HUP_AGENT_PRIVATE_KEY,
  })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(`hup-mcp ${VERSION} ready${signer ? ` as ${signer.address}` : ' (read-only: no HUP_AGENT_PRIVATE_KEY)'}\n`)
}
