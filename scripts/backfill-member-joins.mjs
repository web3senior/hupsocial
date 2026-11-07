// One-time backfill of users.joined_at for wallets that used Hup before join tracking existed.
//
// joined_at is written when a wallet first connects (lib/members.js ensureMember). Wallets that
// connected earlier have no record, and the users table cannot tell them apart from profiles the
// follower indexer cached. A wallet that acted on Hup (posted, liked, minted, bought…) must have
// connected, so each one gets joined_at = the time of its first action. Real dates keep the
// leaderboard's "+N in 24h" honest: a backfilled wallet never reads as joined today.
//
// Only existing users rows are updated, and a recorded join is never overwritten, so re-running
// is safe. Tables production has not migrated yet are skipped.
//
// Run after deploy/migrations/20261107-member-joined-at.sql:
//   node --env-file=.env scripts/backfill-member-joins.mjs           dry run: counts only
//   node --env-file=.env scripts/backfill-member-joins.mjs --apply   write joined_at
import mysql from 'mysql2/promise'

const APPLY = process.argv.includes('--apply')

// Who acted, and when. `unix` marks onchain unix seconds rather than a DATETIME.
const SOURCES = [
  // Social
  { table: 'posts', wallet: 'wallet_address', time: 'created_at' },
  { table: 'post_likes', wallet: 'liker_address', time: 'inserted_at', where: 'is_active = 1' },
  { table: 'post_bookmarks', wallet: 'wallet_address', time: 'created_at' },
  { table: 'tips', wallet: 'tipper', time: 'tipped_at', unix: true },
  { table: 'polls', wallet: 'creator', time: 'created_at' },
  { table: 'poll_votes', wallet: 'voter', time: 'voted_at', unix: true },
  { table: 'user_statuses', wallet: 'wallet_address', time: 'updated_at', unix: true },
  { table: 'scheduled_posts', wallet: 'wallet_address', time: 'created_at' },
  { table: 'communities', wallet: 'creator_address', time: 'created_at' },
  { table: 'chat_users', wallet: 'wallet', time: 'created_at' },
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

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

try {
  // joined_at is UTC; this makes FROM_UNIXTIME and UNIX_TIMESTAMP read and write UTC too
  await db.query("SET time_zone = '+00:00'")

  const [columns] = await db.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
  )
  const has = new Set(columns.map((row) => `${row.t}.${row.c}`))
  if (!has.has('users.joined_at')) {
    throw new Error('users.joined_at is missing: apply deploy/migrations/20261107-member-joined-at.sql first')
  }

  const sources = SOURCES.filter((source) => has.has(`${source.table}.${source.wallet}`) && has.has(`${source.table}.${source.time}`))
  const skipped = SOURCES.filter((source) => !sources.includes(source)).map((source) => source.table)
  if (skipped.length) console.log(`Skipped (not migrated here): ${skipped.join(', ')}`)

  // Every action as (wallet, unix seconds); MIN per wallet is its first action on Hup
  const actions = sources
    .map(({ table, wallet, time, unix, where }) => {
      const conditions = [`${wallet} IS NOT NULL`, `${wallet} <> ''`, `${time} IS NOT NULL`, where].filter(Boolean)
      const at = unix ? time : `UNIX_TIMESTAMP(${time})`
      return `SELECT CONVERT(${wallet} USING utf8mb4) COLLATE utf8mb4_general_ci AS wallet, ${at} AS at FROM ${table} WHERE ${conditions.join(' AND ')}`
    })
    .join('\nUNION ALL\n')
  const firstActions = `SELECT wallet, FROM_UNIXTIME(MIN(at)) AS first_at FROM (${actions}) actions GROUP BY wallet`

  const [[preview]] = await db.query(`
    SELECT COUNT(*) AS active,
           SUM(u.wallet_address IS NOT NULL AND u.joined_at IS NULL) AS to_fill,
           SUM(u.joined_at IS NOT NULL) AS already_joined,
           SUM(u.wallet_address IS NULL) AS no_users_row
    FROM (${firstActions}) f
    LEFT JOIN users u ON CONVERT(u.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci = f.wallet
  `)
  console.log(`Active wallets: ${preview.active}`)
  console.log(`  to backfill:      ${Number(preview.to_fill)}`)
  console.log(`  already joined:   ${Number(preview.already_joined)}`)
  console.log(`  no users row:     ${Number(preview.no_users_row)} (get joined_at when they next connect)`)

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write joined_at.')
  } else {
    const [result] = await db.query(`
      UPDATE users u
      JOIN (${firstActions}) f
        ON CONVERT(u.wallet_address USING utf8mb4) COLLATE utf8mb4_general_ci = f.wallet
      SET u.joined_at = f.first_at
      WHERE u.joined_at IS NULL
    `)
    const [[{ members }]] = await db.query('SELECT COUNT(*) AS members FROM users WHERE joined_at IS NOT NULL')
    console.log(`\nBackfilled ${result.affectedRows} wallets. Members now: ${members}`)
  }
} finally {
  await db.end()
}
