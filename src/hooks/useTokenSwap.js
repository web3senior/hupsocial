'use client'

/**
 * @file hooks/useTokenSwap.js
 * @description The swap engine behind the in-post trade widget: quote one pair across every
 * venue a chain has, then build the transaction the winner needs.
 *
 * Exact-input only. The widget spends a dollar preset or a slice of a balance and takes
 * whatever the pool gives back, so none of the "solve for a target output" machinery the
 * standalone swap page carries is needed here — that halves the RPC traffic per card, which
 * matters when a feed can hold a dozen of these at once.
 *
 * Headless on purpose: it returns numbers and one submit(), and knows nothing about layout.
 * A second consumer (a full swap page, a profile widget) should reuse this rather than fork it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { encodeFunctionData, erc20Abi, isAddress, parseAbiItem } from 'viem'
import {
  useBalance,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useConfig,
  useWriteContract,
} from 'wagmi'
import { getPublicClient, readContracts } from 'wagmi/actions'
import { CONTRACTS } from '@/config/contracts'
import { FEE_TIERS, ROUTER_ADDRESS_THIS, afterFee, clampFeeBps, withSlippage } from '@/lib/uniswap'
import { V4_PROBE_TIERS, V4_NATIVE, buildV4SwapForKey, launchPoolKey, v4PairKey } from '@/lib/uniswap-v4'
import uniAbi from '@/abis/UniswapV3Periphery.json'
import v4Abi from '@/abis/UniswapV4.json'
import sushiAbi from '@/abis/SushiV2Router.json'
import launchAbi from '@/abis/ArcoLaunch.read.json'
import { resolveStorageImageUrl } from '@/lib/storageHelper'

const ZERO = '0x0000000000000000000000000000000000000000'

// Every EVM chain this app trades on denominates its native currency in 18 decimals
const NATIVE_DECIMALS = 18

// The launchpad announces a new token with its metadata CID; nothing else carries the artwork
const LAUNCH_CREATED_EVENT = parseAbiItem(
  'event LaunchCreated(uint256 indexed launchId, address indexed creator, address indexed token, bytes32 poolId, address quote, uint256 positionTokenId, string name, string symbol, uint160 sqrtPriceX96, uint16 creatorShareBps, string metadata)',
)

// 2.5%, matching the tolerance the rest of the app's trading surfaces default to
export const DEFAULT_SLIPPAGE_BPS = 250

// Permit2 grants to the UniversalRouter expire; 30 days matches the Uniswap interface default
const PERMIT2_EXPIRY_SECONDS = 30 * 24 * 60 * 60

/** The venue addresses a chain has, or nulls when it has none. */
export const venuesFor = (chainId) => {
  const c = CONTRACTS[`chain${chainId}`] ?? {}
  return {
    univ3Router: c.univ3Router || null,
    univ3Quoter: c.univ3Quoter || null,
    univ4Router: c.univ4Router || null,
    univ4Quoters: Array.isArray(c.univ4Quoters) ? c.univ4Quoters.filter(Boolean) : [],
    // Every classic AMM on the chain. They share one ABI, so a chain gains a venue by naming its
    // router — PancakeSwap is where BNB's long tail lives, and Uniswap carries almost none of it.
    // Each carries its own name because the card tells the reader where their trade actually went.
    v2Routers: [
      { address: c.sushiV2Router, label: 'SushiSwap' },
      { address: c.pancakeV2Router, label: 'PancakeSwap' },
    ].filter((entry) => entry.address),
    permit2: c.permit2 || null,
    wnative: c.wnative || null,
    nativeIsErc20: Boolean(c.nativeIsErc20),
  }
}

/**
 * Whether a chain can route a one-tap trade — what the composer gates its chain list on.
 *
 * This is a question about the chain's plumbing, not about any one token. Every chain with a
 * v4 deployment carries some hookless, native-quoted pools at the standard tiers, which is what
 * the probe in lib/uniswap-v4.js looks for; whether a *particular* token has one is settled per
 * token, by asking for a quote, and the composer does that before it will attach anything.
 *
 * Chains whose gas coin is an ERC20 (Circle's Arc, Celo) are included, and their coin address is
 * required rather than optional. There the coin and its token interface are two views of ONE
 * balance — Arc's `0x3600…` returns exactly `native / 1e12`, the same money — so nothing is
 * wrapped and the only extra step is an allowance on the reader's first trade. That costs a tap
 * once, which is worth a chain, and it is the same approval a sell already takes everywhere.
 */
export const canSwapOn = (chainId) => {
  const { univ3Router, univ3Quoter, univ4Router, univ4Quoters, wnative, nativeIsErc20 } = venuesFor(chainId)
  // An ERC20 coin has to be addressable or there is nothing to name as the counter-asset
  if (nativeIsErc20 && !wnative) return false

  return Boolean((univ3Router && univ3Quoter && wnative) || (univ4Router && univ4Quoters.length > 0))
}

/**
 * Every quote call worth making for one pair and one input size. A route with no pool simply
 * fails its slot inside the batch and drops out of the race — nothing has to know in advance
 * which tiers exist.
 */
const buildCandidates = ({ chainId, venues, buying, token, amountIn, feeBps, launchPool, coinErc20Decimals }) => {
  if (!token || amountIn <= 0n) return []

  const { univ3Quoter, univ4Quoters, v2Routers, wnative, nativeIsErc20 } = venues
  const list = []

  // The two faces of an ERC20 coin are the same money at DIFFERENT scales — Arc's native is 18
  // decimals and its token face is 6 — so an amount meant for one is meaningless to the other.
  // Sending the native figure to a 6-decimal pool asks to spend a trillion times the intended
  // sum, which does not error: it just saturates the pool, and every preset comes back with the
  // same answer. Hence a per-candidate amount rather than one figure for the batch.
  const coinAmountFor = (face) => {
    if (!face || face.toLowerCase() === V4_NATIVE) return amountIn
    if (!Number.isFinite(coinErc20Decimals) || coinErc20Decimals === NATIVE_DECIMALS) return amountIn
    return coinErc20Decimals > NATIVE_DECIMALS
      ? amountIn * 10n ** BigInt(coinErc20Decimals - NATIVE_DECIMALS)
      : amountIn / 10n ** BigInt(NATIVE_DECIMALS - coinErc20Decimals)
  }

  // Only a buy spends the coin; a sell spends the token, which is already in its own units
  const spendAmount = (face) => (buying ? coinAmountFor(face) : amountIn)

  // The faces the chain's coin can appear as in a pool. Normally just the native currency, which
  // v4 holds as 0x0. On Arc both exist and both are in real use — its launchpad pools quote
  // against the ERC20 face while other pools quote against native — and since the two are one
  // balance to the holder, either is spendable. Probing only one would hide half the chain.
  const v4Coins = nativeIsErc20 && wnative ? [wnative, V4_NATIVE] : [V4_NATIVE]

  // A launchpad pool is quoted from the key the factory dictates, never probed. It is the only
  // hooked pool this app will touch, and only because every constant in the key came from the
  // factory that minted the token — see launchPoolKey.
  if (launchPool) {
    // resolveLaunchPool reports the direction of a buy; a sell runs the same pool backwards
    const zeroForOne = buying ? launchPool.zeroForOne : !launchPool.zeroForOne
    const exactAmount = spendAmount(launchPool.quote)
    for (const quoter of univ4Quoters) {
      list.push({
        venue: 'launch',
        poolKey: launchPool.poolKey,
        zeroForOne,
        amountIn: exactAmount,
        contract: {
          abi: v4Abi.quoter,
          address: quoter,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: launchPool.poolKey, zeroForOne, exactAmount, hookData: '0x' }],
          chainId,
        },
      })
    }
  }

  // v3 speaks WNATIVE on the native leg, so both sides always resolve to ERC20 addresses
  const inAddress = buying ? wnative : token
  const outAddress = buying ? token : wnative

  const v3Amount = spendAmount(buying ? wnative : null)
  if (univ3Quoter && wnative && v3Amount > 0n && inAddress.toLowerCase() !== outAddress.toLowerCase()) {
    for (const fee of FEE_TIERS) {
      list.push({
        venue: 'v3',
        fees: [fee],
        amountIn: v3Amount,
        contract: {
          abi: uniAbi.quoterV2,
          address: univ3Quoter,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn: inAddress, tokenOut: outAddress, amountIn: v3Amount, fee, sqrtPriceLimitX96: 0n }],
          chainId,
        },
      })
    }
  }

  // v4 needs no wrapping either way: native rides as 0x0, and an ERC20 coin is simply the other
  // currency. Direction follows the sort rather than being assumed, since an ERC20 coin can land
  // on either side of the token.
  for (const coin of v4Coins) {
    if (coin.toLowerCase() === token.toLowerCase()) continue
    const exactAmount = spendAmount(coin)
    if (exactAmount <= 0n) continue
    for (const quoter of univ4Quoters) {
      for (const tier of V4_PROBE_TIERS) {
        const poolKey = v4PairKey(coin, token, tier)
        const coinIsCurrency0 = poolKey.currency0.toLowerCase() === coin.toLowerCase()
        const zeroForOne = buying ? coinIsCurrency0 : !coinIsCurrency0
        list.push({
          venue: 'v4',
          tier,
          poolKey,
          zeroForOne,
          amountIn: exactAmount,
          contract: {
            abi: v4Abi.quoter,
            address: quoter,
            functionName: 'quoteExactInputSingle',
            args: [{ poolKey, zeroForOne, exactAmount, hookData: '0x' }],
            chainId,
          },
        })
      }
    }
  }

  // Classic AMMs. None of them can skim a fee, so a route that wins here pays the creator
  // nothing — but excluding them would mean refusing whole tokens outright, since on BNB the
  // long tail trades on PancakeSwap and nowhere else. They compete, and `feeCapable` travels
  // with the quote so the card can say plainly when a trade carries no cut.
  if (wnative && v3Amount > 0n && inAddress.toLowerCase() !== outAddress.toLowerCase()) {
    for (const { address: router, label } of v2Routers) {
      list.push({
        venue: 'v2',
        router,
        label,
        feeCapable: false,
        path: [inAddress, outAddress],
        amountIn: v3Amount,
        contract: {
          abi: sushiAbi.router,
          address: router,
          functionName: 'getAmountsOut',
          args: [v3Amount, [inAddress, outAddress]],
          chainId,
        },
      })
    }
  }

  return list
}

/**
 * The launchpad pool for a token, or null when the token was not launched by the factory this
 * chain names. Every constant comes from the factory, so the hook is known rather than guessed.
 *
 * A launch is only offered when it is priced against the chain's own coin — either the native
 * currency, or the ERC20 face of it on a chain like Arc. Those are the two things a reader is
 * guaranteed to be holding. A launch priced against some third asset quotes perfectly well but
 * could not be bought without first acquiring that asset, and surfacing it would just move the
 * dead end one step later.
 *
 * @returns {Promise<{poolKey: object, zeroForOne: boolean, quote: string}|null>}
 */
export async function resolveLaunchPool(config, { chainId, token }) {
  const factory = CONTRACTS[`chain${chainId}`]?.arcoLaunch
  if (!factory || !token || !isAddress(token)) return null

  try {
    const [launchId, hook, tickSpacing, fee] = await readContracts(config, {
      contracts: [
        { abi: launchAbi, address: factory, functionName: 'launchIdOf', args: [token], chainId },
        { abi: launchAbi, address: factory, functionName: 'hook', chainId },
        { abi: launchAbi, address: factory, functionName: 'TICK_SPACING', chainId },
        { abi: launchAbi, address: factory, functionName: 'LAUNCH_FEE', chainId },
      ],
    })
    if (launchId?.status !== 'success' || BigInt(launchId.result) === 0n) return null
    if (hook?.status !== 'success' || tickSpacing?.status !== 'success' || fee?.status !== 'success') return null

    const record = await readContracts(config, {
      contracts: [{ abi: launchAbi, address: factory, functionName: 'getLaunch', args: [launchId.result], chainId }],
    })
    const quote = record?.[0]?.status === 'success' ? record[0].result?.quote : null
    if (!quote) return null

    const coin = CONTRACTS[`chain${chainId}`]?.wnative
    const spendable = quote.toLowerCase() === ZERO || (coin && quote.toLowerCase() === coin.toLowerCase())
    if (!spendable) return null

    const poolKey = launchPoolKey({ token, quote, fee: fee.result, tickSpacing: tickSpacing.result, hook: hook.result })
    // Spending the quote asset to receive the token: whichever currency the quote sorted into
    return {
      poolKey,
      zeroForOne: poolKey.currency0.toLowerCase() === quote.toLowerCase(),
      quote,
      // For the artwork lookup below. The launch record knows the exact block, which turns an
      // unbounded log scan into a single-block one — the only reason this is affordable here.
      launchId: launchId.result,
      createdBlock: record[0].result?.createdBlock ?? null,
    }
  } catch {
    return null
  }
}

/**
 * A launch's name, symbol and artwork.
 *
 * No logo CDN carries these: GeckoTerminal indexes Arc but returns `image_url: null` for every
 * token on it, and TrustWallet has never heard of the chain. The artwork only exists in the
 * metadata document the creator wrote at launch, referenced by CID in the LaunchCreated event —
 * so that event is where it has to come from.
 *
 * @returns {Promise<{name: string|null, symbol: string|null, logo: string|null}|null>}
 */
export async function resolveLaunchMeta(config, { chainId, launchId, createdBlock }) {
  const factory = CONTRACTS[`chain${chainId}`]?.arcoLaunch
  if (!factory || launchId === undefined || launchId === null || createdBlock === null) return null

  try {
    const client = getPublicClient(config, { chainId })
    const logs = await client.getLogs({
      address: factory,
      event: LAUNCH_CREATED_EVENT,
      args: { launchId: BigInt(launchId) },
      fromBlock: BigInt(createdBlock),
      toBlock: BigInt(createdBlock),
    })

    const created = logs[0]?.args
    if (!created) return null

    const cid = typeof created.metadata === 'string' ? created.metadata.replace(/^ipfs:\/\//, '') : ''
    let image = null
    if (cid) {
      // Through the app's own gateway proxy, which already handles fallbacks and CORS
      const meta = await fetch(`/api/ipfs/object?cid=${encodeURIComponent(cid)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
      image = typeof meta?.image === 'string' ? meta.image : null
    }

    return {
      name: created.name || null,
      symbol: created.symbol || null,
      logo: image ? resolveStorageImageUrl(image) : null,
      // The unresolved reference as well. A caller that stores this keeps a CID rather than one
      // gateway's URL, so the artwork survives whichever gateway is serving it today.
      image: image || null,
    }
  } catch {
    return null
  }
}

// A nominal buy used only to ask "does any pool exist for this token at all". Small enough to
// quote against a thin pool, large enough not to round to zero out of a fat one.
const ROUTE_PROBE_AMOUNT = 10n ** 16n

/**
 * Whether any venue can route a trade for one token right now — asked imperatively, outside
 * React, so the composer can refuse a token before it is attached rather than shipping a card
 * that says "no route" in every reader's feed.
 *
 * This is the check that makes the chain-level gate honest: `canSwapOn` only says a chain has
 * plumbing, and on the launchpad chains most pools sit behind hooks or non-standard tick
 * spacings that the hookless probe cannot reach. Only a real quote settles it per token.
 *
 * @param {Object} config wagmi config
 * @param {{chainId: number, token: string}} params
 * @returns {Promise<{route: 'routable'|'no-route'|'unknown', feeCapable: boolean}>} 'unknown'
 *   when the chain could not be reached at all, which is a different answer from "this token has
 *   no pool". `feeCapable` says whether the winning venue can pay the author a cut — a classic
 *   AMM cannot, and the composer has to tell the author that before they choose a rate.
 */
export async function probeRoute(config, { chainId, token }) {
  const venues = venuesFor(chainId)
  const launchPool = await resolveLaunchPool(config, { chainId, token })
  const candidates = buildCandidates({ chainId, venues, buying: true, token, amountIn: ROUTE_PROBE_AMOUNT, feeBps: 0, launchPool })
  if (candidates.length === 0) return { route: 'no-route', feeCapable: false }

  // A pool that does not exist reverts; an endpoint that is rate-limiting or down also reverts,
  // and from the outside those look identical. So the batch carries a control the chain must be
  // able to answer — the token's own decimals(). If the control comes back, the chain is up and
  // a clean sweep of quote failures really does mean no pool. If it does not, we learned nothing
  // about the token, and refusing the author's choice on that basis would be a lie.
  const control = { abi: erc20Abi, address: token, functionName: 'decimals', chainId }

  let results
  try {
    results = await readContracts(config, { contracts: [control, ...candidates.map((candidate) => candidate.contract)] })
  } catch {
    return { route: 'unknown', feeCapable: false }
  }

  const [alive, ...quotes] = results
  // The same race the card runs, so "can this pay a cut" is answered by the route that would
  // actually win rather than by whichever venue happens to exist on the chain
  const winner = bestOf(quotes, candidates)
  if (winner) return { route: 'routable', feeCapable: winner.feeCapable !== false }

  return { route: alive?.status === 'success' ? 'no-route' : 'unknown', feeCapable: false }
}

/**
 * A slot's output. The Uniswap quoters return structs whose first field is the output; Sushi's
 * getAmountsOut returns the amounts along the path, output last — reading result[0] there would
 * hand back the input and corrupt the race.
 */
const quotedOut = (candidate, entry) => {
  if (entry?.status !== 'success') return 0n
  if (candidate.venue === 'v2') {
    const amounts = entry.result
    return Array.isArray(amounts) && amounts.length > 0 ? amounts[amounts.length - 1] : 0n
  }
  return entry.result?.[0] ?? 0n
}

/** The best-answering slot of a quote batch: highest output wins, failures drop out. */
const bestOf = (results, candidates) => {
  if (!results || candidates.length === 0) return null

  let bestIndex = -1
  let bestOut = 0n
  results.forEach((entry, index) => {
    const amountOut = quotedOut(candidates[index], entry)
    if (amountOut > bestOut) {
      bestOut = amountOut
      bestIndex = index
    }
  })
  if (bestIndex < 0) return null

  const { venue, fees, tier, path, poolKey, zeroForOne, amountIn, router, label, feeCapable } = candidates[bestIndex]
  // amountIn travels with the winner: it is the figure scaled to THAT pool's input currency,
  // and spending the unscaled one would be a different trade entirely
  // Uniswap covers v3, v4 and the launchpad pools; a classic AMM names itself
  return { amountOut: bestOut, amountIn, venue, fees, tier, path, poolKey, zeroForOne, router, feeCapable, label: label ?? 'Uniswap' }
}

/**
 * A token's onchain identity and the viewer's two balances on that chain.
 *
 * Exported because sizing a sell needs the balance *before* an amount exists, and the amount
 * is what useTokenSwap takes — asking the engine twice to break that loop would read the same
 * three slots twice. Both callers share one react-query key, so this costs no extra traffic.
 *
 * Decimals come off the chain, never off a post: a post claiming 6 on an 18-decimal token
 * would misprice every preset by a factor of a trillion.
 *
 * @param {number} chainId
 * @param {string|null} token
 * @param {string|null} account
 */
export function useTokenIdentity(chainId, token, account) {
  const hasToken = Boolean(token && isAddress(token))

  const { data, refetch } = useReadContracts({
    contracts: [
      { abi: erc20Abi, address: token, functionName: 'decimals', chainId },
      { abi: erc20Abi, address: token, functionName: 'symbol', chainId },
      { abi: erc20Abi, address: token, functionName: 'balanceOf', args: [account ?? ZERO], chainId },
      { abi: erc20Abi, address: token, functionName: 'name', chainId },
    ],
    query: { enabled: hasToken && Boolean(chainId) },
  })

  const { data: native, refetch: refetchNative } = useBalance({
    address: account ?? undefined,
    chainId,
    query: { enabled: Boolean(account && chainId) },
  })

  return {
    decimals: data?.[0]?.status === 'success' ? Number(data[0].result) : null,
    symbol: data?.[1]?.status === 'success' ? data[1].result : null,
    name: data?.[3]?.status === 'success' ? data[3].result : null,
    tokenBalance: data?.[2]?.status === 'success' ? data[2].result : undefined,
    nativeBalance: native?.value,
    nativeSymbol: native?.symbol ?? null,
    refetch,
    refetchNative,
  }
}

/**
 * @param {Object} options
 * @param {number} options.chainId The token's chain — the widget's, not the post's.
 * @param {string} options.token The ERC20 being traded.
 * @param {'buy'|'sell'} options.direction Buy spends native coin, sell spends the token.
 * @param {bigint} options.amountIn Exact input in the spending side's base units.
 * @param {string|null} options.account The connected wallet.
 * @param {number} [options.feeBps] Creator fee, clamped to the v3 router's 100 bip ceiling.
 * @param {string|null} [options.feeRecipient] Who the fee pays. Never read from post JSON.
 * @param {number} [options.slippageBps]
 */
export function useTokenSwap({
  chainId,
  token,
  direction = 'buy',
  amountIn = 0n,
  account = null,
  feeBps = 0,
  feeRecipient = null,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
}) {
  const buying = direction === 'buy'
  const venues = useMemo(() => venuesFor(chainId), [chainId])
  const hasToken = Boolean(token && isAddress(token))

  // The fee is only ever as large as the routers will honour, and only pays a real address.
  // Both guards live here rather than at the call site: this is the one place that builds the
  // calldata, so it is the one place that cannot be bypassed by a hand-edited post.
  const fee = useMemo(() => {
    const bps = clampFeeBps(feeBps)
    const recipient = feeRecipient && isAddress(feeRecipient) ? feeRecipient : null
    return bps > 0 && recipient ? { bps, recipient } : { bps: 0, recipient: null }
  }, [feeBps, feeRecipient])

  // --- the traded token's identity and the trader's two balances ---

  const identity = useTokenIdentity(chainId, token, account)
  const { decimals, symbol, name, tokenBalance, nativeBalance, nativeSymbol } = identity

  // --- the launchpad pool, when this token came from one ---

  // Resolved once per token and then held: a launch's hook, tier and quote asset are immutable,
  // so this is four reads that never need repeating for the life of the card.
  const wagmiConfig = useConfig()
  // Stamped with the pair it was resolved for rather than cleared on change: clearing would be
  // a synchronous state write inside the effect, and a stale pool key belonging to the previous
  // token is exactly the kind of thing that must never reach a swap.
  const [resolved, setResolved] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!hasToken || !chainId) return undefined

    resolveLaunchPool(wagmiConfig, { chainId, token })
      .then(async (pool) => {
        if (cancelled) return
        setResolved({ chainId, token, pool })
        if (!pool) return
        // Artwork is a second, slower step behind an IPFS fetch — the pool lands first so the
        // card can quote while the logo is still coming
        const meta = await resolveLaunchMeta(wagmiConfig, { chainId, launchId: pool.launchId, createdBlock: pool.createdBlock }).catch(() => null)
        if (!cancelled && meta) setResolved({ chainId, token, pool, meta })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [wagmiConfig, chainId, token, hasToken])

  const launchPool = resolved && resolved.chainId === chainId && resolved.token === token ? resolved.pool : null
  // Name and artwork for a launchpad token, which no logo CDN carries
  const launchMeta = resolved && resolved.chainId === chainId && resolved.token === token ? (resolved.meta ?? null) : null

  // --- the quote race ---

  // The coin's token face can be scaled differently from its native form (Arc: 6 against 18).
  // Immutable, so this is read once and cached forever.
  const { data: coinErc20Decimals } = useReadContract({
    abi: erc20Abi,
    address: venues.nativeIsErc20 ? (venues.wnative ?? undefined) : undefined,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(venues.nativeIsErc20 && venues.wnative && chainId), staleTime: Infinity },
  })

  const candidates = useMemo(
    () =>
      buildCandidates({
        chainId,
        venues,
        buying,
        token: hasToken ? token : null,
        amountIn,
        feeBps: fee.bps,
        launchPool,
        coinErc20Decimals: Number.isFinite(Number(coinErc20Decimals)) ? Number(coinErc20Decimals) : undefined,
      }),
    [chainId, venues, buying, token, hasToken, amountIn, fee.bps, launchPool, coinErc20Decimals],
  )

  const { data: quoteResults, isLoading: isQuoting } = useReadContracts({
    contracts: candidates.map((candidate) => candidate.contract),
    query: { enabled: candidates.length > 0, refetchInterval: 20_000 },
  })

  const best = useMemo(() => bestOf(quoteResults, candidates), [quoteResults, candidates])

  // The figure everything downstream spends: scaled to the winning pool's own input currency.
  // Before a quote lands there is no pool to scale for, so the caller's own units stand in.
  const spendAmountIn = best?.amountIn ?? amountIn

  // The fee the winning route can actually charge. A classic AMM has no primitive for one, so a
  // route that wins there pays the creator nothing — and the card must say so rather than print
  // a cut that will not be taken.
  const effectiveFee = useMemo(
    () => (best?.feeCapable === false ? { bps: 0, recipient: null } : fee),
    [best?.feeCapable, fee],
  )

  // What the router is told to enforce, and what actually reaches the trader once the fee
  // sweep has taken its portion — two different numbers, and the card shows the second.
  const minOut = best ? withSlippage(best.amountOut, slippageBps) : 0n
  const expectedOut = best ? afterFee(best.amountOut, effectiveFee.bps) : 0n
  const feeAmount = best ? best.amountOut - expectedOut : 0n

  // --- allowances, which depend on which venue won ---

  // What actually leaves the wallet. A sell always spends the token. A buy spends whichever face
  // of the coin the winning pool is priced in — 0x0 rides as transaction value, an ERC20 face is
  // pulled by allowance — so this follows the quote rather than the chain, because on Arc both
  // faces are in use and the answer differs per pool.
  const spendCurrency = buying
    ? best?.poolKey
      ? best.zeroForOne
        ? best.poolKey.currency0
        : best.poolKey.currency1
      : venues.nativeIsErc20
        ? venues.wnative
        : null
    : hasToken
      ? token
      : null
  const spendIsNative = !spendCurrency || spendCurrency.toLowerCase() === ZERO
  const spendToken = spendIsNative ? null : spendCurrency
  const spendingErc20 = Boolean(spendToken) && spendAmountIn > 0n
  // A launch pool is a v4 pool: same router, same Permit2 grants when selling into it
  const wonOnV4 = best?.venue === 'v4' || best?.venue === 'launch'

  const { data: v3Allowance = 0n, refetch: refetchV3 } = useReadContract({
    abi: erc20Abi,
    address: spendToken ?? undefined,
    functionName: 'allowance',
    args: [account ?? ZERO, venues.univ3Router ?? ZERO],
    chainId,
    query: { enabled: Boolean(spendingErc20 && account && venues.univ3Router) },
  })

  const { data: sushiAllowance = 0n, refetch: refetchSushi } = useReadContract({
    abi: erc20Abi,
    address: spendToken ?? undefined,
    functionName: 'allowance',
    args: [account ?? ZERO, best?.router ?? ZERO],
    chainId,
    query: { enabled: Boolean(spendingErc20 && account && best?.router) },
  })

  // v4 pulls ERC20 input through Permit2, which needs two grants: token → Permit2 (a plain
  // ERC20 allowance) and Permit2 → UniversalRouter (its own allowance, with an expiry)
  const wantsPermit2 = Boolean(spendingErc20 && account && venues.permit2 && venues.univ4Router)
  const { data: permit2Erc20 = 0n, refetch: refetchPermit2Erc20 } = useReadContract({
    abi: erc20Abi,
    address: spendToken ?? undefined,
    functionName: 'allowance',
    args: [account ?? ZERO, venues.permit2 ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })
  const { data: permit2Grant, refetch: refetchPermit2Grant } = useReadContract({
    abi: v4Abi.permit2,
    address: venues.permit2 ?? undefined,
    functionName: 'allowance',
    args: [account ?? ZERO, spendToken ?? ZERO, venues.univ4Router ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })

  // A Permit2 grant carries an expiry, so deciding whether one is still good needs the clock —
  // which cannot be read during render. It is sampled into state instead, and only ticks while
  // there is actually a grant to age out: the common path here is a native buy, which needs no
  // Permit2 at all and so runs no timer.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!wantsPermit2) return undefined
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(timer)
  }, [wantsPermit2])

  const needsV3Approve = Boolean(best?.venue === 'v3' && spendingErc20 && v3Allowance < spendAmountIn)
  const needsSushiApprove = Boolean(best?.venue === 'v2' && spendingErc20 && sushiAllowance < spendAmountIn)
  const needsPermit2Erc20 = Boolean(wonOnV4 && spendingErc20 && permit2Erc20 < spendAmountIn)
  const needsPermit2Grant = Boolean(
    wonOnV4 &&
      spendingErc20 &&
      !needsPermit2Erc20 &&
      (!permit2Grant || permit2Grant[0] < spendAmountIn || Number(permit2Grant[1]) <= nowSeconds),
  )
  const needsApproval = needsV3Approve || needsSushiApprove || needsPermit2Erc20 || needsPermit2Grant

  // --- submission ---

  const { data: hash, isPending, writeContract, error: submitError, reset } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })
  // State rather than a ref: the card reads this while rendering its confirmation toast, and a
  // ref read during render is exactly the stale-value trap React warns about
  const [lastAction, setLastAction] = useState(null)

  useEffect(() => {
    if (!isConfirmed) return
    identity.refetch()
    identity.refetchNative()
    refetchV3()
    refetchSushi()
    refetchPermit2Erc20()
    refetchPermit2Grant()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const submit = useCallback(() => {
    if (!account || !best || spendAmountIn <= 0n || !hasToken) return

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

    if (needsApproval) {
      setLastAction('approve')
      if (needsPermit2Grant) {
        writeContract({
          abi: v4Abi.permit2,
          address: venues.permit2,
          functionName: 'approve',
          args: [spendToken, venues.univ4Router, spendAmountIn, Math.floor(Date.now() / 1000) + PERMIT2_EXPIRY_SECONDS],
          chainId,
        })
        return
      }
      const spender = needsV3Approve ? venues.univ3Router : needsSushiApprove ? best.router : venues.permit2
      writeContract({ abi: erc20Abi, address: spendToken, functionName: 'approve', args: [spender, spendAmountIn], chainId })
      return
    }

    setLastAction('swap')

    if (best.venue === 'launch') {
      // The launchpad's own pool, through the same UniversalRouter the probed v4 legs use. The
      // key travelled with the winning quote, so nothing is rebuilt or re-derived here.
      const swap = buildV4SwapForKey(best.poolKey, best.zeroForOne, spendAmountIn, minOut, {
        chainId,
        fee: effectiveFee.bps > 0 ? effectiveFee : null,
      })
      writeContract({
        abi: v4Abi.universalRouter,
        address: venues.univ4Router,
        functionName: 'execute',
        args: [swap.commands, swap.inputs, deadline],
        value: swap.value,
        chainId,
      })
      return
    }

    if (best.venue === 'v4') {
      // The winning candidate carries its own key and direction, so an ERC20-coin chain needs no
      // special case here — the key was already sorted when the quote was built. TAKE_PORTION
      // carries the fee inside the same command list; see lib/uniswap-v4.js.
      const swap = buildV4SwapForKey(best.poolKey, best.zeroForOne, spendAmountIn, minOut, {
        chainId,
        fee: effectiveFee.bps > 0 ? effectiveFee : null,
      })
      writeContract({
        abi: v4Abi.universalRouter,
        address: venues.univ4Router,
        functionName: 'execute',
        args: [swap.commands, swap.inputs, deadline],
        value: swap.value,
        chainId,
      })
      return
    }

    if (best.venue === 'v2') {
      // A classic AMM pays the trader directly — it has no fee hook to route through. Where the
      // coin is an ERC20 there are no ETH entry points to use: both legs are plain tokens.
      const erc20Both = !spendIsNative && buying
      const method = erc20Both
        ? 'swapExactTokensForTokens'
        : buying
          ? 'swapExactETHForTokens'
          : 'swapExactTokensForETH'
      writeContract({
        abi: sushiAbi.router,
        address: best.router,
        functionName: method,
        args:
          method === 'swapExactETHForTokens'
            ? [minOut, best.path, account, deadline]
            : [spendAmountIn, minOut, best.path, account, deadline],
        value: method === 'swapExactETHForTokens' ? spendAmountIn : 0n,
        chainId,
      })
      return
    }

    // v3. A fee sweep has to run after the swap, in the same transaction, which means the
    // output lands on the router first and a multicall pays it out.
    const takesFee = effectiveFee.bps > 0
    // On a chain whose coin is an ERC20 there is no WETH9 and nothing to unwrap: the coin comes
    // out of the pool already in the form the reader holds, so a sell sweeps like any token.
    const coinIsErc20 = !spendIsNative
    const unwraps = !buying && !coinIsErc20
    const params = {
      tokenIn: buying ? venues.wnative : token,
      tokenOut: buying ? token : venues.wnative,
      fee: best.fees[0],
      // Anything the router has to hand on itself — an unwrap, a fee sweep — lands there first
      recipient: takesFee || unwraps ? ROUTER_ADDRESS_THIS : account,
      spendAmountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    }

    const calls = [encodeFunctionData({ abi: uniAbi.swapRouter02, functionName: 'exactInputSingle', args: [params] })]

    // The router checks amountMinimum against the gross balance it holds, before its own fee
    // split, so the guard passed here is the pre-fee minimum in every branch.
    if (unwraps) {
      calls.push(
        takesFee
          ? encodeFunctionData({
              abi: uniAbi.swapRouter02,
              functionName: 'unwrapWETH9WithFee',
              args: [minOut, account, BigInt(effectiveFee.bps), effectiveFee.recipient],
            })
          : encodeFunctionData({ abi: uniAbi.swapRouter02, functionName: 'unwrapWETH9', args: [minOut, account] }),
      )
    } else if (takesFee) {
      calls.push(
        encodeFunctionData({
          abi: uniAbi.swapRouter02,
          functionName: 'sweepTokenWithFee',
          args: [params.tokenOut, minOut, account, BigInt(effectiveFee.bps), effectiveFee.recipient],
        }),
      )
    }

    // Value only when the coin really is the native currency; an ERC20 coin is pulled by allowance
    const coinValue = buying && spendIsNative ? spendAmountIn : 0n

    if (calls.length === 1) {
      writeContract({
        abi: uniAbi.swapRouter02,
        address: venues.univ3Router,
        functionName: 'exactInputSingle',
        args: [params],
        value: coinValue,
        chainId,
      })
      return
    }

    writeContract({
      abi: uniAbi.swapRouter02,
      address: venues.univ3Router,
      functionName: 'multicall',
      args: [calls],
      value: coinValue,
      chainId,
    })
  }, [
    account, best, spendAmountIn, hasToken, needsApproval, needsPermit2Grant, needsV3Approve, needsSushiApprove,
    venues, token, spendToken, spendIsNative, chainId, buying, minOut, effectiveFee, writeContract,
  ])

  // The balance has to be read at the same scale as the amount. On an ERC20-coin chain the two
  // faces are one balance, so the native figure is rescaled rather than fetched again — a wallet
  // holding 19.4 coins must not look short of 5 just because one side counts in 6 decimals.
  const coinBalance =
    spendIsNative || nativeBalance === undefined || !Number.isFinite(Number(coinErc20Decimals))
      ? nativeBalance
      : Number(coinErc20Decimals) > NATIVE_DECIMALS
        ? nativeBalance * 10n ** BigInt(Number(coinErc20Decimals) - NATIVE_DECIMALS)
        : nativeBalance / 10n ** BigInt(NATIVE_DECIMALS - Number(coinErc20Decimals))

  const spendBalance = buying ? coinBalance : tokenBalance
  const insufficient = spendAmountIn > 0n && spendBalance !== undefined && spendAmountIn > spendBalance

  // The scales the card must print these amounts at. Derived here rather than in the card,
  // because only the engine knows which face of the coin the winning pool settled in.
  const coinFaceDecimals = spendIsNative ? NATIVE_DECIMALS : (Number(coinErc20Decimals) || NATIVE_DECIMALS)
  const spendDecimals = buying ? coinFaceDecimals : decimals
  const receiveDecimals = buying ? decimals : coinFaceDecimals

  return {
    // identity
    decimals,
    symbol,
    name,
    tokenBalance,
    nativeBalance,
    nativeSymbol,
    // Scales for display: the coin has two faces on some chains and they differ
    launchMeta,
    spendAmountIn,
    spendDecimals,
    receiveDecimals,
    // quote
    quote: best,
    expectedOut,
    minOut,
    feeAmount,
    feeBps: effectiveFee.bps,
    isQuoting: isQuoting && candidates.length > 0,
    noRoute: !isQuoting && candidates.length > 0 && amountIn > 0n && !best,
    // action
    needsApproval,
    approvalStep: needsPermit2Erc20 || needsPermit2Grant || needsV3Approve || needsSushiApprove,
    insufficient,
    isBusy: isPending || isConfirming,
    isConfirmed,
    lastAction,
    hash,
    submitError,
    submit,
    reset,
  }
}

export default useTokenSwap

/**
 * A launchpad token's own name, ticker and artwork, or null when the token did not come from
 * one. Composes the pool and metadata lookups so a caller that only wants identity does not
 * have to know about pool keys.
 *
 * Worth storing on a post, unlike a logo from a CDN: a launch's artwork exists nowhere else —
 * no logo service indexes these chains — so a switcher pill showing a token that is not the
 * active one has no other way to find it.
 *
 * @returns {Promise<{name: string|null, symbol: string|null, image: string|null}|null>}
 */
export async function fetchLaunchIdentity(config, { chainId, token }) {
  if (!CONTRACTS[`chain${chainId}`]?.arcoLaunch) return null

  const pool = await resolveLaunchPool(config, { chainId, token })
  if (!pool) return null

  const meta = await resolveLaunchMeta(config, { chainId, launchId: pool.launchId, createdBlock: pool.createdBlock })
  return meta ? { name: meta.name, symbol: meta.symbol, image: meta.image } : null
}
