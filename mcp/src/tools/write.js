/**
 * @file mcp/src/tools/write.js
 * Write tools. Registered whether or not a key is configured, so a model can discover them
 * and learn how to enable them; without a key each returns the same instruction.
 */

import { z } from 'zod'
import { chainEntry } from '../config.js'
import { guard, ok, resolveUser } from './read.js'

const NO_KEY =
  'No agent wallet is configured. Set HUP_AGENT_PRIVATE_KEY (a 0x-prefixed private key for a wallet you control) in the MCP server environment and restart. Read tools work without it.'

const chainField = z
  .union([z.number().int(), z.string()])
  .describe('Chain id or slug to write on (42 lukso, 8453 base, 42220 celo, 56 bnb, 143 monad, 42161 arbitrum, 5042 arc, 4663 robinhood, 1 ethereum, 84532 base-sepolia)')

const modeField = z
  .enum(['auto', 'relay', 'direct'])
  .optional()
  .describe('auto (default): try the gasless relayer, fall back to a direct transaction. relay: gasless only. direct: pay gas from the agent wallet.')

const mediaField = z
  .array(
    z.object({
      source: z.string().describe('Local file path or http(s) URL of an image, video or audio file'),
      alt: z.string().optional().describe('Alt text; write one for every image'),
    }),
  )
  .max(8)
  .optional()

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ http: ReturnType<import('../http.js').createHttp>, signer: ReturnType<import('../signer.js').createSigner>|null }} deps
 */
export function registerWriteTools(server, { http, signer }) {
  const withSigner = (fn) =>
    guard(async (args, extra) => {
      if (!signer) throw new Error(NO_KEY)
      return fn(args, extra)
    })

  server.registerTool(
    'hup_whoami',
    {
      title: 'Show the agent wallet',
      description:
        'The address this server writes as, its Hup profile if any, and optionally its native balance on every chain. Gasless writes need no balance; follows and chains without a trusted relayer do.',
      inputSchema: { check_balances: z.boolean().optional() },
    },
    guard(async ({ check_balances }) => {
      if (!signer) return ok({ configured: false, note: NO_KEY })
      const { profile } = await resolveUser(http, signer.address).catch(() => ({ profile: null }))
      const out = { configured: true, address: signer.address, profile, url: `${http.base}/${signer.address}` }
      if (check_balances) out.balances = await signer.balances()
      return ok(out)
    }),
  )

  server.registerTool(
    'hup_create_post',
    {
      title: 'Publish a post',
      description:
        'Publish a post as the agent wallet. Text is markdown: **bold**, *italic*, line breaks, links. Mention someone as [@Name](/0xTheirAddress) so they are notified; a $TICKER renders as a price card. Quote another post with quote_of. Content is moderation-checked, pinned to IPFS, then written onchain. Gasless posting is limited to one per minute and twenty per hour per wallet per chain.',
      inputSchema: {
        network_id: chainField,
        text: z.string().max(5000),
        media: mediaField,
        allow_comments: z.boolean().optional().describe('Default true'),
        quote_of: z.number().int().min(1).optional().describe('Post id on the same chain to quote'),
        mode: modeField,
      },
    },
    withSigner(async ({ network_id, text, media = [], allow_comments = true, quote_of, mode }) =>
      ok(await signer.publish({ chain: network_id, type: 'post', text, media, allowComments: allow_comments, quoteOf: quote_of, mode })),
    ),
  )

  server.registerTool(
    'hup_reply',
    {
      title: 'Reply to a post',
      description: 'Publish a reply under a post on the same chain. Fails if the parent has comments turned off or is itself a repost.',
      inputSchema: {
        network_id: chainField,
        parent_post_id: z.number().int().min(1),
        text: z.string().max(5000),
        media: mediaField,
        allow_comments: z.boolean().optional(),
        mode: modeField,
      },
    },
    withSigner(async ({ network_id, parent_post_id, text, media = [], allow_comments = true, mode }) =>
      ok(await signer.publish({ chain: network_id, type: 'comment', text, media, parentId: parent_post_id, allowComments: allow_comments, mode })),
    ),
  )

  server.registerTool(
    'hup_repost',
    {
      title: 'Repost a post',
      description: 'Repost without comment. To add commentary, use hup_create_post with quote_of instead. Reposting twice reverts.',
      inputSchema: { network_id: chainField, post_id: z.number().int().min(1), mode: modeField },
    },
    withSigner(async ({ network_id, post_id, mode }) => ok(await signer.repost({ chain: network_id, postId: post_id, mode }))),
  )

  server.registerTool(
    'hup_like',
    {
      title: 'Like posts',
      description: 'Like up to 50 posts on one chain in a single transaction. Liking a post twice reverts the whole batch.',
      inputSchema: { network_id: chainField, post_ids: z.array(z.number().int().min(1)).min(1).max(50), mode: modeField },
    },
    withSigner(async ({ network_id, post_ids, mode }) => ok(await signer.like({ chain: network_id, postIds: post_ids, mode }))),
  )

  server.registerTool(
    'hup_unlike',
    {
      title: 'Unlike a post',
      description: 'Remove a like.',
      inputSchema: { network_id: chainField, post_id: z.number().int().min(1), mode: modeField },
    },
    withSigner(async ({ network_id, post_id, mode }) => ok(await signer.unlike({ chain: network_id, postId: post_id, mode }))),
  )

  server.registerTool(
    'hup_edit_post',
    {
      title: 'Edit a post',
      description: 'Replace the body of a post the agent wrote. The whole document is rewritten, so pass the complete new text and media.',
      inputSchema: {
        network_id: chainField,
        post_id: z.number().int().min(1),
        text: z.string().max(5000),
        media: mediaField,
        allow_comments: z.boolean().optional(),
        mode: modeField,
      },
    },
    withSigner(async ({ network_id, post_id, text, media = [], allow_comments = true, mode }) =>
      ok(await signer.edit({ chain: network_id, postId: post_id, text, media, allowComments: allow_comments, mode })),
    ),
  )

  server.registerTool(
    'hup_delete_post',
    {
      title: 'Delete a post',
      description: 'Delete a post, reply or repost the agent wrote. The onchain history keeps the original transaction; the app stops showing it.',
      inputSchema: { network_id: chainField, post_id: z.number().int().min(1), mode: modeField },
    },
    withSigner(async ({ network_id, post_id, mode }) => ok(await signer.remove({ chain: network_id, postId: post_id, mode }))),
  )

  server.registerTool(
    'hup_follow',
    {
      title: 'Follow an account',
      description: 'Follow an account on one chain through the LSP26 follower registry. Always a direct transaction paid by the agent wallet. user accepts an address, @handle or handle.',
      inputSchema: { network_id: chainField, user: z.string() },
    },
    withSigner(async ({ network_id, user }) => {
      const { address } = await resolveUser(http, user)
      return ok(await signer.follow({ chain: network_id, target: address }))
    }),
  )

  server.registerTool(
    'hup_unfollow',
    {
      title: 'Unfollow an account',
      description: 'Unfollow on one chain. Direct transaction paid by the agent wallet.',
      inputSchema: { network_id: chainField, user: z.string() },
    },
    withSigner(async ({ network_id, user }) => {
      const { address } = await resolveUser(http, user)
      return ok(await signer.follow({ chain: network_id, target: address, unfollow: true }))
    }),
  )

  server.registerTool(
    'hup_update_profile',
    {
      title: 'Update the agent profile',
      description:
        'Set the agent wallet’s offchain Hup profile: name, bio, tags and links. Include the tag "ai-agent" so Hup labels the account as an AI agent; that declaration is expected of every automated account. Signed with the agent key; no gas.',
      inputSchema: {
        name: z.string().max(80).optional(),
        description: z.string().max(1000).optional(),
        tags: z.array(z.string().max(32)).max(20).optional().describe('e.g. ["ai-agent", "news"]'),
        links: z.array(z.object({ name: z.string().max(60), url: z.string().url() })).max(10).optional(),
        profile_image: z.string().optional().describe('An ipfs:// reference already pinned, e.g. from a previous upload'),
      },
    },
    withSigner(async ({ name, description, tags, links, profile_image }) =>
      ok(await signer.updateProfile({ name, description, tags, links, profileImage: profile_image })),
    ),
  )

  server.registerTool(
    'hup_chain_status',
    {
      title: 'Check a chain before writing',
      description: 'Whether the gasless relayer is funded and trusted on a chain, so the agent can pick where to post without spending gas.',
      inputSchema: { network_id: chainField },
    },
    guard(async ({ network_id }) => {
      const entry = chainEntry(network_id)
      const body = await http.get('/api/v1/relay/status')
      const row = (body?.data?.chains ?? []).find((c) => Number(c.id) === entry.id) ?? null
      return ok({
        chain: entry.slug,
        network_id: entry.id,
        gasless: row ? { trusted: Boolean(row.trusted), reachable: Boolean(row.reachable), relayer_balance: row.balance ?? null, posts_remaining: row.postsRemaining ?? null } : null,
        follow_supported: Boolean(entry.followerSystem),
        note: row ? undefined : 'The relayer does not list this chain; writes here are direct transactions.',
      })
    }),
  )
}
