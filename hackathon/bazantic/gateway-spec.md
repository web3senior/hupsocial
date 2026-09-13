# Hup Launch API: Gateway specification

Public, read-only, unauthenticated JSON endpoints served by the Hup Social app. Enter these in
the Bazantic Gateway as the upstream routes. Everything below was read from the route handlers
under `src/app/api/v1/launches/` in the repository, so the parameters and fields are the ones the
API actually accepts and returns.

- Base URL: `https://hup.social`
- Method: `GET` for every route
- Envelope: `{ "success": true, "data": ..., "meta": { ... } }` on success;
  `{ "success": false, "error": "<message>" }` with HTTP 400, 404 or 500 on failure

## Conventions that apply to every route

- **`networkId` is a numeric EVM chain id** (Base Sepolia is `84532`). Launch ids and post ids
  restart from 1 on every chain, so an id is only meaningful together with its `networkId`.
- **All uint256 figures are decimal strings**, never numbers: `price`, `opening_price`,
  `volume_native`, `volume_24h`, `balance`, `native_in`, `native_out`, `held`, `held_value`,
  `pnl`, `native_amount`, `token_amount`, `ath_price`, `price_*_ago`, `spark[]`. They are raw
  base units. Quote-asset figures scale by `quote_decimals`; launch-token figures always have 18
  decimals.
- **`quote`** is the address of the asset the launch is priced in. The zero address means the
  chain's native coin. `quote_symbol`, `quote_decimals` and `quote_usd` (a number, or `null` when
  no price feed exists) ride on every launch row so a caller can render without chain reads.
- **`price`** is the quote-asset value of one whole launch token, in raw quote base units.
  Market cap is `price * 1_000_000_000` scaled by `1e18` (fixed supply of 1B tokens).
- Timestamps are Unix seconds. `display_name` and `profile_image` are the Hup profile of a
  wallet when one exists, else `null`.
- The data comes from an indexer; a launch created seconds ago may not appear yet.

## OpenAPI description

```yaml
openapi: 3.0.3
info:
  title: Hup Launch API
  version: "1"
  description: Read-only market data for tokens launched on Hup Social (Uniswap v4 pools).
servers:
  - url: https://hup.social
paths:
  /api/v1/launches:
    get:
      summary: List launches across chains, with optional trade statistics
      parameters:
        - { name: scope, in: query, schema: { type: string, enum: [trending, new, mine], default: trending },
            description: Which rows are in play. trending = 24h activity then lifetime volume; new = newest first; mine requires creator. }
        - { name: sort, in: query, schema: { type: string, enum: [recent, newest, oldest, mcap, vol24h] },
            description: Reorders the scope's rows. mcap and vol24h sort in memory over at most 300 candidates and set meta.truncated when more matched. }
        - { name: stats, in: query, schema: { type: string, enum: ["1"] },
            description: Attach the 24h rollups (ath_price, trader_count, volume_24h, txns_24h, price_*_ago, spark). Implied by sort=vol24h. }
        - { name: networkId, in: query, schema: { type: integer }, description: Restrict to one chain. Omit for every chain. }
        - { name: creator, in: query, schema: { type: string }, description: Creator wallet address. Required when scope=mine. }
        - { name: q, in: query, schema: { type: string, maxLength: 100 }, description: Substring match on name, symbol or description. }
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: limit, in: query, schema: { type: integer, default: 25, maximum: 50 } }
      responses:
        "200":
          description: A page of launches
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data: { type: array, items: { $ref: "#/components/schemas/LaunchRow" } }
                  nextPage: { type: integer, nullable: true }
                  meta:
                    type: object
                    properties:
                      page: { type: integer }
                      count: { type: integer, description: Rows on this page }
                      total: { type: integer, description: Rows matching the filters, all pages }
                      hasMore: { type: boolean }
                      truncated: { type: boolean, description: True when an in-memory sort could not consider every matching row }
        "400": { description: scope=mine without creator }
        "500": { description: Server error }

  /api/v1/launches/{networkId}/{id}:
    get:
      summary: One launch by token address or numeric launch id
      description: Hidden (moderated) launches are still served here; the list route suppresses them. Either identity is unique per network.
      parameters:
        - { name: networkId, in: path, required: true, schema: { type: integer } }
        - { name: id, in: path, required: true, schema: { type: string },
            description: Token contract address (0x + 40 hex) or the numeric launch id. }
        - { name: holder, in: query, schema: { type: string },
            description: Wallet address. When given and the wallet has traded this launch, the response carries a position object. }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data: { $ref: "#/components/schemas/LaunchDetail" }
                  position:
                    type: object
                    description: Present only when holder was given and has trades here
                    properties:
                      net_tokens: { type: string, description: Tokens bought minus sold, raw 18-decimal units }
                      native_in: { type: string, description: Quote paid on buys, raw units }
                      native_out: { type: string, description: Quote received on sells, raw units }
                      trade_count: { type: integer }
        "400": { description: networkId missing or id neither an address nor an integer }
        "404": { description: Launch not found }

  /api/v1/launches/{networkId}/{id}/holders:
    get:
      summary: Current holders ranked by balance
      description: Balances come from indexed Transfer events. The pool, factory, locker, zero and burn addresses are excluded, so rows are people. Cost basis is joined from trades and is zero for wallets that arrived by transfer.
      parameters:
        - { name: networkId, in: path, required: true, schema: { type: integer } }
        - { name: id, in: path, required: true, schema: { type: integer }, description: Numeric launch id only; an address is rejected with 400. }
        - { name: limit, in: query, schema: { type: integer, default: 30, maximum: 100 } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        wallet_address: { type: string }
                        balance: { type: string, description: Raw 18-decimal token units }
                        native_in: { type: string }
                        native_out: { type: string }
                        trade_count: { type: integer }
                        display_name: { type: string, nullable: true }
                        profile_image: { type: string, nullable: true }
                  meta:
                    type: object
                    properties:
                      count: { type: integer }
                      price: { type: string, description: The launch's last price, raw quote units }
                      quote_usd: { type: number, nullable: true }
        "400": { description: networkId missing or id not numeric }
        "404": { description: Launch not found }

  /api/v1/launches/{networkId}/{id}/leaderboard:
    get:
      summary: Every trader on one launch, ranked by profit
      description: "pnl = native_out + held * price / 1e18 - native_in, computed in SQL from indexed trades. Wallets that sold out still rank."
      parameters:
        - { name: networkId, in: path, required: true, schema: { type: integer } }
        - { name: id, in: path, required: true, schema: { type: integer }, description: Numeric launch id only. }
        - { name: limit, in: query, schema: { type: integer, default: 50, maximum: 100 } }
        - { name: me, in: query, schema: { type: string }, description: A wallet address. If it traded but is below the page, meta.you carries its own row. }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: array
                    items: { $ref: "#/components/schemas/LeaderboardRow" }
                  meta:
                    type: object
                    properties:
                      count: { type: integer }
                      traders: { type: integer, description: Distinct traders on this launch, all pages }
                      price: { type: string }
                      symbol: { type: string }
                      quote_usd: { type: number, nullable: true }
                      you: { nullable: true, allOf: [ { $ref: "#/components/schemas/LeaderboardRow" } ] }
        "400": { description: networkId missing or id not numeric }
        "404": { description: Launch not found }

  /api/v1/launches/{networkId}/{id}/trades:
    get:
      summary: Trade history for one launch, oldest first
      description: One row per Uniswap Swap on the launch pool. The newest `limit` trades are selected, then returned in ascending order.
      parameters:
        - { name: networkId, in: path, required: true, schema: { type: integer } }
        - { name: id, in: path, required: true, schema: { type: integer }, description: Numeric launch id only. }
        - { name: trader, in: query, schema: { type: string }, description: Restrict to one wallet. }
        - { name: limit, in: query, schema: { type: integer, default: 100, maximum: 500 } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        trader: { type: string }
                        side: { type: integer, description: 0 = buy (quote in), 1 = sell (token in) }
                        native_amount: { type: string, description: Quote-asset amount, raw units }
                        token_amount: { type: string, description: Launch-token amount, raw 18-decimal units }
                        price: { type: string, description: Price after this trade, raw quote units }
                        traded_at: { type: integer }
                        block_number: { type: integer }
                        tx_hash: { type: string }
                        display_name: { type: string, nullable: true }
                        profile_image: { type: string, nullable: true }
                  meta:
                    type: object
                    properties:
                      count: { type: integer }
        "400": { description: networkId missing or id not numeric }

  /api/v1/launches/quotes:
    get:
      summary: Assets a launch on one chain can be priced in
      description: What exists (native coin, curated stablecoins, tokenized equities where the chain has a registry), not what the factory has allowlisted.
      parameters:
        - { name: networkId, in: query, required: true, schema: { type: integer } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        address: { type: string, description: Zero address for the native coin }
                        symbol: { type: string }
                        name: { type: string }
                        decimals: { type: integer }
                        logo: { type: string, nullable: true }
                        kind: { type: string, enum: [native, stable, stock] }
                  meta:
                    type: object
                    properties:
                      native: { type: integer }
                      stables: { type: integer }
                      stocks: { type: integer }
        "400": { description: networkId missing }
        "404": { description: Unknown network }

components:
  schemas:
    LaunchRow:
      type: object
      properties:
        network_id: { type: integer }
        launch_id: { type: integer, description: Sequential per chain, starts at 1 }
        wallet_address: { type: string, description: Creator }
        token: { type: string, description: Launch token contract address }
        pool_id: { type: string, description: Uniswap v4 PoolId, bytes32 hex }
        quote: { type: string, description: Quote asset address; zero address = native coin }
        position_token_id: { description: The locked PositionManager NFT id }
        name: { type: string }
        symbol: { type: string }
        creator_share_bps: { type: integer, description: Creator share of quote-side LP fees, in bps of fees }
        opening_price: { type: string }
        price: { type: string, description: Last price, raw quote units per whole token }
        metadata_cid: { type: string, nullable: true }
        description: { type: string, nullable: true }
        image_cid: { type: string, nullable: true }
        trade_count: { type: integer }
        volume_native: { type: string, description: Lifetime quote-side volume, raw units }
        holder_count: { type: integer }
        last_trade_at: { type: integer, nullable: true }
        created_at: { type: integer }
        tx_hash: { type: string }
        display_name: { type: string, nullable: true }
        profile_image: { type: string, nullable: true }
        quote_usd: { type: number, nullable: true }
        quote_symbol: { type: string }
        quote_decimals: { type: integer }
        ath_price: { type: string, description: stats=1 only }
        trader_count: { type: integer, description: stats=1 only }
        volume_24h: { type: string, description: stats=1 only, raw quote units }
        txns_24h: { type: integer, description: stats=1 only }
        price_1h_ago: { type: string, description: stats=1 only; opening_price when younger than the window }
        price_6h_ago: { type: string, description: stats=1 only }
        price_24h_ago: { type: string, description: stats=1 only }
        spark:
          type: array
          items: { type: string }
          description: stats=1 only. Up to twelve two-hour closes over the last day, oldest first.
    LaunchDetail:
      allOf:
        - $ref: "#/components/schemas/LaunchRow"
        - type: object
          properties:
            hidden: { type: integer, description: 1 when moderated out of the directory }
            created_block: { type: integer }
            page:
              type: object
              description: Creator-written landing page copy; every field null and links empty when none exists
              properties:
                tagline: { type: string, nullable: true }
                about: { type: string, nullable: true }
                banner_cid: { type: string, nullable: true }
                website: { type: string, nullable: true }
                x_handle: { type: string, nullable: true }
                telegram: { type: string, nullable: true }
                discord: { type: string, nullable: true }
                farcaster: { type: string, nullable: true }
                links: { type: array, items: { type: object } }
                updated_at: { type: integer, nullable: true }
    LeaderboardRow:
      type: object
      properties:
        rank_position: { type: integer }
        wallet_address: { type: string }
        native_in: { type: string }
        native_out: { type: string }
        held: { type: string, description: Tokens bought minus sold here, raw 18-decimal units, floored at 0 }
        held_value: { type: string, description: held at the launch's last price, raw quote units }
        pnl: { type: string, description: native_out + held_value - native_in; negative is a loss }
        trade_count: { type: integer }
        first_traded_at: { type: integer }
        last_traded_at: { type: integer }
        display_name: { type: string, nullable: true }
        profile_image: { type: string, nullable: true }
```

## Example calls

```
GET https://hup.social/api/v1/launches?networkId=84532&sort=vol24h&stats=1&limit=3
GET https://hup.social/api/v1/launches/84532/1
GET https://hup.social/api/v1/launches/84532/0x0e4f975657430eba8c3c9142ba0c68d683185b2f?holder=0x...
GET https://hup.social/api/v1/launches/84532/1/holders?limit=5
GET https://hup.social/api/v1/launches/84532/1/leaderboard?limit=10&me=0x...
GET https://hup.social/api/v1/launches/84532/1/trades?limit=50
GET https://hup.social/api/v1/launches/quotes?networkId=84532
```
