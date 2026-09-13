# Developer feedback: building Hup Launch on Uniswap v4

Written for the Uniswap Foundation developer-relations team after building and shipping the
Hup Launch stack for ETHOnline 2026. Everything below happened while building the code in this
repository; nothing is hypothetical.

## What we built

Hup Launch is a one-phase token launchpad inside Hup Social. A creator names a token in the post
composer and one transaction later it is a live Uniswap v4 pool: `HupLaunch.sol` mints the full
1B supply, initializes an ordinary hookless pool at the canonical 1% tier, deposits the entire
supply as one single-sided range from the opening tick to the tick-space edge through the
PositionManager, hands the position NFT to `HupLaunchLocker.sol`, which has no withdrawal path,
and swaps the creator's opening buy inside `unlock` / `unlockCallback` so no block exists where
the pool is live and unbought. The locker splits fees at collect time by which currency they
landed in and runs a permissionless auto-compounding pot. Around the contracts sit an in-post
swap widget (V4Quoter, UniversalRouter, Permit2 for sells), a dual-venue v3 + v4 swap page, and
a creator fee panel, all fork-tested against the real Base Sepolia deployment.

## What worked well

- **The singleton and native currency.** No per-pool contracts, no WETH anywhere. The opening
  buy is a direct `poolManager.swap` inside our own `unlockCallback`, so the factory has no
  router dependency at all.
- **The Actions model, once understood.** Three different flows are one API:
  `MINT_POSITION + SETTLE_PAIR` to launch, `DECREASE_LIQUIDITY(0) + TAKE_PAIR` to collect fees,
  `INCREASE_LIQUIDITY + SETTLE_PAIR + SWEEP + SWEEP` to compound with a refund.
- **The V4Quoter simulates the exact swap the router will run**, so the in-post quote can never
  disagree with execution.
- **Fees charged on the input token** gave us a free policy lever: buys pay in the quote asset
  (creator income), sells pay in the launch token (a burn share). No swap needed to enforce it.
- **The Swap event carries the post-trade `sqrtPriceX96`**, so the card reprices the moment
  anyone trades, with no indexer round trip.
- **Fork tests against the real deployment** caught every integration problem below before it
  reached a wallet.

## What was hard or confusing

1. **A stale beta PoolManager on Base Sepolia.** A web search returns an old PoolManager /
   PositionManager pair. They cross-reference each other (`posm.poolManager()` returns the pm),
   so the usual verification passes, and the failure surfaced as `UnsupportedAction(0x0d)`,
   because the beta PositionManager did not know `SETTLE_PAIR`. The tell was `nextTokenId`: 135
   on the beta versus tens of thousands on the canonical one. A "deprecated deployments" list
   would have saved a debug cycle.
2. **Hooks versus routability.** Our first v4 iteration used a dynamic-fee hook (a decaying
   launch tax with the creator's atomic buy exempt). It worked, but a pool carrying a hook or the
   `DYNAMIC_FEE_FLAG` is invisible to aggregators and to any canonical-tier probing, including
   our own swap page. We dropped the hook entirely; the pools are now plain 1% / 200-spacing
   pools. Two more surprises on the way: `beforeSwap` sees the router as `sender`, so a per-user
   exemption is unimplementable; and a `DYNAMIC_FEE_FLAG` pool has no tier at all, so nothing
   built around "fee tier" applies to it.
3. **CREATE2 mining and one-shot binding.** The hook address encoded its permission bits
   (`0x2080`), and the mined salt silently stopped matching whenever the artifact was recompiled,
   because the trailing solc metadata hash changed. In fork tests, `deployCodeTo` replaces code
   but not storage, so a fixture placed on the real hook address inherited its already-bound
   state and reverted in `setUp`. A HookMiner walkthrough that mentions metadata drift would
   have helped.
4. **The Swap event delta sign.** v4 emits the swapper's `BalanceDelta` where v3 emitted the
   pool's, while the NatSpec still reads "delta of the pool". Our indexer briefly classified
   every buy as a sell. One sentence in the event docs would fix this.
5. **Selling needs two Permit2 grants** (token to Permit2, then Permit2 to UniversalRouter with an
   expiry) and an ERC20 opening buy needs a third, plain approval to the factory. Three approval
   buttons to explain to a user who only wants to press "sell".
6. **Live price without StateView.** We had no StateView address in our per-chain config, so
   the live price came from the indexed row and the Swap event instead of `slot0`.
7. **Fee units.** Hundredths of a bip (`10_000` = 1%) next to our own basis points meant the
   creator share lived in two unit systems and needed bridging helpers in `lib/launch.js`.
8. **Single-sided mint details.** Tick alignment (`MAX_TICK / spacing * spacing`), a range that
   must start strictly past the current tick on the token's side, `getLiquidityForAmount0`
   versus `Amount1` by sort order, and the rounding dust left behind (we park it at `0xdEaD`).
9. **Fees are credited into the delta of any liquidity modification.** Our compound had to
   collect before increasing, or accrued fees were netted against the compounder's own
   contribution and the creator's split vanished. Documented nowhere we could find.
10. **Vendoring for Foundry.** With OpenZeppelin coming from npm, we `npm pack` v4-periphery and
    copy v4-core, permit2, solmate and its OpenZeppelin into `lib/` with hand-written remappings.
11. **ERC20 quote assets and decimals.** Pricing a launch in USDC or a tokenized equity needed no
    contract change, but every price helper that assumed 1e18 was off by 1e12 until it took
    decimals.

## Docs gaps and suggestions

- Mark superseded testnet deployments as deprecated on the deployments page.
- Document the Swap event delta sign change from v3 in the event's own NatSpec.
- A short "what a hook costs you in routing" page, before the hook tutorials.
- A PositionManager Actions cookbook: the exact params tuple per action, what `SETTLE_PAIR`,
  `TAKE_PAIR` and `SWEEP` do, and that a zero-liquidity `DECREASE_LIQUIDITY` collects fees.
- The V4Quoter return shape (a struct whose first field is `amountOut`).
- The full Permit2 sequence for UniversalRouter v4 swaps in one place.
- A Foundry setup path for v4-periphery when OpenZeppelin comes from npm.

## Wishlist

- A `getPositionFees` view so a UI can show uncollected fees cheaply.
- A helper that enumerates initialized pools for a token pair, instead of probing tiers.
- Aggregator routing for hooked pools behind a registry of audited, benign hooks.
