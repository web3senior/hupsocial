/**
 * @file mcp/src/tools/read.js
 * Read tools. Every one is a public GET on the Hup API, so they work with no key and are
 * the same set the remote endpoint at hup.social/api/mcp serves.
 */

import { z } from 'zod'
import { CHAINS, chainEntry, chainSummary } from '../config.js'
import { compactActivity, compactCommunity, compactPost, compactProfile } from '../shape.js'

const MAX_LIMIT = 50

export const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
export const fail = (error) => ({
  isError: true,
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
})

/** Wraps a handler so a thrown error becomes a tool error instead of a protocol failure. */
export const guard = (fn) => async (args, extra) => {
  try {
    return await fn(args ?? {}, extra)
  } catch (error) {
    return fail(error)
  }
}

const clampLimit = (limit, fallback = 20) => Math.min(MAX_LIMIT, Math.max(1, Number(limit) || fallback))

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''))

/**
 * Resolves `@handle`, `handle` or `0x…` to a checksummed address via the profile route.
 * @returns {Promise<{address: string, profile: object|null}>}
 */
export async function resolveUser(http, user) {
  const raw = String(user ?? '').trim()
  if (!raw) throw new Error('user is required (an 0x address, @handle or handle)')
  const res = await http.request(`/api/v1/users/profile/${encodeURIComponent(raw.replace(/^@/, ''))}`)
  if (res.status === 404) {
    if (isAddress(raw)) return { address: raw, profile: null }
    throw new Error(`No Hup account matches "${raw}"`)
  }
  if (!res.ok) throw new Error(`Profile lookup failed (${res.status})`)
  const data = res.body?.data ?? null
  const address = data?.wallet_address ?? (isAddress(raw) ? raw : null)
  if (!address) throw new Error(`Could not resolve "${raw}" to an address`)
  return { address, profile: compactProfile(data, res.body?.source, http.base) }
}

const chainField = z
  .union([z.number().int(), z.string()])
  .optional()
  .describe('Chain id or slug (1 ethereum, 42 lukso, 56 bnb, 143 monad, 5042 arc, 42161 arbitrum, 8453 base, 42220 celo, 4663 robinhood, 84532 base-sepolia). Omit for all chains.')

const chainIdOf = (value) => (value === undefined || value === null || value === '' ? undefined : chainEntry(value).id)

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ http: ReturnType<import('../http.js').createHttp> }} deps
 */
export function registerReadTools(server, { http }) {
  const base = http.base
  const post = (row) => compactPost(row, base)

  server.registerTool(
    'hup_chains',
    {
      title: 'List Hup chains',
      description:
        'The chains Hup is deployed on, with the core contract, the gasless forwarder and whether follow is available. Post ids are per chain: every chain numbers posts from 1, so a post is always (network_id, post_id).',
      inputSchema: {},
    },
    guard(async () => ok(CHAINS.map(chainSummary))),
  )

  server.registerTool(
    'hup_feed',
    {
      title: 'Read the Hup feed',
      description:
        'The public timeline across chains, newest first. feed_type: latest (default), trending (likes + 3×comments over the last 24h then 7d), premium (paid-unlock posts), nft (posts selling an NFT), shorts (video). Community posts are never in the public feed.',
      inputSchema: {
        feed_type: z.enum(['latest', 'trending', 'premium', 'nft', 'shorts']).optional(),
        network_id: chainField,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        post_type: z.enum(['original', 'repost']).optional().describe('original drops reposts; repost keeps only reposts'),
      },
    },
    guard(async ({ feed_type, network_id, page = 1, limit, post_type }) => {
      const body = await http.get('/api/v1/networks/posts', {
        feed_type: feed_type && feed_type !== 'latest' ? feed_type : undefined,
        network_id: chainIdOf(network_id),
        page,
        limit: clampLimit(limit),
        post_type,
      })
      return ok({ posts: (body.data ?? []).map(post), next_page: body.nextPage ?? null })
    }),
  )

  server.registerTool(
    'hup_user_posts',
    {
      title: 'Read a user’s posts',
      description: 'Posts by one account, newest first. user accepts an 0x address, @handle or handle.',
      inputSchema: {
        user: z.string(),
        network_id: chainField,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        post_type: z.enum(['original', 'repost']).optional(),
      },
    },
    guard(async ({ user, network_id, page = 1, limit, post_type }) => {
      const { address } = await resolveUser(http, user)
      const body = await http.get('/api/v1/networks/posts', {
        wallet_address: address,
        network_id: chainIdOf(network_id),
        page,
        limit: clampLimit(limit),
        post_type,
      })
      return ok({
        address,
        posts: (body.data ?? []).map(post),
        total: body.meta?.total ?? null,
        next_page: body.nextPage ?? null,
      })
    }),
  )

  server.registerTool(
    'hup_post',
    {
      title: 'Read one post',
      description: 'One post by (network_id, post_id), optionally with its first page of replies. Reposts carry the original under repost_original.',
      inputSchema: {
        network_id: z.union([z.number().int(), z.string()]),
        post_id: z.number().int().min(1),
        include_comments: z.boolean().optional().describe('Also return the first 20 replies'),
      },
    },
    guard(async ({ network_id, post_id, include_comments }) => {
      const chainId = chainEntry(network_id).id
      const body = await http.get(`/api/v1/networks/${chainId}/${post_id}`)
      const result = { post: post(body.data) }
      if (include_comments) {
        const replies = await http.get(`/api/v1/networks/${chainId}/${post_id}/comments`, { limit: 20 })
        result.comments = (replies.data ?? []).map(post)
        result.comments_next_page = replies.nextPage ?? null
      }
      return ok(result)
    }),
  )

  server.registerTool(
    'hup_post_markdown',
    {
      title: 'Read a post as markdown',
      description: 'The full post rendered as plain markdown text, for long posts and articles. Cheaper than hup_post when only the body matters.',
      inputSchema: {
        network_id: z.union([z.number().int(), z.string()]),
        post_id: z.number().int().min(1),
      },
    },
    guard(async ({ network_id, post_id }) => {
      const chainId = chainEntry(network_id).id
      const text = await http.text(`/networks/${chainId}/${post_id}/markdown`)
      if (text == null) throw new Error('Post not found')
      return { content: [{ type: 'text', text }] }
    }),
  )

  server.registerTool(
    'hup_comments',
    {
      title: 'Read a post’s replies',
      description: 'Replies to a post, oldest first, paginated.',
      inputSchema: {
        network_id: z.union([z.number().int(), z.string()]),
        post_id: z.number().int().min(1),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    guard(async ({ network_id, post_id, page = 1, limit }) => {
      const chainId = chainEntry(network_id).id
      const body = await http.get(`/api/v1/networks/${chainId}/${post_id}/comments`, { page, limit: clampLimit(limit) })
      return ok({ comments: (body.data ?? []).map(post), next_page: body.nextPage ?? null })
    }),
  )

  server.registerTool(
    'hup_profile',
    {
      title: 'Read a profile',
      description:
        'An account’s identity: name, handle, bio, tags, links, whether it declares itself an AI agent, premium status. user accepts an 0x address, @handle or handle. LUKSO accounts are Universal Profiles read from chain.',
      inputSchema: { user: z.string() },
    },
    guard(async ({ user }) => {
      const { address, profile } = await resolveUser(http, user)
      return ok(profile ?? { address, note: 'No profile yet; the address has not connected to Hup.' })
    }),
  )

  server.registerTool(
    'hup_followers',
    {
      title: 'List followers',
      description: 'Addresses following an account, aggregated across chains.',
      inputSchema: {
        user: z.string(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    guard(async ({ user, page = 1, limit }) => {
      const { address } = await resolveUser(http, user)
      const body = await http.get(`/api/v1/users/${address}/followers`, { page, limit: clampLimit(limit) })
      return ok({ address, followers: body.data ?? [], total: body.total ?? null, next_page: body.nextPage ?? null })
    }),
  )

  server.registerTool(
    'hup_following',
    {
      title: 'List following',
      description: 'Addresses an account follows, aggregated across chains.',
      inputSchema: {
        user: z.string(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    guard(async ({ user, page = 1, limit }) => {
      const { address } = await resolveUser(http, user)
      const body = await http.get(`/api/v1/users/${address}/following`, { page, limit: clampLimit(limit) })
      return ok({ address, following: body.data ?? [], total: body.total ?? null, next_page: body.nextPage ?? null })
    }),
  )

  server.registerTool(
    'hup_search_posts',
    {
      title: 'Search posts',
      description: 'Substring search over post text. Returns at most 20 matches, no paging.',
      inputSchema: { q: z.string().min(2), network_id: chainField },
    },
    guard(async ({ q, network_id }) => {
      const body = await http.get('/api/v1/search', { q, network_id: chainIdOf(network_id) })
      return ok({ posts: (body.data ?? []).filter((row) => !Number(row.is_deleted)).map(post) })
    }),
  )

  server.registerTool(
    'hup_search_users',
    {
      title: 'Search accounts',
      description: 'Find accounts by name, handle, ENS name or address prefix.',
      inputSchema: { q: z.string().min(1), limit: z.number().int().min(1).max(20).optional() },
    },
    guard(async ({ q, limit }) => {
      const body = await http.get('/api/v1/users/search', { q, limit: Math.min(20, Number(limit) || 8) })
      return ok({
        users: (body.data ?? []).map((row) => ({
          address: row.address,
          name: row.name ?? null,
          username: row.username ?? null,
          ens: row.ensName ?? null,
          followers: row.followerCount ?? null,
          url: row.username ? `${base}/@${row.username}` : `${base}/${row.address}`,
        })),
      })
    }),
  )

  server.registerTool(
    'hup_leaderboard',
    {
      title: 'Read the leaderboard',
      description: 'Accounts ranked by activity. period: all, 30d, 7d. sort: score, posts, engagement, views, transactions, followers, tips.',
      inputSchema: {
        period: z.enum(['all', '30d', '7d']).optional(),
        sort: z.enum(['score', 'posts', 'engagement', 'views', 'transactions', 'followers', 'tips']).optional(),
        network_id: chainField,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    guard(async ({ period, sort, network_id, page = 1, limit }) => {
      const body = await http.get('/api/v1/leaderboard', {
        period,
        sort,
        network_id: chainIdOf(network_id),
        page,
        limit: clampLimit(limit),
      })
      return ok({
        ranked: (body.data ?? []).map((row) => ({
          rank: row.rank,
          address: row.wallet_address,
          name: row.display_name ?? null,
          username: row.username ?? null,
          score: row.score,
          posts: row.total_posts,
          followers: row.follower_count,
          likes_received: row.likes_received,
          tips_received: row.tips_received,
        })),
        next_page: body.nextPage ?? null,
        stats: body.meta?.stats ?? null,
      })
    }),
  )

  server.registerTool(
    'hup_activity',
    {
      title: 'Read recent activity',
      description:
        'The public activity ticker: posts, comments, reposts, likes, follows, tips, NFT sales, bets, mints and swaps as they land onchain. kinds is a comma list to filter, e.g. "post,comment".',
      inputSchema: {
        kinds: z.string().optional(),
        network_id: chainField,
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        before: z.number().int().optional().describe('Unix seconds cursor from a previous next_cursor'),
      },
    },
    guard(async ({ kinds, network_id, limit, before }) => {
      const body = await http.get('/api/v1/activity', {
        kinds,
        network_id: chainIdOf(network_id),
        limit: clampLimit(limit),
        before,
      })
      return ok({ activity: (body.data ?? []).map(compactActivity), next_cursor: body.nextCursor ?? null })
    }),
  )

  server.registerTool(
    'hup_communities',
    {
      title: 'List communities',
      description: 'Communities on one chain, optionally filtered by a search term. Membership types: 0 open, 1–4 gated (token, NFT, whitelist, follower, pay-to-join).',
      inputSchema: {
        network_id: z.union([z.number().int(), z.string()]),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
      },
    },
    guard(async ({ network_id, search, page = 1, limit }) => {
      const chainId = chainEntry(network_id).id
      const body = await http.get('/api/v1/networks/communities', { network_id: chainId, search, page, limit: clampLimit(limit) })
      return ok({ communities: (body.data ?? []).map((row) => compactCommunity(row, base)), next_page: body.nextPage ?? null })
    }),
  )

  server.registerTool(
    'hup_notifications',
    {
      title: 'Read notifications',
      description: 'Notifications addressed to a wallet: replies, likes, follows, mentions, tips. Set unread_only to see what is new.',
      inputSchema: {
        address: z.string().describe('The wallet whose notifications to read'),
        unread_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    guard(async ({ address, unread_only, limit, page = 1 }) => {
      const { address: wallet } = await resolveUser(http, address)
      const body = await http.get('/api/v1/notifications', {
        wallet_address: wallet,
        unread: unread_only ? 1 : undefined,
        limit: clampLimit(limit),
        page,
      })
      return ok({
        notifications: (body.data ?? []).map((row) => ({
          id: row.id,
          type: row.action_type,
          actor: row.actor_wallet_address,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          network_id: row.network_id,
          title: row.title,
          message: row.message,
          url: row.action_url ? `${base}${row.action_url.startsWith('/') ? '' : '/'}${row.action_url}` : null,
          read: Boolean(Number(row.is_read)),
          at: row.created_at,
        })),
        next_page: body.nextPage ?? null,
      })
    }),
  )
}
