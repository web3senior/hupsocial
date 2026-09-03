import { getProfile } from '@/lib/api'
import { isWalletAddress, normalizeAddress } from '@/lib/address'
import pool from '@/lib/db'
import { summarizePost } from '@/lib/postSummary'

/**
 * @file (user)/[wallet]/llms.txt/route.js
 * @description One account, rendered for a language model: identity, activity totals, and the
 * last handful of posts, as plain text.
 *
 * The profile page is a client-rendered shell. An agent that lands on it either runs the
 * JavaScript or leaves with the boilerplate, which is why Google keeps quoting UI chrome back
 * at us. This is the same account as a few hundred tokens an agent can read directly, and it
 * follows the site-wide /llms.txt convention rather than inventing a second one.
 */

/* A profile changes on the order of days; the posts under it, hours. Crawlers are the whole
   audience here, and none of them need a live read. */
export const revalidate = 300

/* Enough for a model to characterise an account without the file becoming the account's archive. */
const RECENT_POST_LIMIT = 20

/* Roughly a tweet: long enough to carry a thought, short enough that twenty of them stay cheap. */
const POST_SUMMARY_MAX = 160

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || 'https://hup.social').replace(/\/$/, '')

/** Stored JSON list columns come back as text; the LUKSO indexer's own fields are already arrays. */
function asList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Collapses a bio to the single line a blockquote and a meta description can both hold. */
function oneLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/**
 * Counts, chains, and recent posts in one batch.
 *
 * Returns nulls rather than throwing: a profile whose totals failed to load is still worth
 * serving, and this route must never be the reason an agent gets a 500 instead of an identity.
 */
async function fetchActivity(address) {
  try {
    const [[[posts]], [[followers]], [[following]], [networks], [recent]] = await Promise.all([
      pool.execute('SELECT COUNT(*) AS total FROM posts WHERE wallet_address = ? AND is_deleted = 0', [address]),
      pool.execute(
        'SELECT COUNT(DISTINCT follower_address) AS total FROM follows WHERE followed_address = ? AND is_following = 1',
        [address],
      ),
      pool.execute(
        'SELECT COUNT(DISTINCT followed_address) AS total FROM follows WHERE follower_address = ? AND is_following = 1',
        [address],
      ),
      pool.execute(
        `SELECT DISTINCT n.name
         FROM posts p JOIN networks n ON p.network_id = n.id
         WHERE p.wallet_address = ? AND p.is_deleted = 0
         ORDER BY n.name ASC`,
        [address],
      ),
      /* Reposts carry no words of their own — twenty of them would describe the accounts this
         one amplifies rather than this one. */
      pool.execute(
        `SELECT p.id, p.network_id, p.created_at, p.content, p.nft_listing_id
         FROM posts p
         WHERE p.wallet_address = ? AND p.is_deleted = 0 AND (p.is_repost IS NULL OR p.is_repost = 0)
         ORDER BY p.created_at DESC
         LIMIT ${RECENT_POST_LIMIT}`,
        [address],
      ),
    ])

    return {
      posts: Number(posts?.total ?? 0),
      followers: Number(followers?.total ?? 0),
      following: Number(following?.total ?? 0),
      networks: networks.map((row) => row.name),
      recent,
    }
  } catch (error) {
    console.error('[profile llms.txt] could not read activity:', error.message)
    return null
  }
}

/** Plain text on the way out, including when there is nothing to say. */
function notFound() {
  return new Response('Profile not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/** One post as a dated line an agent can quote and follow. */
function renderPost(row) {
  let content = row.content
  try {
    content = JSON.parse(row.content)
  } catch {
    /* A body that never parsed is a body summarizePost will describe instead of quote. */
  }

  const summary = summarizePost({ ...row, content }, POST_SUMMARY_MAX)
  const date = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : 'undated'
  return `- ${date} — ${summary} (${BASE_URL}/networks/${row.network_id}/${row.id})`
}

export async function GET(request, { params }) {
  const { wallet } = await params

  let response = null
  try {
    response = await getProfile(wallet)
  } catch (error) {
    console.error('[profile llms.txt] profile fetch failed:', error.message)
  }

  const profile = response?.data ?? null
  if (!profile) return notFound()

  const address = normalizeAddress(profile.wallet_address || wallet)
  const activity = isWalletAddress(address) ? await fetchActivity(address) : null

  const bio = oneLine(profile.description)
  const tags = asList(profile.tags).filter((tag) => typeof tag === 'string' && tag.trim() !== '')
  const links = asList(profile.links).filter((link) => link?.url)

  /* Loading a profile writes its users row, so nearly every address ever viewed has one — blank.
     Answering for those would hand a crawler an unbounded supply of empty pages, one per address
     in existence. An account is only described here once it has said or done something. */
  const hasIdentity = Boolean(profile.name || bio || tags.length > 0 || links.length > 0)
  const hasActivity = Boolean(activity && (activity.posts > 0 || activity.followers > 0 || activity.following > 0))
  if (!hasIdentity && !hasActivity) return notFound()

  const lines = [`# ${profile.name || address}`, '']

  if (bio) lines.push(`> ${bio}`, '')

  lines.push(
    `One account on Hup, a decentralized social network where posts, follows, and likes are`,
    `smart-contract writes across nine EVM chains. For the protocol itself, read ${BASE_URL}/llms.txt.`,
    '',
    '## Identity',
    '',
    `- Profile: ${BASE_URL}/${address}`,
    `- Address: ${address}`,
  )

  /* Only ever asserted, never denied: the LUKSO indexer answering with nothing is indistinguishable
     here from an account that is genuinely an EOA, and guessing wrong misdescribes the account. */
  if (response?.source === 'universal_profile') {
    lines.push('- Account type: LUKSO Universal Profile (an LSP0 smart-contract account, not an EOA)')
  }

  if (profile.origin?.label) lines.push(`- Origin: ${profile.origin.label}`)
  if (profile.badge?.name) lines.push(`- Community badge: ${profile.badge.name}`)
  if (profile.agent?.label) lines.push(`- Automated: this account declares itself ${profile.agent.label}`)

  if (tags.length > 0) lines.push(`- Tags: ${tags.join(', ')}`)

  if (links.length > 0) {
    lines.push('- Links:')
    links.forEach((link) => {
      /* Most profiles leave the title empty and the indexer echoes the URL into it; printing
         both then says the same thing twice. */
      const title = oneLine(link.title)
      lines.push(title && title !== link.url ? `  - ${title} — ${link.url}` : `  - ${link.url}`)
    })
  }

  if (activity) {
    lines.push(
      '',
      '## Activity',
      '',
      `- Posts: ${activity.posts}`,
      `- Followers: ${activity.followers}`,
      `- Following: ${activity.following}`,
    )
    if (activity.networks.length > 0) lines.push(`- Active on: ${activity.networks.join(', ')}`)

    if (activity.recent.length > 0) {
      lines.push('', `## Recent posts`, '')
      activity.recent.forEach((row) => lines.push(renderPost(row)))
    }
  }

  lines.push(
    '',
    '## Reading more',
    '',
    `- Profile JSON: ${BASE_URL}/api/v1/users/profile/${address}`,
    `- Followers: ${BASE_URL}/api/v1/users/${address}/followers`,
    `- Following: ${BASE_URL}/api/v1/users/${address}/following`,
    `- This account's posts: ${BASE_URL}/api/v1/networks/posts?wallet_address=${address}`,
    `- Hup overview for models: ${BASE_URL}/llms.txt`,
    '',
  )

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      /* Shared surface, no viewer state — let a CDN and a crawler both hold it. */
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
