/**
 * @file app/api/mcp/route.js
 * @description Remote MCP endpoint: the read tools of the hup-mcp package served over
 * Streamable HTTP, stateless, so an agent can connect with a URL and no install.
 * Writes need a wallet key and stay in the local package.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createHttp } from '../../../../mcp/src/http.js'
import { registerReadTools } from '../../../../mcp/src/tools/read.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VERSION = '1.0.0'

const INSTRUCTIONS =
  'Read-only Hup tools. Posts are identified by (network_id, post_id) because every chain numbers posts from 1. To post, like, reply or follow, run the hup-mcp package locally with an agent wallet key; the guide is at https://hup.social/hup-skill.md.'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-session-id, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
}

/** Reads go back through this deployment's own public routes. */
const baseUrlFor = (request) => (process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '')

async function handle(request) {
  const server = new McpServer({ name: 'hup', version: VERSION }, { instructions: INSTRUCTIONS })
  registerReadTools(server, { http: createHttp(baseUrlFor(request)) })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value)
    return new Response(response.body, { status: response.status, headers })
  } finally {
    /* Stateless: nothing outlives the request. Close after the body has been produced. */
    Promise.resolve().then(() => transport.close()).catch(() => {})
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export { handle as GET, handle as POST, handle as DELETE }
