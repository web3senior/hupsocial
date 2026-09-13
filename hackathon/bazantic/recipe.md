# Recipe: Hup Launch market data

You are reading this because you have access to the Hup Launch API through a paid Gateway. This
Recipe tells you when the service is useful, what each call needs, and how to read the answer.

## When this service is useful

Use it when a user asks about tokens launched on Hup Social (https://hup.social): which launches
are trending, how a specific token is priced, who holds it, who is making money on it, or what
its recent trades look like. Every launch is a live Uniswap v4 pool, so "price" here is the
pool's last traded price, not a listing price.

Do not use it for tokens that were not launched on Hup, for wallet balances outside these
launches, or to execute trades. It is read-only.

## What you need before calling

1. **A `networkId`.** Every launch lives on one chain and is identified by that chain's numeric
   id. Base Sepolia is `84532`. Launch ids restart from 1 on every chain, so a launch id without
   a `networkId` is ambiguous. If the user names a chain, map it to its id; if they do not, ask,
   or default to `84532` and say so.
2. **A launch reference** for the per-launch routes: either the token contract address
   (`0x...`, 40 hex characters) or the numeric launch id. The single-launch route accepts both.
   The holders, leaderboard and trades routes accept the numeric id only, so when you start from
   an address, call the single-launch route first and read `launch_id` from the response.

## Calls, in the order you will usually need them

1. `GET /api/v1/launches?networkId=84532&sort=vol24h&stats=1&limit=10`
   Ranks launches by 24-hour volume with the trade statistics attached. Use `sort=mcap` for
   market cap, `scope=new` for the newest, `q=` to search by name, symbol or description.
   `stats=1` is what adds `volume_24h`, `txns_24h`, `trader_count`, `ath_price`, the
   `price_*_ago` fields and `spark`. Without it those fields are absent.
2. `GET /api/v1/launches/{networkId}/{launch_id}`
   One launch with its creator profile and landing-page copy. Add `holder=0x...` to include
   that wallet's cost basis as `position`.
3. `GET /api/v1/launches/{networkId}/{launch_id}/holders?limit=10`
   Current holders ranked by balance. Pool, factory, locker and burn addresses are already
   excluded, so the first row is the largest human holder.
4. `GET /api/v1/launches/{networkId}/{launch_id}/leaderboard?limit=10`
   Traders ranked by profit, exited or not.
5. `GET /api/v1/launches/{networkId}/{launch_id}/trades?limit=50`
   Recent trades, oldest first. `side` is `0` for a buy and `1` for a sell.

## How to interpret the result

- Every response is `{ "success": true, "data": ..., "meta": {...} }`. If `success` is false,
  read `error` and stop; do not retry the same call more than once.
- **All money figures are strings of raw base units of the quote asset**, not decimals. Divide
  by `10 ** quote_decimals` to get a human amount and multiply by `quote_usd` for dollars.
  `quote_usd` is `null` when no price feed exists; then report the amount in the quote asset
  and say there is no dollar figure.
- `price` is the quote-asset value of one whole token, again in raw base units. Market cap is
  `price * 1_000_000_000 / 1e18` (every launch has a fixed supply of one billion tokens with 18
  decimals), converted with `quote_decimals` and `quote_usd` as above.
- `volume_24h` and `volume_native` are also raw quote-asset units. Prefer `volume_24h` when the
  user asks about recent activity; `volume_native` is lifetime.
- Holder balances (`balance`) and trade `token_amount` are raw launch-token units with 18
  decimals.
- `held_value` and `pnl` on the leaderboard are already in quote-asset base units; a `pnl` below
  zero is a loss.
- `spark` is a list of up to twelve two-hour closing prices over the last day, oldest first, in
  raw quote units; use it for direction, not for exact values.
- Timestamps (`created_at`, `last_trade_at`, `traded_at`) are Unix seconds.
- `display_name` and `profile_image` are the Hup profile of the wallet when one exists; show the
  name when present and the shortened address otherwise.
- The data comes from an indexer that trails the chain by seconds to minutes. If a launch the
  user just created is missing, say it is not indexed yet rather than that it does not exist.
- `meta.truncated` on the list route means the sort could not consider every launch; mention
  that when it is true.

## What to say in an answer

Name the token by symbol and name, give the price and market cap in dollars when `quote_usd`
allows and in the quote asset otherwise, give 24-hour volume and trade count, and name the top
holder by display name or shortened address with their share of supply (balance divided by one
billion tokens). Link to `https://hup.social/trade/{networkId}/{token}` so the user can act on it.
