/**
 * @file mcp/src/shape.js
 * Compact views of the app's rows. A feed row carries the whole hydrated document plus a
 * dozen joins; a model needs the text, the author, the counts and a link.
 */

const TYPE_LABEL = ['post', 'comment', 'repost']

const parseContent = (content) => {
  if (content == null) return null
  if (typeof content === 'object') return content
  const text = String(content)
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

const parseList = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

/** Text of a hydrated post document, whatever shape it arrived in. */
export function textOf(content) {
  const doc = parseContent(content)
  if (doc == null) return ''
  if (typeof doc === 'string') return doc
  if (doc.encrypted) return ''
  const element = (doc.elements ?? []).find((e) => e?.type === 'text')
  return String(element?.data?.text ?? '')
}

/** Media items of a hydrated post document. */
export function mediaOf(content) {
  const doc = parseContent(content)
  if (!doc || typeof doc !== 'object') return []
  const element = (doc.elements ?? []).find((e) => e?.type === 'media')
  return (element?.data?.items ?? [])
    .filter((item) => item?.cid)
    .map((item) => ({ type: item.type, cid: item.cid, alt: item.alt || undefined, mime: item.mimeType || undefined }))
}

const num = (value) => (value == null ? 0 : Number(value))
const idOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {object} row a post row from the feed, single-post, comments or search routes
 * @param {string} baseUrl
 */
export function compactPost(row, baseUrl) {
  if (!row || typeof row !== 'object') return null
  const doc = parseContent(row.content)
  const networkId = Number(row.network_id)
  const id = Number(row.id)
  const out = {
    id,
    network_id: networkId,
    chain: row.network_name ?? undefined,
    url: `${baseUrl}/networks/${networkId}/${id}`,
    type: TYPE_LABEL[Number(row.content_type)] ?? 'post',
    author: row.wallet_address,
    author_name: row.display_name || null,
    created_at: row.created_at,
    text: textOf(doc),
    media: mediaOf(doc),
    likes: num(row.total_likes),
    comments: num(row.total_comments),
    reposts: num(row.total_reposts),
    views: num(row.total_views),
    tips: num(row.total_tips),
    allow_comments: row.allow_comment == null ? true : Boolean(Number(row.allow_comment)),
  }
  const parent = idOrNull(row.is_comment) ?? idOrNull(row.parent_id)
  if (parent) out.parent_id = parent
  const repostOf = idOrNull(row.is_repost)
  if (repostOf) out.repost_of = repostOf
  if (doc && typeof doc === 'object' && doc.quoteOf) out.quote_of = Number(doc.quoteOf)
  if (doc && typeof doc === 'object' && doc.encrypted) out.encrypted = true
  if (row.community_id) out.community_id = Number(row.community_id)
  if (Number(row.is_deleted)) out.deleted = true
  if (row.metadata) out.metadata = row.metadata
  if (row.tx_hash) out.tx_hash = row.tx_hash
  if (row.trending_score != null) out.trending_score = Number(row.trending_score)
  if (row.has_liked != null || row.is_liked != null) out.viewer_liked = Boolean(Number(row.is_liked ?? row.has_liked))
  if (row.repost_original) out.repost_original = compactPost(row.repost_original, baseUrl)
  if (row.last_comment) out.last_comment = compactPost(row.last_comment, baseUrl)
  return out
}

/**
 * @param {object} data the `data` object from /api/v1/users/profile/{address}
 * @param {string} source `universal_profile` or `database`
 * @param {string} baseUrl
 */
export function compactProfile(data, source, baseUrl) {
  if (!data) return null
  const address = data.wallet_address ?? data.address ?? null
  const username = data.username || null
  return {
    address,
    username,
    url: username ? `${baseUrl}/@${username}` : address ? `${baseUrl}/${address}` : null,
    llms_txt: address ? `${baseUrl}/${address}/llms.txt` : null,
    name: data.name || null,
    description: data.description || null,
    tags: parseList(data.tags),
    links: parseList(data.links),
    profile_image: data.profileImage || null,
    agent: data.agent ?? null,
    premium: data.premium ?? null,
    origin: data.origin?.name ?? data.origin?.code ?? null,
    interests: Array.isArray(data.interests) ? data.interests.map((i) => i?.slug ?? i?.label ?? i) : [],
    total_posts: data.total_posts != null ? Number(data.total_posts) : undefined,
    identity: source === 'universal_profile' ? 'universal-profile' : 'wallet',
  }
}

export const compactActivity = (row) => ({
  kind: row.kind,
  actor: row.actor,
  subject: row.subject ?? null,
  network_id: row.network_id ?? null,
  chain: row.network_name ?? null,
  entity_type: row.entity_type,
  entity_id: row.entity_id ?? null,
  at: row.ts ? new Date(row.ts * 1000).toISOString() : null,
  tx_hash: row.tx_hash ?? null,
  meta: row.meta ?? undefined,
})

export const compactCommunity = (row, baseUrl) => ({
  id: Number(row.id),
  network_id: Number(row.network_id),
  name: row.name,
  summary: row.summary ?? row.description ?? null,
  category: row.category ?? null,
  membership_type: row.membership_type,
  encrypted: Boolean(Number(row.is_encrypted ?? row.encrypted ?? 0)),
  members: row.member_count != null ? Number(row.member_count) : undefined,
  creator: row.creator_address ?? row.wallet_address ?? null,
  url: `${baseUrl}/communities/${row.network_id}/${row.id}`,
})
