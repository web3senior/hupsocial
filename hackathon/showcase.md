# ETHOnline 2026 showcase copy

Paste-ready text for the ETHGlobal project page. Continuity Track: Hup Social is a pre-existing
product; everything below describes the feature shipped during the hackathon window.

## Project name

Hup Launch

## Short description (tagline)

Token launches inside social posts that are live Uniswap v4 pools from their first block, with
liquidity locked forever and creator fees paid from LP fees.

## Description

Hup Launch is a one-phase token launchpad built into Hup Social. A creator names a token in the
post composer and one transaction later it is a live Uniswap v4 pool: the factory mints the full
1B supply, initializes an ordinary hookless pool at the canonical 1% tier, deposits the entire
supply as one single-sided range through the PositionManager, hands the position NFT to a locker
with no withdrawal path, and swaps the creator's opening buy inside the same transaction so there
is no block in which the pool is live and unbought.

There is no bonding-curve contract to graduate out of and no migration anyone has to trust. The
curve is the Uniswap position itself. Because every launch is a plain v4 pool, aggregators and
Hup's own swap page route it like any other pool. Creator income is the position's LP fees: the
locker splits them at collect time by which currency they landed in, burns a share of the
token side, and runs a permissionless auto-compounding pot that pays whoever grows the position.

Launches can be quoted in the chain's native coin, in a stablecoin, or in a tokenized equity, with
the opening valuation configured per quote asset. The post itself carries the trading widget:
V4Quoter previews, UniversalRouter executes, Permit2 handles sells. A trade page shows holders,
a leaderboard and the creator fee panel.

## How it's made

Contracts (Solidity 0.8.36, Foundry, fork-tested against the real Base Sepolia v4 deployment):

- HupLaunch.sol is a factory and registry. It builds the PoolKey, calls PoolManager.initialize,
  mints the full-supply position with a MINT_POSITION + SETTLE_PAIR action pair through the
  PositionManager (Permit2 approval in between), and executes the opening buy as a direct
  PoolManager.swap inside its own unlockCallback, so it has no router dependency.
- HupLaunchLocker.sol receives every position NFT and exposes no path that transfers it or
  decreases liquidity. collect is a zero-liquidity DECREASE_LIQUIDITY + TAKE_PAIR; compound is
  INCREASE_LIQUIDITY + SETTLE_PAIR + SWEEP, harvesting first so accrued fees are never netted
  into the compounder's contribution.
- 21 fork tests cover the launch path, the locker split, the compounding pot and permanence.

App (Next.js, viem, wagmi): pool keys are built from the factory's immutable LAUNCH_FEE and
TICK_SPACING rather than probed; swaps are encoded as UniversalRouter V4 actions; the in-post
card watches the PoolManager Swap event filtered by pool id and reprices live. A separate
indexer (cidex) scans LaunchCreated, Swap and Transfer logs; the app only reads its database.

An earlier iteration used a custom dynamic-fee v4 hook for a decaying launch tax. It worked but
made the pools invisible to aggregators and to canonical-tier probing, so it was dropped in favor
of plain pools. That decision and the rest of the developer experience are written up in
FEEDBACK.md.

## Links

- Repository: https://github.com/web3senior/hupsocial
- Uniswap integration section: https://github.com/web3senior/hupsocial#uniswap-v4-integration-ethonline-2026
- FEEDBACK.md: https://github.com/web3senior/hupsocial/blob/main/FEEDBACK.md
- Contracts: https://github.com/web3senior/hupsocial/tree/main/src/contracts/v2/Extensions
- Fork tests: https://github.com/web3senior/hupsocial/tree/main/src/contracts/forge-launch/test
- Base Sepolia PoolManager: 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408

## Prizes to select

- Uniswap Foundation: Best Uniswap Stack Contribution (Continuity Track)
- Bazantic: Help an Agent Use Your Hackathon Project (Continuity Track), if the gateway, recipe
  and video in hackathon/bazantic/ are completed

## Still to do by hand

1. Submit the Uniswap Developer Feedback Form at https://developers.uniswap.org/hackathon-feedback
   with the FEEDBACK.md link above.
2. Bazantic: follow hackathon/bazantic/README.md (account, gateway, recipe, two runs, video,
   username in the submission).
3. Record the demo video and fill the ETHGlobal project page with the text above.
