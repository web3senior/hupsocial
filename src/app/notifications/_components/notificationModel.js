import {
  ArrowsCounterClockwiseIcon,
  BellIcon,
  ChartLineUpIcon,
  ChatCircleIcon,
  HandCoinsIcon,
  HeartIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  QuotesIcon,
  RepeatIcon,
  ScalesIcon,
  StorefrontIcon,
  TrashIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { formatUnits } from 'viem'

// Tabs mirror the `filter` values the notifications API understands. "All" deliberately
// leaves out your own activity (post indexed, you liked a post) — that lives under "You",
// exactly like X keeps the feed to things other people did to you.
export const FILTERS = [
  { id: 'inbox', label: 'All', empty: 'Nothing from anyone yet.' },
  { id: 'mentions', label: 'Mentions', empty: 'No replies or quotes yet.' },
  { id: 'money', label: 'Money', empty: 'No tips, sales or bets yet.' },
  { id: 'you', label: 'You', empty: 'Your own activity will show up here.' },
]

const DEFAULT_META = { icon: BellIcon, tone: 'neutral', group: 'none' }

// One entry per action_type the indexer writes.
//   group      — 'entity' collapses rows sharing a post/market, 'action' collapses every row of
//                the type together (follows), 'none' never collapses (amounts must stay distinct).
//   verb       — completes "<Actor> and 2 others <verb>"; without one the stored title is used.
//   previewFrom— 'entity' previews the post the notification points at, 'child' previews the reply
//                or quote that caused it.
export const ACTION_META = {
  post_received_like: { icon: HeartIcon, tone: 'like', weight: 'fill', group: 'entity', verb: 'liked your post', previewFrom: 'entity' },
  content_liked: { icon: HeartIcon, tone: 'like', weight: 'fill', group: 'entity', verb: 'liked your post', previewFrom: 'entity' },
  // Likes always target the original post, so a reposter is credited through their own row keyed
  // by that post — entity grouping still collapses a burst into one line.
  repost_received_like: { icon: HeartIcon, tone: 'like', weight: 'fill', group: 'entity', verb: 'liked a post you reposted', previewFrom: 'entity' },
  post_received_repost: { icon: RepeatIcon, tone: 'repost', weight: 'bold', group: 'entity', verb: 'reposted your post', previewFrom: 'entity' },
  post_received_comment: { icon: ChatCircleIcon, tone: 'reply', weight: 'fill', group: 'none', verb: 'replied to your post', previewFrom: 'child' },
  post_received_quote: { icon: QuotesIcon, tone: 'reply', weight: 'fill', group: 'none', verb: 'quoted your post', previewFrom: 'child' },
  user_received_follow: { icon: UserPlusIcon, tone: 'follow', weight: 'fill', group: 'action', verb: 'followed you' },
  post_received_tip: { icon: HandCoinsIcon, tone: 'money', weight: 'fill', group: 'none', verb: 'tipped your post', previewFrom: 'entity' },
  nft_sold: { icon: StorefrontIcon, tone: 'money', weight: 'fill', group: 'none', verb: 'bought your NFT' },
  market_received_bet: { icon: ChartLineUpIcon, tone: 'market', weight: 'fill', group: 'none', verb: 'placed a bet on your market' },
  market_resolved: { icon: ChartLineUpIcon, tone: 'market', weight: 'fill', group: 'none', verb: 'resolved a market you are in' },
  market_refunds_available: { icon: ArrowsCounterClockwiseIcon, tone: 'market', group: 'none' },
  market_judge_invited: { icon: ScalesIcon, tone: 'market', group: 'none', verb: 'invited you to judge a market' },
  market_judge_accepted: { icon: ScalesIcon, tone: 'market', group: 'none', verb: 'accepted your judge invitation' },
  community_member_joined: { icon: UsersThreeIcon, tone: 'follow', weight: 'fill', group: 'entity', verb: 'joined your community' },
  community_join_requested: { icon: UsersThreeIcon, tone: 'follow', weight: 'fill', group: 'entity', verb: 'requested to join your community' },
  followed_user_created_community: { icon: UsersThreeIcon, tone: 'follow', weight: 'fill', group: 'none', verb: 'created a community' },

  // Your own activity — the message is already written in the first person, so no verb.
  post_created: { icon: PlusCircleIcon, tone: 'neutral', group: 'none', previewFrom: 'entity' },
  post_updated: { icon: PencilSimpleIcon, tone: 'neutral', group: 'none', previewFrom: 'entity' },
  post_deleted: { icon: TrashIcon, tone: 'neutral', group: 'none' },
  post_liked: { icon: HeartIcon, tone: 'like', weight: 'fill', group: 'none', previewFrom: 'entity' },
  comment_created: { icon: ChatCircleIcon, tone: 'reply', weight: 'fill', group: 'none', previewFrom: 'entity' },
  repost_created: { icon: RepeatIcon, tone: 'repost', weight: 'bold', group: 'none', previewFrom: 'entity' },
  post_sent_tip: { icon: HandCoinsIcon, tone: 'money', weight: 'fill', group: 'none', previewFrom: 'entity' },
  nft_purchased: { icon: StorefrontIcon, tone: 'money', weight: 'fill', group: 'none' },
  market_earned_fee: { icon: HandCoinsIcon, tone: 'money', weight: 'fill', group: 'none' },
  community_created: { icon: UsersThreeIcon, tone: 'follow', weight: 'fill', group: 'none' },
  community_joined: { icon: UsersThreeIcon, tone: 'follow', weight: 'fill', group: 'none' },
}

export function getActionMeta(actionType) {
  return ACTION_META[actionType] || DEFAULT_META
}

const networkIdOf = (notification) => notification.network_id ?? notification.data?.network_id ?? null

// Follows carry the follower's address as entity_id, so keying them by entity would produce one
// group per follower — collapse the whole type instead.
function groupKeyOf(notification, meta) {
  if (meta.group === 'action') return `action:${notification.action_type}`
  if (meta.group === 'entity') {
    return `entity:${notification.action_type}:${networkIdOf(notification)}:${notification.entity_id}`
  }
  return `single:${notification.id}`
}

/**
 * Collapses a chronologically sorted notification list into X-style rows. Groups keep the position
 * of their newest member, so the feed stays ordered by recency.
 */
export function buildGroups(notifications) {
  const groups = []
  const byKey = new Map()

  notifications.forEach((notification) => {
    const meta = getActionMeta(notification.action_type)
    const key = groupKeyOf(notification, meta)
    let group = byKey.get(key)

    if (!group) {
      group = {
        key,
        meta,
        latest: notification,
        actionType: notification.action_type,
        entityType: notification.entity_type || 'post',
        entityId: notification.entity_id ?? null,
        networkId: networkIdOf(notification),
        createdAt: notification.created_at,
        actors: [],
        total: 0,
        unreadIds: [],
      }
      byKey.set(key, group)
      groups.push(group)
    }

    group.total += 1
    if (!notification.is_read) group.unreadIds.push(notification.id)

    const actor = notification.actor_wallet_address
    if (actor && !group.actors.some((existing) => existing.toLowerCase() === actor.toLowerCase())) {
      group.actors.push(actor)
    }
  })

  return groups
}

/** Post this group should preview: the reply/quote itself for mentions, otherwise your own post. */
export function previewPostIdOf(group) {
  if (group.entityType !== 'post') return null

  const { data } = group.latest
  if (group.meta.previewFrom === 'child') {
    return data?.comment_post_id || data?.post_id || group.entityId
  }

  return group.meta.previewFrom === 'entity' ? group.entityId : null
}

export function hrefOf(group) {
  const { latest, networkId } = group
  const postId = previewPostIdOf(group) || (group.entityType === 'post' ? group.entityId : null)

  if (networkId && postId) return `/networks/${networkId}/${postId}`
  if (!latest.action_url) return null

  // Legacy rows still point at /posts/<id>?network_id=<n>
  if (latest.action_url.startsWith('/posts/')) {
    const [path, queryString] = latest.action_url.split('?')
    const legacyNetworkId = new URLSearchParams(queryString || '').get('network_id') || networkId
    const legacyPostId = path.replace('/posts/', '')
    if (legacyNetworkId && legacyPostId) return `/networks/${legacyNetworkId}/${legacyPostId}`
  }

  return latest.action_url
}

const amountFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

/** "0.001 MON" for tips and sales, null when the payload carries no value. */
export function amountOf(notification) {
  const data = notification.data
  const raw = data?.amount ?? data?.price
  if (raw === undefined || raw === null) return null

  try {
    const value = Number(formatUnits(BigInt(raw), Number(data.decimals ?? 18)))
    if (!Number.isFinite(value)) return null
    return `${amountFormatter.format(value)} ${data.symbol || ''}`.trim()
  } catch {
    return null
  }
}

/**
 * Non-post notifications carry their subject quoted inside the message — the market question, the
 * community name. Pull it out so the row can show it the way a post preview is shown.
 */
export function quotedSubjectOf(message) {
  const match = message?.match(/["“]([^"”]+)["”]/)
  return match ? match[1] : null
}
