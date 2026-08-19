/**
 * @file api/v1/activity/route.js
 * @description Public "what is happening on Hup" stream — one chronological list of every
 * onchain action the app already has rows for, across every chain. Read-only: nothing here
 * scans chains or writes anything. Each verb is a source in SOURCES with its own SELECT that
 * maps into one shared column shape, so the branches UNION ALL into a single ordered page.
 *
 * Where each verb comes from, and why:
 *   post/comment/repost  posts            — carries is_deleted, moderation_flagged and
 *                                           community_id, which the notification rows do not,
 *                                           so the privacy filter can live in SQL.
 *   like                 post_likes       — is_active tells an unliked row from a live one.
 *   follow/tip/nft_sale/ notifications    — cidex already resolved token symbol and decimals
 *   offer_made/                             into `data` for these, and each row carries both
 *   offer_filled                            parties. Re-deriving that from tips/nft_trades
 *                                           would mean re-reading token metadata per row.
 *   bet                  market_bets      — the notification for a bet carries no amount, and
 *                                           exists only when the bettor is not the market owner.
 *   swap                 swap_activity    — swaps have no Hup contract, so there is no
 *                                           notification and no indexed event at all.
 *
 * Deferred verbs. Each becomes one more SOURCES entry when its turn comes; nothing else in this
 * file has to change.
 *   Waiting on mainnet — mint (drop_mints), community_created / community_joined
 *   (notifications), launch_trade (launch_trades), miner_run (miner_runs), store_sale
 *   (store_sales, since Bazaar only runs on LUKSO and Monad testnet).
 *   Waiting on rows — event_created (events), app_listed (apps), status (statuses): those
 *   features are on mainnet, but nothing records an actor-and-time row for them yet, so they
 *   need a cidex-side notification before a feed can show them.
 *
 * Timestamps: cidex stores block time as a UTC DATETIME, so those columns are converted with
 * TIMESTAMPDIFF against the epoch rather than UNIX_TIMESTAMP — the latter would read them in
 * the server's local zone and shift every row by its offset. market_bets.bet_at and
 * swap_activity.created_at are already unix seconds and pass through untouched.
 *
 * Integrity note: swap rows are client-reported at confirmation time (see api/v1/swaps) and
 * carry verified = 0 until a future job checks receipts, so the feed treats them as telemetry.
 * Every other verb comes from an indexed event.
 *
 * Indexes this route depends on — every branch is "newest first, stop at LIMIT", which is only
 * cheap while an index supplies that order. Applied on the dev database; run them wherever this
 * ships (a full page cost 280ms without them here and 18ms with them):
 *   ALTER TABLE posts ADD KEY idx_posts_recent (created_at);
 *   ALTER TABLE post_likes ADD KEY idx_post_likes_recent (liked_at);
 *   ALTER TABLE notifications ADD KEY idx_notifications_action_recent (action_type, created_at);
 *   ALTER TABLE market_bets ADD KEY idx_market_bets_recent (bet_at);
 */
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 60

const EPOCH = "'1970-01-01 00:00:00'"
// Unix seconds out of a UTC-stored DATETIME, independent of the server's time zone.
const secondsOf = (column) => `TIMESTAMPDIFF(SECOND, ${EPOCH}, ${column})`
// The mirror of the above: a cursor in unix seconds back into a comparable UTC DATETIME.
const DATETIME_FROM_CURSOR = `DATE_ADD(${EPOCH}, INTERVAL ? SECOND)`

// The tables were created over a year apart and disagree on collation — post_likes stores
// addresses as ascii_bin, everything else as utf8mb4_general_ci, and JSON_OBJECT() answers in
// utf8mb4_bin. A UNION over that mix is an "illegal mix of collations" error, so every string
// column in every branch is normalized here, the same way the leaderboard query does it.
const text = (expression) => `CONVERT(${expression} USING utf8mb4) COLLATE utf8mb4_general_ci`

// One notification action_type per verb, picked as the row that carries both parties. Self-rows
// (post_liked, nft_purchased, …) describe the same events from the actor's side and would double
// every line, so they are deliberately not read here.
const NOTIFICATION_KIND_BY_ACTION = {
  user_received_follow: 'follow',
  post_received_tip: 'tip',
  nft_sold: 'nft_sale',
  nft_offer_made: 'offer_made',
  nft_offer_accepted: 'offer_filled',
}

// Posts, comments and reposts share one table; each kind is a predicate on the same row.
const POST_KIND_CLAUSES = {
  post: 'p.is_comment IS NULL AND p.is_repost IS NULL',
  comment: 'p.is_comment IS NOT NULL',
  repost: 'p.is_repost IS NOT NULL AND p.is_comment IS NULL',
}

// A post is public only when it is live, unflagged and outside a community — community posts can
// be members-only, and a feed line advertises a post's existence even without its content.
const publicPost = (alias) =>
  `${alias}.is_deleted = 0 AND ${alias}.moderation_flagged = 0 AND ${alias}.community_id IS NULL`

const SOURCES = [
  {
    id: 'posts',
    kinds: ['post', 'comment', 'repost'],
    build: ({ kinds, networkId, before, limit }) => {
      const where = [
        `(${kinds.map((kind) => `(${POST_KIND_CLAUSES[kind]})`).join(' OR ')})`,
        publicPost('p'),
        'p.wallet_address IS NOT NULL',
        'p.created_at IS NOT NULL',
      ]
      const params = []

      if (networkId !== null) {
        where.push('p.network_id = ?')
        params.push(networkId)
      }
      if (before !== null) {
        where.push(`p.created_at < ${DATETIME_FROM_CURSOR}`)
        params.push(before)
      }

      params.push(limit)

      return {
        sql: `
          SELECT
            ${text(`CASE
              WHEN p.is_comment IS NOT NULL THEN 'comment'
              WHEN p.is_repost IS NOT NULL THEN 'repost'
              ELSE 'post'
            END`)} AS kind,
            ${text('p.wallet_address')} AS actor,
            ${text('NULL')} AS subject,
            p.network_id AS network_id,
            ${text("'post'")} AS entity_type,
            ${text('CAST(p.id AS CHAR)')} AS entity_id,
            ${secondsOf('p.created_at')} AS ts,
            ${text("CONCAT('post:', p.network_id, ':', p.id)")} AS uid,
            p.block_number AS block_number,
            ${text('p.tx_hash')} AS tx_hash,
            p.log_index AS log_index,
            ${text('NULL')} AS meta
          FROM posts p
          WHERE ${where.join(' AND ')}
          ORDER BY p.created_at DESC
          LIMIT ?
        `,
        params,
      }
    },
  },

  {
    id: 'likes',
    kinds: ['like'],
    build: ({ networkId, before, limit }) => {
      const where = ['pl.is_active = 1', 'pl.liked_at IS NOT NULL', publicPost('p')]
      const params = []

      if (networkId !== null) {
        where.push('pl.network_id = ?')
        params.push(networkId)
      }
      if (before !== null) {
        where.push(`pl.liked_at < ${DATETIME_FROM_CURSOR}`)
        params.push(before)
      }

      params.push(limit)

      return {
        sql: `
          SELECT
            ${text("'like'")} AS kind,
            ${text('pl.liker_address')} AS actor,
            ${text('pl.creator_address')} AS subject,
            pl.network_id AS network_id,
            ${text("'post'")} AS entity_type,
            ${text('CAST(pl.post_id AS CHAR)')} AS entity_id,
            ${secondsOf('pl.liked_at')} AS ts,
            ${text("CONCAT('like:', pl.id)")} AS uid,
            pl.liked_block_number AS block_number,
            ${text('pl.liked_tx_hash')} AS tx_hash,
            pl.liked_log_index AS log_index,
            ${text('NULL')} AS meta
          FROM post_likes pl
          JOIN posts p ON p.network_id = pl.network_id AND p.id = pl.post_id
          WHERE ${where.join(' AND ')}
          ORDER BY pl.liked_at DESC
          LIMIT ?
        `,
        params,
      }
    },
  },

  {
    id: 'notifications',
    kinds: Object.values(NOTIFICATION_KIND_BY_ACTION),
    // One branch per action_type rather than a single IN() branch: with one type, the
    // (action_type, created_at) index returns rows already ordered and the LIMIT stops the scan
    // early. An IN() over five types cannot be ordered by that index, so MariaDB filesorts every
    // matching row — 80k of them, mostly follows, for a 30-row page.
    build: ({ kinds, networkId, before, limit }) =>
      Object.entries(NOTIFICATION_KIND_BY_ACTION)
        .filter(([, kind]) => kinds.includes(kind))
        .map(([action, kind]) => {
          const params = [action]
          const where = [
            'n.action_type = ?',
            'n.actor_wallet_address IS NOT NULL',
            // Only tips point at a post; every other verb here is a marketplace or profile action.
            `(n.entity_type <> 'post' OR (p.id IS NOT NULL AND ${publicPost('p')}))`,
          ]

          if (networkId !== null) {
            where.push('n.network_id = ?')
            params.push(networkId)
          }
          if (before !== null) {
            where.push(`n.created_at < ${DATETIME_FROM_CURSOR}`)
            params.push(before)
          }

          params.push(limit)

          return {
            sql: `
              SELECT
                ${text(`'${kind}'`)} AS kind,
                ${text('n.actor_wallet_address')} AS actor,
                ${text(`CASE
                  WHEN n.recipient_wallet_address = n.actor_wallet_address THEN NULL
                  ELSE n.recipient_wallet_address
                END`)} AS subject,
                n.network_id AS network_id,
                ${text('n.entity_type')} AS entity_type,
                ${text('n.entity_id')} AS entity_id,
                ${secondsOf('n.created_at')} AS ts,
                ${text("CONCAT('notification:', n.id)")} AS uid,
                n.block_number AS block_number,
                ${text('n.tx_hash')} AS tx_hash,
                n.log_index AS log_index,
                ${text('n.data')} AS meta
              FROM notifications n
              LEFT JOIN posts p
                ON n.entity_type = 'post'
                AND p.network_id = n.network_id
                AND p.id = CAST(n.entity_id AS UNSIGNED)
              WHERE ${where.join(' AND ')}
              ORDER BY n.created_at DESC
              LIMIT ?
            `,
            params,
          }
        }),
  },

  {
    id: 'bets',
    kinds: ['bet'],
    build: ({ networkId, before, limit }) => {
      const where = ['b.bettor IS NOT NULL', 'COALESCE(m.hidden, 0) = 0']
      const params = []

      if (networkId !== null) {
        where.push('b.network_id = ?')
        params.push(networkId)
      }
      if (before !== null) {
        where.push('b.bet_at < ?')
        params.push(before)
      }

      params.push(limit)

      return {
        sql: `
          SELECT
            ${text("'bet'")} AS kind,
            ${text('b.bettor')} AS actor,
            ${text('NULL')} AS subject,
            b.network_id AS network_id,
            ${text("'market'")} AS entity_type,
            ${text('CAST(b.market_id AS CHAR)')} AS entity_id,
            b.bet_at AS ts,
            ${text("CONCAT('bet:', b.id)")} AS uid,
            b.block_number AS block_number,
            ${text('b.tx_hash')} AS tx_hash,
            b.log_index AS log_index,
            ${text(`JSON_OBJECT(
              'outcome', b.outcome,
              'title', COALESCE(m.title, ''),
              'amount', CASE
                WHEN m.token IS NULL OR m.token = '0x0000000000000000000000000000000000000000'
                THEN CAST(b.amount AS CHAR)
                ELSE NULL
              END,
              'symbol', COALESCE(nw.currency_symbol, ''),
              'decimals', 18
            )`)} AS meta
          FROM market_bets b
          LEFT JOIN markets m ON m.network_id = b.network_id AND m.market_id = b.market_id
          LEFT JOIN networks nw ON nw.id = b.network_id
          WHERE ${where.join(' AND ')}
          ORDER BY b.bet_at DESC
          LIMIT ?
        `,
        params,
      }
    },
  },

  {
    id: 'swaps',
    kinds: ['swap'],
    build: ({ networkId, before, limit }) => {
      const where = ['s.wallet_address IS NOT NULL']
      const params = []

      if (networkId !== null) {
        where.push('s.network_id = ?')
        params.push(networkId)
      }
      if (before !== null) {
        where.push('s.created_at < ?')
        params.push(before)
      }

      params.push(limit)

      return {
        sql: `
          SELECT
            ${text("'swap'")} AS kind,
            ${text('s.wallet_address')} AS actor,
            ${text('NULL')} AS subject,
            s.network_id AS network_id,
            ${text("'swap'")} AS entity_type,
            ${text('CAST(s.id AS CHAR)')} AS entity_id,
            s.created_at AS ts,
            ${text("CONCAT('swap:', s.id)")} AS uid,
            -- Swaps are logged by the browser at confirmation, not scanned from a block, so this
            -- one source has no height to report; the feed renders those rows as loose links.
            NULL AS block_number,
            ${text('s.tx_hash')} AS tx_hash,
            NULL AS log_index,
            ${text(`JSON_OBJECT(
              'token_in_symbol', s.token_in_symbol,
              'token_out_symbol', s.token_out_symbol,
              'venue', s.venue,
              'verified', s.verified
            )`)} AS meta
          FROM swap_activity s
          WHERE ${where.join(' AND ')}
          ORDER BY s.created_at DESC
          LIMIT ?
        `,
        params,
      }
    },
  },
]

export const ACTIVITY_KINDS = SOURCES.flatMap((source) => source.kinds)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const limit = clampNumber(parseInt(searchParams.get('limit'), 10), 1, MAX_LIMIT, DEFAULT_LIMIT)
    const before = parseCursor(searchParams.get('before'))
    const networkId = parseNetworkId(searchParams.get('network_id'))

    const requested = parseKinds(searchParams.get('kinds'))
    if (requested === null) {
      return NextResponse.json({ success: false, error: 'Unknown kind requested' }, { status: 400 })
    }

    // One extra row decides hasMore without a second query.
    const branchLimit = limit + 1

    // A source answers with one branch, or with several when splitting them lets each use an index
    // (see the notifications source).
    const branches = SOURCES.flatMap((source) => {
      const kinds = source.kinds.filter((kind) => requested.includes(kind))
      if (kinds.length === 0) return []
      return [source.build({ kinds, networkId, before, limit: branchLimit })].flat()
    })

    if (branches.length === 0) {
      return NextResponse.json({ success: true, data: [], nextCursor: null, meta: { count: 0, hasMore: false } })
    }

    // Each branch trims itself to a page before the merge, so the union never materializes more
    // than branches × page rows — and the network name is joined once, after the cut.
    const unioned =
      branches.length === 1
        ? branches[0].sql
        : `${branches.map(({ sql }) => `(${sql})`).join('\n          UNION ALL\n          ')}
           ORDER BY ts DESC
           LIMIT ?`

    const params = branches.flatMap(({ params: branchParams }) => branchParams)
    if (branches.length > 1) params.push(branchLimit)

    const [rows] = await pool.execute(
      `
        SELECT a.*, nw.name AS network_name, nw.currency_symbol, nw.explorer_url
        FROM (
          ${unioned}
        ) AS a
        LEFT JOIN networks nw ON nw.id = a.network_id
        ORDER BY a.ts DESC
      `,
      params,
    )

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: page.map(serializeActivity),
      // Cursor is the oldest timestamp on the page; ties are dropped client-side by uid.
      nextCursor: hasMore ? Number(page[page.length - 1].ts) : null,
      meta: { count: page.length, hasMore, kinds: requested },
    })
  } catch (error) {
    console.error('[ACTIVITY_FETCH_ERROR]:', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch activity',
        details: process.env.NODE_ENV === 'production' ? undefined : error.message,
      },
      { status: 500 },
    )
  }
}

function serializeActivity(row) {
  return {
    uid: row.uid,
    kind: row.kind,
    actor: row.actor,
    subject: row.subject,
    network_id: row.network_id === null ? null : Number(row.network_id),
    network_name: row.network_name,
    currency_symbol: row.currency_symbol,
    explorer_url: row.explorer_url,
    entity_type: row.entity_type,
    entity_id: row.entity_id === null ? null : String(row.entity_id),
    ts: Number(row.ts),
    // The receipt trio: a row with no block_number was never read from a block (swaps).
    block_number: row.block_number === null ? null : Number(row.block_number),
    tx_hash: row.tx_hash,
    log_index: row.log_index === null ? null : Number(row.log_index),
    meta: parseJson(row.meta),
  }
}

function parseKinds(value) {
  if (!value) return ACTIVITY_KINDS

  const kinds = value
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean)

  if (kinds.length === 0) return ACTIVITY_KINDS
  if (kinds.some((kind) => !ACTIVITY_KINDS.includes(kind))) return null

  return kinds
}

function parseCursor(value) {
  const cursor = parseInt(value, 10)
  return Number.isFinite(cursor) && cursor > 0 ? cursor : null
}

function parseNetworkId(value) {
  const networkId = parseInt(value, 10)
  return Number.isFinite(networkId) && networkId > 0 ? networkId : null
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
