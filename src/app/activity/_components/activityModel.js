import {
  ArrowsDownUpIcon,
  ChartLineUpIcon,
  ChatCircleIcon,
  HandCoinsIcon,
  HandshakeIcon,
  HeartIcon,
  NotePencilIcon,
  PulseIcon,
  RepeatIcon,
  ShoppingBagOpenIcon,
  TagIcon,
  UserPlusIcon,
} from '@phosphor-icons/react'
import { formatUnits } from 'viem'

// Tabs are pure kind filters — the endpoint takes the same list, so a tab can never show a verb
// its label does not promise. `kinds: null` asks for everything the API serves.
export const TABS = [
  { id: 'all', label: 'All', kinds: null, empty: 'Nothing has happened on Hup yet.' },
  { id: 'social', label: 'Social', kinds: ['post', 'comment', 'repost', 'like', 'follow'], empty: 'No posts, likes or follows yet.' },
  { id: 'nfts', label: 'NFTs', kinds: ['nft_sale', 'offer_made', 'offer_filled'], empty: 'No sales or offers yet.' },
  { id: 'money', label: 'Money', kinds: ['tip', 'bet', 'swap'], empty: 'No tips, bets or swaps yet.' },
]

const DEFAULT_META = { icon: PulseIcon, tone: 'neutral' }

// One entry per kind the activity endpoint emits. Each icon names the act, not the feature it came
// from: a purchase is a shopping bag rather than a storefront, a filled offer is a handshake rather
// than a checkmark. Where the app already has a glyph for the destination (Predict, Swap), the row
// reuses it so a verb reads the same in the feed and in the sidebar.
//   tone     — drives the icon colour, the amount pill and the hover tint (see the SCSS module).
//   previews — the row fetches and shows the post this line points at.
export const KIND_META = {
  post: { icon: NotePencilIcon, tone: 'neutral', previews: true, label: 'Post' },
  comment: { icon: ChatCircleIcon, tone: 'reply', weight: 'fill', previews: true, label: 'Reply' },
  repost: { icon: RepeatIcon, tone: 'repost', weight: 'bold', previews: true, label: 'Repost' },
  like: { icon: HeartIcon, tone: 'like', weight: 'fill', previews: true, label: 'Like' },
  follow: { icon: UserPlusIcon, tone: 'follow', weight: 'fill', label: 'Follow' },
  tip: { icon: HandCoinsIcon, tone: 'money', weight: 'fill', previews: true, label: 'Tip' },
  nft_sale: { icon: ShoppingBagOpenIcon, tone: 'money', weight: 'fill', label: 'NFT sale' },
  offer_made: { icon: TagIcon, tone: 'offer', weight: 'fill', label: 'Offer' },
  offer_filled: { icon: HandshakeIcon, tone: 'offer', weight: 'fill', label: 'Offer filled' },
  bet: { icon: ChartLineUpIcon, tone: 'market', weight: 'bold', label: 'Bet' },
  swap: { icon: ArrowsDownUpIcon, tone: 'trade', weight: 'bold', label: 'Swap' },
}

export function getKindMeta(kind) {
  return KIND_META[kind] || DEFAULT_META
}

// HupOffers bids for more than NFTs: 0/1/2 are ERC721/LSP8/ERC1155, 3/4 are LSP7/ERC20 token
// amounts and 5 is the chain's native coin. Mirrors cidex's OFFER_STANDARD_* constants.
const OFFER_STANDARD = { ERC721: 0, LSP8: 1, ERC1155: 2, LSP7: 3, ERC20: 4, NATIVE: 5 }
const NFT_STANDARDS = [OFFER_STANDARD.ERC721, OFFER_STANDARD.LSP8, OFFER_STANDARD.ERC1155]

// Which payload key holds the value of the action. Offers carry both `price` (what was bid) and
// `amount` (how much of the asset was asked for), so the two must never be confused.
const AMOUNT_KEY = {
  tip: 'amount',
  nft_sale: 'price',
  offer_made: 'price',
  offer_filled: 'payout',
  bet: 'amount',
}

const amountFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

/** "0.001 MON" for the value moved by this row, or null when the row moved nothing. */
export function amountOf(row) {
  const key = AMOUNT_KEY[row.kind]
  if (!key) return null

  return formatTokenAmount(row.meta?.[key], row.meta?.decimals, row.meta?.symbol)
}

export function formatTokenAmount(raw, decimals, symbol) {
  if (raw === undefined || raw === null || raw === '') return null

  try {
    const value = Number(formatUnits(BigInt(raw), Number(decimals ?? 18)))
    if (!Number.isFinite(value)) return null
    return `${amountFormatter.format(value)} ${symbol || ''}`.trim()
  } catch {
    return null
  }
}

/**
 * What an NFT sale or offer is actually for. NFT standards resolve to a token the row can look
 * up and thumbnail; a native-coin bid resolves to an amount; a plain token bid has no decimals
 * anywhere in the payload, so it stays deliberately unquantified rather than guessing 18.
 */
export function assetOf(row) {
  const meta = row.meta
  if (!meta) return null

  // Sales come from a listing and are always a single NFT; offers declare their standard.
  const standard = row.kind === 'nft_sale' ? (meta.is_lsp8 ? OFFER_STANDARD.LSP8 : OFFER_STANDARD.ERC721) : Number(meta.standard)
  // How much of the asset the row is about: an open offer states it as `amount`, a fill reports
  // the part that actually changed hands as `quantity`.
  const quantity = row.kind === 'offer_filled' ? meta.quantity : meta.amount

  if (standard === OFFER_STANDARD.NATIVE) {
    return { type: 'native', label: formatTokenAmount(quantity, 18, row.currency_symbol) }
  }

  if (standard === OFFER_STANDARD.LSP7 || standard === OFFER_STANDARD.ERC20) {
    // Neither the payload nor this row carries the asset token's decimals, so the size stays
    // unstated rather than guessed at 18.
    return { type: 'token', label: null }
  }

  if (!NFT_STANDARDS.includes(standard) || !meta.collection) return null

  return {
    type: 'nft',
    collection: meta.collection,
    tokenId: meta.token_id,
    isLsp8: standard === OFFER_STANDARD.LSP8,
    // ERC1155 offers can ask for several copies of the same edition.
    quantity: standard === OFFER_STANDARD.ERC1155 ? quantity : null,
  }
}

/** Where clicking the row goes, or null when the action has no page of its own. */
export function hrefOf(row) {
  const { kind, network_id: networkId, entity_id: entityId, subject } = row

  if (row.entity_type === 'post' && networkId && entityId) return `/networks/${networkId}/${entityId}`
  if (kind === 'follow' && subject) return `/${subject}`
  if (kind === 'nft_sale' && networkId && entityId) return `/nfts/${networkId}/${entityId}`
  if (kind === 'bet' && networkId && entityId) return `/predict/${networkId}/${entityId}`
  if (kind === 'swap') return '/swap'

  // Offers are collection- or token-wide bids; the app has no page for a single offer.
  return null
}

export function shortAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// Below this many skipped heights a gap is noise rather than history, and printing it between
// every card turns the marker into wallpaper.
export const BLOCK_GAP_MIN = 250

// Rows younger than this keep the pulsing icon that marks a just-landed action.
const FRESH_WINDOW_SECONDS = 600

export function isFresh(ts) {
  return Number.isFinite(ts) && Date.now() / 1000 - ts < FRESH_WINDOW_SECONDS
}

/**
 * Collapses the flat feed into the blocks that produced it: consecutive rows sharing a chain and a
 * height become one card. Rows with no height — swaps, which the browser reports at confirmation
 * instead of the indexer reading them from a log — each stand alone and are marked `loose`, never
 * merged into a neighbouring block they were not part of.
 */
export function groupIntoBlocks(rows) {
  const blocks = []

  rows.forEach((row) => {
    const previous = blocks[blocks.length - 1]
    const height = row.block_number ?? null

    if (previous && height !== null && previous.blockNumber === height && previous.networkId === row.network_id) {
      previous.rows.push(row)
      return
    }

    blocks.push({
      key: row.uid,
      networkId: row.network_id,
      networkName: row.network_name,
      blockNumber: height,
      loose: height === null,
      ts: row.ts,
      rows: [row],
    })
  })

  return blocks
}

/** Heights skipped between two cards of the same chain, or 0 when the marker does not apply. */
export function skippedBlocksBetween(previous, block) {
  if (!previous || !block) return 0
  if (previous.networkId !== block.networkId) return 0
  if (previous.blockNumber === null || block.blockNumber === null) return 0

  const skipped = previous.blockNumber - block.blockNumber - 1
  return skipped > BLOCK_GAP_MIN ? skipped : 0
}

/** The row's transaction on its chain's explorer, or null when the chain has none on file. */
export function explorerTxUrl(row) {
  if (!row.explorer_url || !row.tx_hash) return null
  return `${row.explorer_url.replace(/\/$/, '')}/tx/${row.tx_hash}`
}
