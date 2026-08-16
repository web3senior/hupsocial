'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from 'viem'
import {
  useBalance,
  useConnection,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { useActiveChain } from '@/hooks/useActiveChain'
import useTokenMarket from '@/hooks/useTokenMarket'
import { withSlippage } from '@/lib/launch'
import { FEE_TIERS, ROUTER_ADDRESS_THIS, encodePath, formatAmount } from '@/lib/uniswap'
import { V4_PROBE_TIERS, buildV4Swap, v4PoolKey } from '@/lib/uniswap-v4'
import NetworkSelect from '@/components/ui/NetworkSelect'
import TokenIcon from '@/components/ui/TokenIcon'
import TokenSelectDialog from './TokenSelectDialog'
import TrendingTokens from './TrendingTokens'
import uniAbi from '@/abis/UniswapV3Periphery.json'
import v4Abi from '@/abis/UniswapV4.json'
import sushiAbi from '@/abis/SushiV2Router.json'
import { toast } from '@/components/NextToast'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, InfoIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import styles from './SwapForm.module.scss'

const ZERO = '0x0000000000000000000000000000000000000000'
const NATIVE = { native: true }

const DEFAULT_SLIPPAGE_BPS = 250 // 2.5%, matching LaunchCard / the pools.trade default
// Bounds on a hand-typed tolerance: under a hundredth of a percent nothing fills, and past
// half the trade you are signing away the price entirely
const MIN_SLIPPAGE_BPS = 1
const MAX_SLIPPAGE_BPS = 5000

// Probe sizes for solving a typed receive amount, as divisors of one whole input token: a
// thousandth and a full unit. Whichever answers with the best marginal rate wins — the
// least-impacted probe is the closest read on price, and the real quote corrects the rest.
const PROBE_DIVISORS = [1000n, 1n]

// Headroom Max leaves on the gas-paying balance so the swap can still pay for itself.
// Mainnet gas costs real money; L2s and testnets need only dust.
const GAS_HEADROOM = {
  1: 2n * 10n ** 15n, // 0.002 ETH
  56: 10n ** 15n, // 0.001 BNB
  default: 10n ** 14n, // 0.0001
}

// Permit2 grants to the UniversalRouter expire; 30 days matches the Uniswap interface default
const PERMIT2_EXPIRY_SECONDS = 30 * 24 * 60 * 60

// minimumFractionDigits 0 so a round amount reads "$25", not "$25.00"
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const compactUsdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const feeLabel = (fee) => `${(fee / 10_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

const percentLabel = (bps) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

/** Fiat value of a base-units amount, or null when the token has no price. */
const usdValue = (amount, decimals, price) => {
  if (!price || amount === undefined || amount === null || decimals === null) return null
  const value = Number(formatUnits(amount, decimals)) * price
  return Number.isFinite(value) ? value : null
}

/** Dollars for the card's own lines: sub-cent amounts round to "$0", so say so instead. */
const usdLabel = (value) => {
  if (value === null || value === undefined) return null
  if (value > 0 && value < 0.01) return '<$0.01'
  return usdFormatter.format(value)
}

/**
 * Token quantity as the card states it: compact past ten thousand (5.7K), four significant
 * digits below it. Reading material, not a promise — the wallet confirms the exact amount.
 */
const tokenQty = (value, decimals) => {
  if (value === undefined || value === null || decimals === null || decimals === undefined) return null
  const asNumber = Number(formatUnits(value, decimals))
  if (!Number.isFinite(asNumber)) return null
  return asNumber >= 10_000 ? compactNumber.format(asNumber) : formatAmount(value, decimals, 4)
}

/** The same quantity with its ticker — what the detail rows and the toggle line show. */
const qtyLabel = (value, decimals, symbol) => {
  const quantity = tokenQty(value, decimals)
  return quantity === null ? null : `${quantity} ${symbol ?? ''}`.trim()
}

/** Trailing zeros make a filled amount field look like a placeholder; strip them. */
const trimZeros = (value) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value)

/** Decimals, symbol, and live balance for one side of the pair; native coins skip the reads. */
const useTokenSide = (token, chainId, owner) => {
  const isErc20 = Boolean(token && !token.native && token.address)

  const erc20 = useReadContracts({
    contracts: [
      { abi: erc20Abi, address: token?.address, functionName: 'decimals', chainId },
      { abi: erc20Abi, address: token?.address, functionName: 'symbol', chainId },
      { abi: erc20Abi, address: token?.address, functionName: 'balanceOf', args: [owner ?? ZERO], chainId },
    ],
    query: { enabled: isErc20 && Boolean(chainId) },
  })
  const native = useBalance({ address: owner, chainId, query: { enabled: Boolean(token?.native && owner && chainId) } })

  if (!token) return { decimals: null, symbol: null, balance: undefined, refetchBalance: null }
  if (token.native) return { decimals: 18, symbol: null, balance: native.data?.value, refetchBalance: native.refetch }

  return {
    decimals: erc20.data?.[0]?.status === 'success' ? Number(erc20.data[0].result) : null,
    symbol: token.symbol ?? (erc20.data?.[1]?.status === 'success' ? erc20.data[1].result : null),
    balance: erc20.data?.[2]?.status === 'success' ? erc20.data[2].result : undefined,
    refetchBalance: erc20.refetch,
  }
}

/**
 * Every candidate route across all venues for one input amount, one quote call each. v3:
 * direct pairs probe each fee tier, WNATIVE-routed pairs every tier pair. v4: hookless
 * native↔token pool keys across the probe tiers, on every known quoter. Sushi (classic v2):
 * the direct pair, plus the WNATIVE hop for token↔token routes. Routes without a pool
 * simply fail their slot and drop out. Lifted out of the component because the form quotes
 * twice — once to price a typed receive amount, once for the swap it actually submits.
 */
const buildCandidates = (route, amountIn) => {
  if (!route || amountIn <= 0n) return []
  const {
    v3Ready,
    v4Ready,
    sushiReady,
    sushiRouter,
    quoterAddress,
    inAddress,
    outAddress,
    isDirect,
    wnative,
    chainId,
    tokenIn,
    tokenOut,
    univ4Quoters,
  } = route
  const list = []

  if (v3Ready && inAddress && outAddress) {
    if (isDirect) {
      for (const fee of FEE_TIERS) {
        list.push({
          venue: 'v3',
          fees: [fee],
          amountIn,
          contract: {
            abi: uniAbi.quoterV2,
            address: quoterAddress,
            functionName: 'quoteExactInputSingle',
            args: [{ tokenIn: inAddress, tokenOut: outAddress, amountIn, fee, sqrtPriceLimitX96: 0n }],
            chainId,
          },
        })
      }
    } else {
      for (const feeA of FEE_TIERS) {
        for (const feeB of FEE_TIERS) {
          list.push({
            venue: 'v3',
            fees: [feeA, feeB],
            amountIn,
            contract: {
              abi: uniAbi.quoterV2,
              address: quoterAddress,
              functionName: 'quoteExactInput',
              args: [encodePath([inAddress, wnative, outAddress], [feeA, feeB]), amountIn],
              chainId,
            },
          })
        }
      }
    }
  }

  // v4 candidates exist only for genuine native↔token pairs — native is currency 0x0 there
  const v4Token = tokenIn?.native ? tokenOut?.address : tokenOut?.native ? tokenIn?.address : null
  if (v4Ready && v4Token) {
    const zeroForOne = Boolean(tokenIn?.native)
    for (const quoter of univ4Quoters) {
      for (const tier of V4_PROBE_TIERS) {
        list.push({
          venue: 'v4',
          tier,
          amountIn,
          contract: {
            abi: v4Abi.quoter,
            address: quoter,
            functionName: 'quoteExactInputSingle',
            args: [{ poolKey: v4PoolKey(v4Token, tier), zeroForOne, exactAmount: amountIn, hookData: '0x' }],
            chainId,
          },
        })
      }
    }
  }

  // Sushi probes its direct pair for every route — v2 has real token↔token pairs, unlike
  // v3's WNATIVE-only two-hop — plus the WNATIVE hop when neither side is the wrapped coin
  if (sushiReady && inAddress && outAddress) {
    const paths = [[inAddress, outAddress]]
    if (!isDirect) paths.push([inAddress, wnative, outAddress])
    for (const path of paths) {
      list.push({
        venue: 'sushi',
        path,
        amountIn,
        contract: {
          abi: sushiAbi.router,
          address: sushiRouter,
          functionName: 'getAmountsOut',
          args: [amountIn, path],
          chainId,
        },
      })
    }
  }

  return list
}

/**
 * A quote slot's output amount. The Uniswap quoters return structs whose first field is the
 * output; Sushi's getAmountsOut returns the amounts along the path, output last — reading
 * result[0] there would hand back the input and corrupt the race.
 */
const quotedOut = (candidate, entry) => {
  if (entry?.status !== 'success') return 0n
  if (candidate.venue === 'sushi') {
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

  const { venue, fees, tier, path, amountIn } = candidates[bestIndex]
  return { amountOut: bestOut, amountIn, venue, fees, tier, path }
}

// The traded token wears no caret once it's picked — the amount beside it is the busy part of
// that row, and the pill still opens the picker. An empty slot always shows one.
const TokenPill = ({ token, symbol, chainId, placeholder, caret = 'none', onClick }) => (
  <button type="button" className={clsx(styles.swap__pill, !token && styles['swap__pill--empty'])} onClick={onClick}>
    {token && <TokenIcon token={token} chainId={chainId} size="md" />}
    <span>{token ? (symbol ?? '…') : (placeholder ?? 'Select')}</span>
    {!token ? <CaretDownIcon size={12} weight="bold" /> : caret === 'right' ? <CaretRightIcon size={13} weight="bold" /> : null}
  </button>
)

/**
 * Swap Form
 * A buy/sell card for one token at a time: the traded token (the asset) sits in the top panel,
 * whatever it trades against (the counter — the chain coin by default) in the panel below, and
 * the mode tabs decide which of the two is being spent. The amount is denominated in dollars
 * wherever a price exists and flips to token units through the line under it, so "$25 of this"
 * and "5.7K of this" are the same control.
 *
 * Underneath, unchanged: exact-input swaps quoted across BOTH Uniswap venues at once and
 * executed on whichever answers best. v3: QuoterV2 previews every fee tier (and every tier pair
 * for WNATIVE-routed token↔token hops), SwapRouter02 executes, native legs travel as WNATIVE
 * with unwrap-in-multicall on the way out — the LaunchCard pattern. v4: V4Quoter probes hookless
 * native↔token pool keys, the UniversalRouter executes, native is currency 0x0 directly, and
 * ERC20 input arrives through the two-step Permit2 grant flow. A chain is live when either venue
 * is fully configured — Robinhood is v4-only, Celo v3-only (its native coin is an ERC20, so
 * v4's 0x0-currency pools don't apply).
 *
 * Dollars always denominate the counter token, the side that has a price feed, so both modes
 * still resolve to one of the two shapes the engine already knows: an exact input, or a receive
 * amount solved back to an input from a probe quote and re-quoted at that size. Both submit as
 * exact-input, so no second router path is involved.
 */
const SwapForm = () => {
  const { address, chain: walletChain } = useConnection()
  const { chain, chainId } = useActiveChain()
  const switchChain = useSwitchChain({ config })

  // What is being traded, and what it trades against. Buy makes the asset the receive side,
  // sell the pay side — everything else on the card follows from these two plus the mode.
  const [mode, setMode] = useState('buy')
  const [asset, setAsset] = useState(null)
  const [counter, setCounter] = useState(NATIVE)
  // Which unit the amount field is typed in: dollars of the counter token, or token units
  const [denom, setDenom] = useState('usd')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  // The tolerance is a plain readout until the pencil turns it into a field
  const [isEditingSlippage, setIsEditingSlippage] = useState(false)
  const [slippageDraft, setSlippageDraft] = useState('')

  const pickerRef = useRef(null)
  const slippageInputRef = useRef(null)
  const pickerTargetRef = useRef('asset')
  // What the pending transaction is, so confirmation knows whether to clear the form
  const lastActionRef = useRef(null)
  // Snapshot of the swap being submitted — reported to /api/v1/swaps once it confirms, so the
  // trending list reflects what people actually trade here. Captured at submit time because
  // the pair/amount state can change while the transaction is in flight.
  const pendingSwapRef = useRef(null)

  const chainContracts = CONTRACTS[`chain${chainId}`]
  const routerAddress = chainContracts?.univ3Router || undefined
  const quoterAddress = chainContracts?.univ3Quoter || undefined
  const wnative = chainContracts?.wnative || undefined
  // Celo-style chains: the native coin IS an ERC20 (no WETH9 in the router), so "native"
  // trades as a plain token — approve instead of msg.value, and never an unwrap
  const nativeIsErc20 = Boolean(chainContracts?.nativeIsErc20)

  const univ4Router = chainContracts?.univ4Router || undefined
  const univ4PoolManager = chainContracts?.univ4PoolManager || undefined
  const univ4Quoters = chainContracts?.univ4Quoters ?? []
  const permit2 = chainContracts?.permit2 || undefined
  const sushiRouter = chainContracts?.sushiV2Router || undefined

  // The venues quote side by side and the best answer executes. v4 only handles genuine
  // native↔token pairs (native is currency 0x0 there), so Celo-style chains and token↔token
  // routes skip it; Robinhood is v4-only the other way around. Sushi (classic v2) rides
  // wherever its router is configured — one address both quotes and executes.
  const v3Ready = Boolean(routerAddress && quoterAddress && wnative)
  const v4Ready = Boolean(univ4Router && univ4PoolManager && univ4Quoters.length > 0 && permit2 && !nativeIsErc20)
  const sushiReady = Boolean(sushiRouter && wnative)
  const canSwapHere = v3Ready || v4Ready || sushiReady

  const nativeSymbol = chain?.nativeCurrency?.symbol ?? 'ETH'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)

  // What "the chain's own coin" means in the picker and as the default counter
  const nativeEntry = useMemo(
    () =>
      nativeIsErc20 && wnative
        ? { address: wnative, symbol: nativeSymbol, name: chain?.nativeCurrency?.name, logo: chain?.iconUrl ?? null }
        : NATIVE,
    [nativeIsErc20, wnative, nativeSymbol, chain],
  )

  // Token addresses are chain-scoped; a chain switch invalidates both selections. chainId
  // must be a dependency in its own right — between two ordinary-native chains nativeEntry
  // is the same NATIVE constant and would never retrigger this on its own.
  useEffect(() => {
    setAsset(null)
    setCounter(nativeEntry)
    setAmount('')
  }, [chainId, nativeEntry])

  // The pair the engine trades, straight off the mode
  const tokenIn = mode === 'buy' ? counter : asset
  const tokenOut = mode === 'buy' ? asset : counter

  const inSide = useTokenSide(tokenIn, chainId, address)
  const outSide = useTokenSide(tokenOut, chainId, address)
  const symbolIn = tokenIn?.native ? nativeSymbol : inSide.symbol
  const symbolOut = tokenOut?.native ? nativeSymbol : outSide.symbol

  const assetSide = mode === 'buy' ? outSide : inSide
  const counterSide = mode === 'buy' ? inSide : outSide
  const symbolAsset = mode === 'buy' ? symbolOut : symbolIn
  const symbolCounter = mode === 'buy' ? symbolIn : symbolOut

  // Native entries carry no logo of their own; the chain icon stands in
  const withChainLogo = (token) => (token?.native ? { ...token, logo: chain?.iconUrl } : token)
  const displayAsset = withChainLogo(asset)
  const displayCounter = withChainLogo(counter)

  // Fiat for the pair — the dollar-denominated field, the value line and the FDV row. Chains
  // DefiLlama can't price fall back to token units throughout.
  const marketAssets = useMemo(() => {
    if (!chainId) return []
    const list = [{ id: `${chainId}:native`, chainId, address: null }]
    for (const token of [tokenIn, tokenOut]) {
      if (!token?.address) continue
      const id = `${chainId}:${token.address.toLowerCase()}`
      if (!list.some((entry) => entry.id === id)) list.push({ id, chainId, address: token.address })
    }
    return list
  }, [chainId, tokenIn, tokenOut])
  const { market } = useTokenMarket(marketAssets)
  const priceOf = (token) => {
    if (!token || !chainId) return null
    const key = token.native ? `${chainId}:native` : `${chainId}:${token.address?.toLowerCase()}`
    return market[key]?.usd ?? null
  }
  const priceIn = priceOf(tokenIn)
  const priceOut = priceOf(tokenOut)
  const priceCounter = mode === 'buy' ? priceIn : priceOut

  // Dollars are only an option where the counter token has a price. Until one arrives the card
  // renders in token units without touching the stored preference, so a chain that prices a
  // moment later still opens in dollars; typing commits whichever unit is on screen.
  const canUseUsd = Boolean(priceCounter && counterSide.decimals !== null)
  const activeDenom = canUseUsd ? denom : 'token'

  // Dollars denominate the counter token, so buying by dollars is an exact input and selling by
  // dollars is a receive target; token units are the mirror of that
  const side = (mode === 'buy') === (activeDenom === 'usd') ? 'in' : 'out'

  // Native legs travel as WNATIVE — that resolution decides the route shape below
  const inAddress = tokenIn?.native ? wnative : tokenIn?.address
  const outAddress = tokenOut?.native ? wnative : tokenOut?.address
  const isSamePair = Boolean(inAddress && outAddress && inAddress.toLowerCase() === outAddress.toLowerCase())
  // Same resolved address with a native side = ETH↔WETH, a wrap; without one it's just a duplicate pick
  const isWrapPair = isSamePair && Boolean(tokenIn?.native || tokenOut?.native)
  const isDirect = Boolean(
    inAddress &&
      outAddress &&
      wnative &&
      (inAddress.toLowerCase() === wnative.toLowerCase() || outAddress.toLowerCase() === wnative.toLowerCase()),
  )

  // The typed amount as token units of whichever side it denominates — dollars divide through
  // the counter price first, so everything downstream sees one shape
  const entryAmount = useMemo(() => {
    if (activeDenom === 'token') return amount
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0 || !priceCounter || counterSide.decimals === null) return ''
    return trimZeros((dollars / priceCounter).toFixed(Math.min(8, counterSide.decimals)))
  }, [activeDenom, amount, priceCounter, counterSide.decimals])

  // Debounce typing so the quoter isn't asked on every keystroke
  const [debouncedAmount, setDebouncedAmount] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(entryAmount), 350)
    return () => clearTimeout(timer)
  }, [entryAmount])

  const parseSafe = (raw, decimals) => {
    const trimmed = raw.trim()
    if (!trimmed || decimals === null) return 0n
    try {
      return parseUnits(trimmed, decimals)
    } catch {
      return 0n
    }
  }

  // The typed field, in base units: one of these is what the user asked for, the other is 0
  const typedIn = useMemo(
    () => (side === 'in' ? parseSafe(debouncedAmount, inSide.decimals) : 0n),
    [side, debouncedAmount, inSide.decimals],
  )
  const targetOut = useMemo(
    () => (side === 'out' ? parseSafe(debouncedAmount, outSide.decimals) : 0n),
    [side, debouncedAmount, outSide.decimals],
  )

  const route = useMemo(
    () =>
      isSamePair || !tokenIn || !tokenOut
        ? null
        : {
            v3Ready,
            v4Ready,
            sushiReady,
            sushiRouter,
            quoterAddress,
            inAddress,
            outAddress,
            isDirect,
            wnative,
            chainId,
            tokenIn,
            tokenOut,
            univ4Quoters,
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v3Ready, v4Ready, sushiReady, sushiRouter, quoterAddress, inAddress, outAddress, isDirect, wnative, chainId, tokenIn, tokenOut, isSamePair],
  )

  // Stage one, only when a receive amount was typed: quote a couple of reference sizes to read
  // the pair's price, then divide the target by it to land on the input to actually swap.
  const probeCandidates = useMemo(() => {
    if (targetOut <= 0n || inSide.decimals === null) return []
    const unit = 10n ** BigInt(inSide.decimals)
    return PROBE_DIVISORS.flatMap((divisor) => buildCandidates(route, unit / divisor))
  }, [route, targetOut, inSide.decimals])

  // Deliberately unpolled: the probe only has to be fresh enough to size the input, the
  // real quote below refreshes on its own, and a second polling batch is what tips public
  // RPCs into rate-limiting. It re-runs whenever the target or the pair changes.
  const { data: probeResults, isLoading: isProbing } = useReadContracts({
    contracts: probeCandidates.map((candidate) => candidate.contract),
    query: { enabled: probeCandidates.length > 0 },
  })

  const derivedIn = useMemo(() => {
    if (!probeResults || probeCandidates.length === 0 || targetOut <= 0n) return 0n

    // Best marginal rate across every probe size and route — the least-impacted read of price
    let rateIn = 0n
    let rateOut = 0n
    probeResults.forEach((entry, index) => {
      const out = quotedOut(probeCandidates[index], entry)
      const { amountIn } = probeCandidates[index]
      if (out <= 0n || amountIn <= 0n) return
      if (rateOut === 0n || out * rateIn > rateOut * amountIn) {
        rateOut = out
        rateIn = amountIn
      }
    })
    if (rateOut === 0n) return 0n

    return (targetOut * rateIn) / rateOut
  }, [probeResults, probeCandidates, targetOut])

  // Stage two — the quote the swap is actually built from, at the size it will really trade
  const amountIn = side === 'in' ? typedIn : derivedIn

  const candidates = useMemo(() => buildCandidates(route, amountIn), [route, amountIn])

  const { data: quoteResults, isLoading: isQuotingRoutes } = useReadContracts({
    contracts: candidates.map((candidate) => candidate.contract),
    query: { enabled: candidates.length > 0, refetchInterval: 15_000 },
  })

  const best = useMemo(() => bestOf(quoteResults, candidates), [quoteResults, candidates])

  // The probe reads price without impact, so the derived input undershoots on a thin pool.
  // Stage two quoted at roughly the right size — scaling by how far it landed from the target
  // closes that gap in one step, and slippage covers what's left.
  const swapAmountIn = useMemo(() => {
    if (side === 'in') return typedIn
    if (!best || best.amountOut <= 0n || amountIn <= 0n) return amountIn
    return (amountIn * targetOut) / best.amountOut
  }, [side, typedIn, best, amountIn, targetOut])

  // What the swap promises to deliver: the quote when paying an exact amount, the typed
  // target when buying one. Slippage is applied to that, and the router enforces it.
  const expectedOut = side === 'in' ? (best?.amountOut ?? 0n) : targetOut
  const minOut = best ? withSlippage(expectedOut, slippageBps) : 0n

  const isQuoting = isProbing || isQuotingRoutes

  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: tokenIn?.address,
    functionName: 'allowance',
    args: [address ?? ZERO, routerAddress ?? ZERO],
    chainId,
    query: { enabled: Boolean(!tokenIn?.native && tokenIn?.address && address && routerAddress) },
  })

  // Sushi takes the same one plain approve as v3, just to its own router
  const { data: sushiAllowance = 0n, refetch: refetchSushiAllowance } = useReadContract({
    abi: erc20Abi,
    address: tokenIn?.address,
    functionName: 'allowance',
    args: [address ?? ZERO, sushiRouter ?? ZERO],
    chainId,
    query: { enabled: Boolean(!tokenIn?.native && tokenIn?.address && address && sushiRouter) },
  })

  // Supply behind the FDV row. A launch nobody lists has no price feed to read, but it does
  // have a pool — and the pool is exactly what this card just quoted against.
  const { data: assetSupply } = useReadContract({
    abi: erc20Abi,
    address: asset?.address,
    functionName: 'totalSupply',
    chainId,
    query: { enabled: Boolean(asset?.address && chainId) },
  })

  // v4 pulls ERC20 input through Permit2, which needs two grants: token → Permit2 (plain
  // ERC20 allowance) and Permit2 → UniversalRouter (its own allowance with an expiry)
  const wantsPermit2 = Boolean(v4Ready && !tokenIn?.native && tokenIn?.address && address)
  const { data: permit2Erc20Allowance = 0n, refetch: refetchPermit2Erc20 } = useReadContract({
    abi: erc20Abi,
    address: tokenIn?.address,
    functionName: 'allowance',
    args: [address ?? ZERO, permit2 ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })
  const { data: permit2Grant, refetch: refetchPermit2Grant } = useReadContract({
    abi: v4Abi.permit2,
    address: permit2,
    functionName: 'allowance',
    args: [address ?? ZERO, tokenIn?.address ?? ZERO, univ4Router ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })

  const { data: hash, isPending, writeContract, error: submitError } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isConfirmed) return
    inSide.refetchBalance?.()
    outSide.refetchBalance?.()
    refetchAllowance()
    refetchSushiAllowance()
    refetchPermit2Erc20()
    refetchPermit2Grant()
    if (lastActionRef.current === 'swap') {
      toast('Swap confirmed', 'success')
      // Fire-and-forget activity report — trending data, never worth blocking the UI over
      if (pendingSwapRef.current && hash) {
        fetch('/api/v1/swaps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...pendingSwapRef.current, txHash: hash }),
        }).catch(() => {})
        pendingSwapRef.current = null
      }
      // Input reset rides the refetches via setTimeout so the effect body itself
      // performs no synchronous state write (same dance as LaunchCard)
      const timer = setTimeout(() => setAmount(''), 0)
      return () => clearTimeout(timer)
    }
    toast('Approval confirmed — ready to swap', 'success')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  // Approval requirements depend on which venue won the quote: v3 and Sushi each take one
  // plain approve to their router; v4 takes token→Permit2, then Permit2→UniversalRouter
  // (amount + unexpired)
  const erc20In = Boolean(!tokenIn?.native && tokenIn?.address && swapAmountIn > 0n)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const needsV3Approve = Boolean(best?.venue === 'v3' && erc20In && allowance < swapAmountIn)
  const needsSushiApprove = Boolean(best?.venue === 'sushi' && erc20In && sushiAllowance < swapAmountIn)
  const needsPermit2Erc20 = Boolean(best?.venue === 'v4' && erc20In && permit2Erc20Allowance < swapAmountIn)
  const needsPermit2Grant = Boolean(
    best?.venue === 'v4' &&
      erc20In &&
      !needsPermit2Erc20 &&
      (!permit2Grant || permit2Grant[0] < swapAmountIn || Number(permit2Grant[1]) <= nowSeconds),
  )
  const needsApproval = needsV3Approve || needsSushiApprove || needsPermit2Erc20 || needsPermit2Grant
  const insufficient = swapAmountIn > 0n && inSide.balance !== undefined && swapAmountIn > inSide.balance
  const isBusy = isPending || isConfirming
  const hasAmount = (side === 'in' ? typedIn : targetOut) > 0n

  const payUsd = usdValue(swapAmountIn, inSide.decimals, priceIn)
  const receiveUsd = usdValue(expectedOut, outSide.decimals, priceOut)

  // The two quantities the card talks about, whichever way round the mode has them
  const assetAmount = mode === 'buy' ? expectedOut : swapAmountIn
  const counterAmount = mode === 'buy' ? swapAmountIn : expectedOut
  const counterUsd = mode === 'buy' ? payUsd : receiveUsd

  // The line under the amount: the same value in the other unit, and the control that makes it
  // the one being typed. With no price feed it falls back to the counter's own amount, which is
  // always knowable and still answers "and what does that cost me?".
  const altValue =
    activeDenom === 'usd'
      ? qtyLabel(assetAmount, assetSide.decimals, symbolAsset)
      : (usdLabel(counterUsd) ?? qtyLabel(counterAmount, counterSide.decimals, symbolCounter))

  // Price per whole token: the listed one where there is one, otherwise whatever this quote
  // implies — for a fresh launch that pool IS the market
  const assetUsd = useMemo(() => {
    const listed = priceOf(asset)
    if (listed) return listed
    if (!best || assetSide.decimals === null || counterUsd === null || assetAmount <= 0n) return null
    const quantity = Number(formatUnits(assetAmount, assetSide.decimals))
    return quantity > 0 ? counterUsd / quantity : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, market, best, assetSide.decimals, counterUsd, assetAmount])

  const fdv = useMemo(() => {
    if (!assetUsd || assetSupply === undefined || assetSide.decimals === null) return null
    const value = Number(formatUnits(assetSupply, assetSide.decimals)) * assetUsd
    return Number.isFinite(value) && value > 0 ? value : null
  }, [assetUsd, assetSupply, assetSide.decimals])

  const sanitize = (raw) => {
    const next = raw.replace(',', '.').replace(/[^0-9.]/g, '')
    return (next.match(/\./g) ?? []).length > 1 ? null : next
  }

  // Typing commits the unit on screen, so a price landing mid-entry can never reinterpret a
  // token amount as dollars
  const handleAmountChange = (event) => {
    const next = sanitize(event.target.value)
    if (next === null) return
    setDenom(activeDenom)
    setAmount(next)
  }

  // The toggle line is literally the alternate reading of what's typed, so flipping units just
  // promotes that value into the field. The live quote is the truest conversion; while one is
  // in flight the token's price stands in, and with neither the flip is a no-op rather than a
  // control that silently empties the field.
  const typedNumber = Number(amount)
  const handleDenomToggle = () => {
    if (activeDenom === 'usd') {
      if (!amount) {
        setDenom('token')
        return
      }
      const next =
        assetAmount > 0n && assetSide.decimals !== null
          ? formatAmount(assetAmount, assetSide.decimals, 7)
          : assetUsd && Number.isFinite(typedNumber) && typedNumber > 0
            ? trimZeros((typedNumber / assetUsd).toFixed(6))
            : null
      if (next === null) return
      setDenom('token')
      setAmount(next)
      return
    }

    if (!canUseUsd) return
    if (!amount) {
      setDenom('usd')
      return
    }
    const next =
      counterUsd ?? (assetUsd && Number.isFinite(typedNumber) && typedNumber > 0 ? typedNumber * assetUsd : null)
    if (next === null) return
    setDenom('usd')
    setAmount(trimZeros(next.toFixed(2)))
  }

  // Max must never fail silently: filling "0" into a field whose placeholder is already "0"
  // reads as a dead button, so every no-op path says why instead
  const handleMax = () => {
    if (inSide.balance === undefined || inSide.decimals === null) {
      toast('Balance is still loading — try again in a second', 'error')
      return
    }
    // The gas coin (native, or the CELO-style native ERC20) keeps headroom to pay for the swap
    const paysGas = tokenIn?.native || (nativeIsErc20 && tokenIn?.address?.toLowerCase() === wnative?.toLowerCase())
    const headroom = paysGas ? (GAS_HEADROOM[chainId] ?? GAS_HEADROOM.default) : 0n
    const spendable = inSide.balance > headroom ? inSide.balance - headroom : 0n
    if (spendable <= 0n) {
      toast(
        paysGas && inSide.balance > 0n
          ? `Your ${symbolIn ?? 'balance'} barely covers gas — nothing left to swap`
          : `You have no ${symbolIn ?? 'balance'} on ${chain?.name ?? 'this network'}`,
        'error',
      )
      return
    }

    if (mode === 'sell') {
      setDenom('token')
      // viem's formatUnits, not formatAmount — Max must round-trip through parseUnits exactly
      setAmount(formatUnits(spendable, inSide.decimals))
      return
    }

    // Buying spends the counter, which the field only denominates in dollars — floored to the
    // cent so the trip back through the price can't overshoot the balance
    setDenom('usd')
    const dollars = Number(formatUnits(spendable, inSide.decimals)) * (priceCounter ?? 0)
    setAmount(trimZeros((Math.floor(dollars * 100) / 100).toFixed(2)))
  }

  const openSlippageEditor = () => {
    setSlippageDraft(String(slippageBps / 100))
    setIsEditingSlippage(true)
  }

  // An unreadable draft leaves the tolerance where it was — the field closing on a typo must
  // never quietly widen what the router will accept
  const commitSlippage = () => {
    const percent = Number(slippageDraft.replace(',', '.'))
    if (Number.isFinite(percent) && percent > 0) {
      setSlippageBps(Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(percent * 100))))
    }
    setIsEditingSlippage(false)
  }

  const handleSlippageAuto = () => {
    setSlippageBps(DEFAULT_SLIPPAGE_BPS)
    setSlippageDraft(String(DEFAULT_SLIPPAGE_BPS / 100))
    slippageInputRef.current?.focus()
  }

  const openPicker = (target) => {
    pickerTargetRef.current = target
    pickerRef.current?.open()
  }

  const tokenKey = (token) => (token?.native ? 'native' : token?.address?.toLowerCase())

  // A trending row loads as a buy of that token against the chain coin, the pair most people
  // want from a list
  const handleTrendingPick = (token) => {
    if (tokenKey(token) === tokenKey(nativeEntry)) return
    setMode('buy')
    setCounter(nativeEntry)
    setAsset({ address: token.address, symbol: token.symbol, logo: token.logo ?? undefined })
  }

  // Picking the token already on the opposite side swaps the two instead of duplicating one
  const handlePick = (token) => {
    if (pickerTargetRef.current === 'asset') {
      if (tokenKey(token) === tokenKey(counter)) setCounter(asset ?? nativeEntry)
      setAsset(token)
    } else {
      if (tokenKey(token) === tokenKey(asset)) setAsset(counter)
      setCounter(token)
    }
  }

  const handleSubmit = () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (isWrongChain) {
      switchChain.mutate?.({ chainId })
      return
    }
    if (swapAmountIn <= 0n || !best) return

    if (needsV3Approve || needsSushiApprove || needsPermit2Erc20) {
      lastActionRef.current = 'approve'
      writeContract({
        abi: erc20Abi,
        address: tokenIn.address,
        functionName: 'approve',
        args: [needsV3Approve ? routerAddress : needsSushiApprove ? sushiRouter : permit2, swapAmountIn],
        chainId,
      })
      return
    }

    if (needsPermit2Grant) {
      lastActionRef.current = 'approve'
      writeContract({
        abi: v4Abi.permit2,
        address: permit2,
        functionName: 'approve',
        args: [tokenIn.address, univ4Router, swapAmountIn, nowSeconds + PERMIT2_EXPIRY_SECONDS],
        chainId,
      })
      return
    }

    lastActionRef.current = 'swap'

    // The native leg (either side) feeds the trending list's volume rollup
    const nativeLegWei = tokenIn.native
      ? swapAmountIn
      : tokenOut.native
        ? expectedOut
        : nativeIsErc20 && wnative && tokenIn.address?.toLowerCase() === wnative.toLowerCase()
          ? swapAmountIn
          : nativeIsErc20 && wnative && tokenOut.address?.toLowerCase() === wnative.toLowerCase()
            ? expectedOut
            : 0n
    pendingSwapRef.current = {
      networkId: chainId,
      wallet: address,
      tokenIn: tokenIn.native ? ZERO : tokenIn.address,
      tokenInSymbol: symbolIn ?? '',
      tokenOut: tokenOut.native ? ZERO : tokenOut.address,
      tokenOutSymbol: symbolOut ?? '',
      amountIn: swapAmountIn.toString(),
      amountOut: expectedOut.toString(),
      nativeWei: nativeLegWei.toString(),
      venue: best.venue,
    }

    if (best.venue === 'v4') {
      // Single-pool native↔token swap through the UniversalRouter; native input rides as tx
      // value, token input is pulled via the Permit2 grants approved above
      const nativeIn = Boolean(tokenIn.native)
      const v4Token = nativeIn ? tokenOut.address : tokenIn.address
      const swap = buildV4Swap(v4Token, best.tier, nativeIn, swapAmountIn, minOut)
      writeContract({
        abi: v4Abi.universalRouter,
        address: univ4Router,
        functionName: 'execute',
        args: [swap.commands, swap.inputs, BigInt(nowSeconds + 600)],
        value: swap.value,
        chainId,
      })
      return
    }

    if (best.venue === 'sushi') {
      // Classic v2 exact-input along the exact path that won the quote. Native legs use the
      // router's ETH entry points — it wraps and unwraps itself, no multicall needed — and the
      // path already speaks WNATIVE on that end because inAddress/outAddress resolved it above.
      // On Celo-style chains native is an ERC20 and only the token↔token branch can be reached.
      const deadline = BigInt(nowSeconds + 600)
      if (tokenIn.native) {
        writeContract({
          abi: sushiAbi.router,
          address: sushiRouter,
          functionName: 'swapExactETHForTokens',
          args: [minOut, best.path, address, deadline],
          value: swapAmountIn,
          chainId,
        })
      } else if (tokenOut.native) {
        writeContract({
          abi: sushiAbi.router,
          address: sushiRouter,
          functionName: 'swapExactTokensForETH',
          args: [swapAmountIn, minOut, best.path, address, deadline],
          chainId,
        })
      } else {
        writeContract({
          abi: sushiAbi.router,
          address: sushiRouter,
          functionName: 'swapExactTokensForTokens',
          args: [swapAmountIn, minOut, best.path, address, deadline],
          chainId,
        })
      }
      return
    }

    if (isDirect) {
      const params = {
        tokenIn: inAddress,
        tokenOut: outAddress,
        fee: best.fees[0],
        // Native output lands on the router first so the same transaction can unwrap it
        recipient: tokenOut.native ? ROUTER_ADDRESS_THIS : address,
        amountIn: swapAmountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }

      if (tokenOut.native) {
        const swapCall = encodeFunctionData({ abi: uniAbi.swapRouter02, functionName: 'exactInputSingle', args: [params] })
        const unwrapCall = encodeFunctionData({ abi: uniAbi.swapRouter02, functionName: 'unwrapWETH9', args: [minOut, address] })
        writeContract({
          abi: uniAbi.swapRouter02,
          address: routerAddress,
          functionName: 'multicall',
          args: [[swapCall, unwrapCall]],
          chainId,
        })
      } else {
        // Router wraps msg.value into WNATIVE itself on native input
        writeContract({
          abi: uniAbi.swapRouter02,
          address: routerAddress,
          functionName: 'exactInputSingle',
          args: [params],
          value: tokenIn.native ? swapAmountIn : 0n,
          chainId,
        })
      }
      return
    }

    // Two-hop is always ERC20 → ERC20: a native leg resolves to WNATIVE and takes the direct path
    writeContract({
      abi: uniAbi.swapRouter02,
      address: routerAddress,
      functionName: 'exactInput',
      args: [
        {
          path: encodePath([inAddress, wnative, outAddress], best.fees),
          recipient: address,
          amountIn: swapAmountIn,
          amountOutMinimum: minOut,
        },
      ],
      chainId,
    })
  }

  let submitLabel = `${mode === 'buy' ? 'Buy' : 'Sell'} ${symbolAsset ?? ''}`.trim()
  let submitDisabled = false
  if (!address) {
    submitLabel = 'Connect wallet'
  } else if (isWrongChain) {
    submitLabel = 'Switch network'
  } else if (!asset) {
    submitLabel = 'Select a token'
    submitDisabled = true
  } else if (isWrapPair) {
    submitLabel = 'That pair is a wrap, not a swap'
    submitDisabled = true
  } else if (isSamePair) {
    submitLabel = 'Pick two different tokens'
    submitDisabled = true
  } else if (!hasAmount) {
    submitLabel = 'Enter an amount'
    submitDisabled = true
  } else if (!best || swapAmountIn <= 0n) {
    submitLabel = isQuoting ? 'Fetching quote…' : 'No route for this pair'
    submitDisabled = true
  } else if (insufficient) {
    submitLabel = 'Insufficient funds'
    submitDisabled = true
  } else if (needsPermit2Grant) {
    // The middle step of the v4 sell flow — the token itself is already approved to Permit2
    submitLabel = 'Authorize Permit2'
  } else if (needsApproval) {
    submitLabel = `Approve ${symbolIn ?? 'token'}`
  }
  if (isBusy) {
    submitLabel = isPending ? 'Confirm in wallet…' : 'Swapping…'
    submitDisabled = true
  }

  // The spend balance sits under whichever pill holds the token being paid with, and doubles as
  // Max — but only where the field can express it: buying fills dollars, which needs a price.
  // Gated on a connection because balanceOf falls back to the zero address, which reads 0.
  const spendBalance = address ? qtyLabel(inSide.balance, inSide.decimals, symbolIn) : null
  const canMax = Boolean(address && inSide.balance !== undefined && (mode === 'sell' || canUseUsd))

  // Which pool the quote came from and the floor it guarantees: detail for whoever asks the
  // info icon, rather than two more rows on a card the mock keeps to four
  const routeLabel = !best
    ? null
    : best.venue === 'v4'
      ? `v4 ${feeLabel(best.tier.fee)}`
      : best.fees.length === 1
        ? `v3 ${feeLabel(best.fees[0])}`
        : `v3 via W${nativeSymbol} ${best.fees.map(feeLabel).join(' → ')}`
  const slippageHint =
    best && outSide.decimals !== null
      ? `How far the price may move before the swap reverts — the router enforces it onchain. At this tolerance you receive at least ${qtyLabel(minOut, outSide.decimals, symbolOut)}, routed through ${routeLabel}.`
      : 'How far the price may move before the swap reverts. The router enforces it onchain.'

  return (
    <div className={styles.swap}>
      <header className={styles.swap__header}>
        <p>Swap tokens straight against Uniswap pools — every token launched on Hup trades here too.</p>
        <NetworkSelect />
      </header>

      {!canSwapHere && <p className={styles.swap__empty}>Swaps aren’t live on {chain?.name ?? 'this network'} yet.</p>}

      {canSwapHere && (
        <form
          className={styles.swap__form}
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <div className={styles.swap__tabs}>
            {['buy', 'sell'].map((value) => (
              <button
                key={value}
                type="button"
                className={clsx(styles.swap__tab, mode === value && styles['swap__tab--active'])}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>

          <div className={styles.swap__panel}>
            <label className={styles.swap__label} htmlFor="swap-amount">
              {mode === 'buy' ? 'Buy' : 'Sell'} {symbolAsset ?? ''}
            </label>

            <div className={styles.swap__panelMain}>
              <div className={styles.swap__field}>
                {activeDenom === 'usd' && <span className={styles.swap__currency}>$</span>}
                <input
                  id="swap-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={handleAmountChange}
                />
              </div>
              <TokenPill
                token={displayAsset}
                symbol={symbolAsset}
                chainId={chainId}
                placeholder="Select token"
                onClick={() => openPicker('asset')}
              />
            </div>

            <div className={styles.swap__panelFoot}>
              {asset && canUseUsd ? (
                <button
                  type="button"
                  className={clsx(styles.swap__denom, isQuoting && styles['swap__denom--loading'])}
                  onClick={handleDenomToggle}
                  aria-label={
                    activeDenom === 'usd' ? `Enter an amount in ${symbolAsset ?? 'tokens'}` : 'Enter an amount in dollars'
                  }
                >
                  <ArrowsDownUpIcon size={13} weight="bold" />
                  {altValue ?? `0 ${symbolAsset ?? ''}`.trim()}
                </button>
              ) : (
                <span className={clsx(styles.swap__denom, isQuoting && styles['swap__denom--loading'])}>
                  {asset ? (altValue ?? '') : ''}
                </span>
              )}

              {mode === 'sell' && spendBalance && (
                <button type="button" className={styles.swap__balance} onClick={handleMax}>
                  {spendBalance} <b>Max</b>
                </button>
              )}
            </div>
          </div>

          <div className={clsx(styles.swap__panel, styles['swap__panel--row'])}>
            <span className={styles.swap__label}>{mode === 'buy' ? 'Pay with' : 'Receive'}</span>
            <div className={styles.swap__counter}>
              <TokenPill
                token={displayCounter}
                symbol={symbolCounter}
                chainId={chainId}
                caret="right"
                onClick={() => openPicker('counter')}
              />
              {mode === 'buy' && spendBalance ? (
                canMax ? (
                  <button type="button" className={styles.swap__balance} onClick={handleMax}>
                    {spendBalance}
                  </button>
                ) : (
                  <span className={styles.swap__balance}>{spendBalance}</span>
                )
              ) : null}
              {mode === 'sell' && address && counterSide.balance !== undefined && (
                <span className={styles.swap__balance}>{qtyLabel(counterSide.balance, counterSide.decimals, symbolCounter)}</span>
              )}
            </div>
          </div>

          <dl className={styles.swap__details}>
            <div>
              <dt>
                Max slippage
                <span className={styles.swap__info} title={slippageHint}>
                  <InfoIcon size={13} />
                </span>
              </dt>
              <dd>
                {isEditingSlippage ? (
                  // Focus leaving the pair — not merely the input — is what commits, so tapping
                  // Auto reads as part of the same control instead of closing the editor
                  <div
                    className={styles.swap__slippageEdit}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) commitSlippage()
                    }}
                  >
                    <button
                      type="button"
                      className={clsx(styles.swap__auto, slippageBps === DEFAULT_SLIPPAGE_BPS && styles['swap__auto--active'])}
                      onClick={handleSlippageAuto}
                    >
                      Auto
                    </button>
                    <span className={styles.swap__slippageBox}>
                      <input
                        ref={slippageInputRef}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        size={4}
                        autoFocus
                        aria-label="Max slippage percent"
                        value={slippageDraft}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => {
                          const next = sanitize(event.target.value)
                          if (next !== null) setSlippageDraft(next)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitSlippage()
                          }
                          if (event.key === 'Escape') setIsEditingSlippage(false)
                        }}
                      />
                      %
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.swap__slippage}
                    aria-label="Set slippage tolerance"
                    onClick={openSlippageEditor}
                  >
                    {slippageBps === DEFAULT_SLIPPAGE_BPS && <em className={styles.swap__auto}>Auto</em>}
                    {percentLabel(slippageBps)}
                    <PencilSimpleIcon size={13} />
                  </button>
                )}
              </dd>
            </div>

            <div>
              <dt>You receive</dt>
              <dd className={clsx(isQuoting && styles['swap__value--loading'])}>
                {(expectedOut > 0n ? qtyLabel(expectedOut, outSide.decimals, symbolOut) : null) ?? '—'}
              </dd>
            </div>

            <div>
              <dt>You pay</dt>
              <dd className={clsx(isQuoting && styles['swap__value--loading'])}>
                {(swapAmountIn > 0n ? qtyLabel(swapAmountIn, inSide.decimals, symbolIn) : null) ?? '—'}
              </dd>
            </div>

            {fdv !== null && (
              <div>
                <dt>{symbolAsset} FDV</dt>
                <dd>{compactUsdFormatter.format(fdv)}</dd>
              </div>
            )}
          </dl>

          <button type="submit" className={styles.swap__submit} disabled={submitDisabled}>
            {submitLabel}
          </button>
        </form>
      )}

      {canSwapHere && <TrendingTokens chainId={chainId} nativeSymbol={nativeSymbol} onSelect={handleTrendingPick} />}

      <TokenSelectDialog ref={pickerRef} chainId={chainId} chain={chain} nativeEntry={nativeEntry} onSelect={handlePick} />
    </div>
  )
}

export default SwapForm
