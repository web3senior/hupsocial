/**
 * @file lib/agentMcp.js
 * @description Hosted agents read Hup through the Hup MCP server's read tools (mcp/src/tools/read.js),
 * the same set hup.social/api/mcp serves. Server-only.
 *
 * The server and a client are joined in memory, once per process, so a turn pays no network hop to
 * reach them; the tools themselves read this app's own public routes over loopback. MCP's write
 * tools are not offered: they sign with a key held where the server runs, and a hosted agent's key
 * never leaves its owner's browser. Writes stay cards the owner approves (lib/agentRuntime.js).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createHttp } from '../../mcp/src/http.js'
import { registerReadTools } from '../../mcp/src/tools/read.js'

// The reads an agent needs to follow what is said to it and about Hup; the rest stay unoffered
// so every turn's tool list stays short
const AGENT_MCP_TOOLS = new Set([
  'hup_notifications',
  'hup_comments',
  'hup_post',
  'hup_post_markdown',
  'hup_user_posts',
  'hup_profile',
  'hup_search_users',
  'hup_search_posts',
  'hup_feed',
])

// A tool result is resent with every later round of the turn, so it is cut to about 3,000 tokens
const RESULT_MAX_CHARS = 12_000

// The app reading its own public routes: loopback by default, where `next start` listens
const baseUrl = () => (process.env.AGENT_MCP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '')

// The links tools hand the agent end up in its replies, so they point at the public site, not loopback
const publicBaseUrl = () => (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/+$/, '')

/** One connected client per process, kept on globalThis so a dev reload never opens another. */
const connect = () => {
  globalThis.__hupAgentMcp ??= (async () => {
    const server = new McpServer({ name: 'hup', version: '1.0.0' })
    registerReadTools(server, { http: createHttp(baseUrl(), { publicBase: publicBaseUrl() }) })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'hup-agent', version: '1.0.0' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const { tools } = await client.listTools()
    return { client, tools: tools.filter((tool) => AGENT_MCP_TOOLS.has(tool.name)) }
  })().catch((error) => {
    globalThis.__hupAgentMcp = null
    throw error
  })
  return globalThis.__hupAgentMcp
}

/** The MCP read tools in the chat-completions shape, for one turn. Empty if MCP cannot start. */
export const agentMcpTools = async () => {
  try {
    const { tools } = await connect()
    return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema } }))
  } catch (error) {
    console.error('[AGENT_MCP_ERROR]: tools unavailable:', error?.message)
    return []
  }
}

export const isAgentMcpTool = (name) => AGENT_MCP_TOOLS.has(name)

/**
 * Runs one MCP read tool. Its text goes back to the model as data; an MCP error becomes an
 * `error` field, never a thrown turn.
 */
export const runAgentMcpTool = async (name, rawArgs) => {
  let args
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    return { error: 'Arguments were not valid JSON' }
  }
  try {
    const { client } = await connect()
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .slice(0, RESULT_MAX_CHARS)
    return result.isError ? { error: text || 'The tool failed' } : { result: text }
  } catch (error) {
    return { error: error?.message || 'The tool failed' }
  }
}
