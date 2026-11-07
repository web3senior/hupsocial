/**
 * @file lib/activeWallets.js
 * @description Who actually uses Hup: every wallet that has done something here, in any feature.
 *
 * The users table cannot answer this. It doubles as the profile cache the follower indexer and
 * profileHelper write into, so most of its rows are addresses nobody ever acted from. Instead, a
 * wallet counts once it appears as the actor in any feature's own table — a post, a like, a mint,
 * a purchase, a bet. Received actions (a like on your post, a follower) never count.
 *
 * A new feature joins the count by adding its table here.
 */
import pool from '@/lib/db'
import { hasColumn } from '@/lib/schema'

/*
 * One row per action. `wallet` is the column naming who acted, `time` when; `unix` marks a time
 * stored as onchain unix seconds rather than a DATETIME. `from` replaces the table for a source
 * whose actor is a foreign key (chat messages point at chat_users).
 */
export const ACTIVE_SOURCES = [
  // Social
  { table: 'posts', wallet: 'wallet_address', time: 'created_at' }, // posts, comments and reposts
  { table: 'post_likes', wallet: 'liker_address', time: 'inserted_at', where: 'is_active = 1' },
  { table: 'post_bookmarks', wallet: 'wallet_address', time: 'created_at' },
  { table: 'tips', wallet: 'tipper', time: 'tipped_at', unix: true },
  { table: 'polls', wallet: 'creator', time: 'created_at' },
  { table: 'poll_votes', wallet: 'voter', time: 'voted_at', unix: true },
  { table: 'user_statuses', wallet: 'wallet_address', time: 'updated_at', unix: true },
  { table: 'scheduled_posts', wallet: 'wallet_address', time: 'created_at' },
  { table: 'communities', wallet: 'creator_address', time: 'created_at' },
  {
    table: 'chat_messages',
    from: 'chat_messages JOIN chat_users ON chat_users.id = chat_messages.sender_id',
    wallet: 'chat_users.wallet',
    time: 'chat_messages.created_at',
    probe: ['chat_users', 'wallet'],
  },
  { table: 'live_streams', wallet: 'wallet', time: 'created_at' },
  { table: 'tv_channels', wallet: 'owner', time: 'created_at' },
  // NFTs
  { table: 'drops', wallet: 'creator', time: 'created_at' },
  { table: 'drop_mints', wallet: 'minter', time: 'minted_at' },
  { table: 'nft_listings', wallet: 'seller', time: 'listed_at', unix: true },
  { table: 'nft_offers', wallet: 'offerer', time: 'made_at', unix: true },
  { table: 'nft_offer_fills', wallet: 'seller', time: 'filled_at', unix: true },
  { table: 'nft_trades', wallet: 'buyer', time: 'sold_at', unix: true },
  // Store, premium and decorations
  { table: 'store_listings', wallet: 'seller', time: 'listed_at' },
  { table: 'store_sales', wallet: 'buyer', time: 'sold_at', unix: true },
  { table: 'premium_purchases', wallet: 'payer', time: 'purchased_at', unix: true },
  { table: 'decoration_orders', wallet: 'buyer_address', time: 'paid_at', unix: true, where: 'paid_at IS NOT NULL' },
  // Funding and prediction markets
  { table: 'fund_campaigns', wallet: 'creator', time: 'created_at' },
  { table: 'fund_backings', wallet: 'backer', time: 'backed_at', unix: true },
  { table: 'markets', wallet: 'creator', time: 'created_at' },
  { table: 'market_bets', wallet: 'bettor', time: 'bet_at', unix: true },
  { table: 'market_claims', wallet: 'account', time: 'claimed_at', unix: true },
  // Launchpad and swaps
  { table: 'launches', wallet: 'creator', time: 'created_at', unix: true },
  { table: 'launch_trades', wallet: 'trader', time: 'traded_at', unix: true },
  { table: 'launchpad_launches', wallet: 'creator', time: 'created_at' },
  { table: 'launchpad_presales', wallet: 'creator', time: 'created_at' },
  { table: 'launchpad_trades', wallet: 'trader', time: 'traded_at' },
  { table: 'swap_activity', wallet: 'wallet_address', time: 'created_at', unix: true },
  // Apps, agents and the miner
  { table: 'apps', wallet: 'owner', time: 'listed_at', unix: true },
  { table: 'hosted_agents', wallet: 'owner_address', time: 'created_at' },
  { table: 'miner_faucet_drips', wallet: 'owner', time: 'created_at' },
]

/* Production is migrated by hand, so a feature whose table has not landed is skipped rather than
   rejecting the whole count. hasColumn caches, so this is a one-time cost per process. */
async function availableSources() {
  const present = await Promise.all(
    ACTIVE_SOURCES.map(async (source) => {
      const checks = source.probe
        ? [hasColumn(...source.probe), hasColumn('chat_users', 'id'), hasColumn(source.table, 'sender_id'), hasColumn(source.table, 'created_at')]
        : [hasColumn(source.table, source.wallet), hasColumn(source.table, source.time)]
      if (source.table === 'post_likes') checks.push(hasColumn(source.table, 'is_active'))
      return (await Promise.all(checks)).every(Boolean)
    }),
  )
  return ACTIVE_SOURCES.filter((_, index) => present[index])
}

/* Same collation the leaderboard joins on, so a checksummed and a lowercase address are one wallet */
const walletExpr = (column) => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci`

/** A UNION of every active wallet, optionally only those that acted before `before`. */
function unionSql(sources, before) {
  const params = []
  const parts = sources.map((source) => {
    const conditions = [`${source.wallet} IS NOT NULL`, `${source.wallet} <> ''`]
    if (source.where) conditions.push(source.where)
    if (before) {
      conditions.push(`${source.time} < ?`)
      params.push(source.unix ? before.unix : before.datetime)
    }
    return `SELECT ${walletExpr(source.wallet)} AS wallet FROM ${source.from ?? source.table} WHERE ${conditions.join(' AND ')}`
  })
  return { sql: parts.join(' UNION '), params }
}

/**
 * Counts active wallets: everyone who has ever acted, and how many of them first acted at or
 * after `since` (a UTC 'YYYY-MM-DD HH:MM:SS' string, the leaderboard's window format).
 * @param {string|null} since Window start, or null for the all-time total only.
 * @returns {Promise<{ total: number, recent: number }>}
 */
export async function countActiveWallets(since = null) {
  const sources = await availableSources()
  if (sources.length === 0) return { total: 0, recent: 0 }

  const all = unionSql(sources)
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM (${all.sql}) active`, all.params)
  if (!since) return { total: Number(total), recent: 0 }

  // New in the window = everyone, minus whoever had already acted before it began
  const before = unionSql(sources, { datetime: since, unix: Math.floor(Date.parse(`${since}Z`) / 1000) })
  const [[{ earlier }]] = await pool.execute(`SELECT COUNT(*) AS earlier FROM (${before.sql}) active`, before.params)
  return { total: Number(total), recent: Math.max(0, Number(total) - Number(earlier)) }
}
