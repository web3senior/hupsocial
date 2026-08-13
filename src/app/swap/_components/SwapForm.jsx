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
import { CONTRACTS, config, setNetworkColor } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import { withSlippage } from '@/lib/launch'
import { FEE_TIERS, ROUTER_ADDRESS_THIS, encodePath, formatAmount } from '@/lib/uniswap'
import { V4_PROBE_TIERS, buildV4Swap, v4PoolKey } from '@/lib/uniswap-v4'
import NetworkSelect from '@/components/ui/NetworkSelect'
import NativePopover from '@/components/ui/NativePopover'
import TokenSelectDialog from './TokenSelectDialog'
import TrendingTokens from './TrendingTokens'
import uniAbi from '@/abis/UniswapV3Periphery.json'
import v4Abi from '@/abis/UniswapV4.json'
import { toast } from '@/components/NextToast'
import { ArrowsDownUpIcon, CaretDownIcon, CoinIcon, GearSixIcon } from '@phosphor-icons/react'
import styles from './SwapForm.module.scss'

const ZERO = '0x0000000000000000000000000000000000000000'
const NATIVE = { native: true }

const SLIPPAGE_OPTIONS = [50, 100, 250, 500] // bps
const DEFAULT_SLIPPAGE_BPS = 250 // 2.5%, matching LaunchCard / the pools.trade default

// Headroom Max leaves on the gas-paying balance so the swap can still pay for itself.
// Mainnet gas costs real money; L2s and testnets need only dust.
const GAS_HEADROOM = {
  1: 2n * 10n ** 15n, // 0.002 ETH
  56: 10n ** 15n, // 0.001 BNB
  default: 10n ** 14n, // 0.0001
}

// Permit2 grants to the UniversalRouter expire; 30 days matches the Uniswap interface default
const PERMIT2_EXPIRY_SECONDS = 30 * 24 * 60 * 60

const feeLabel = (fee) => `${(fee / 10_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

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

const TokenButton = ({ token, symbol, placeholder, onClick }) => (
  <button type="button" className={clsx(styles.swap__token, !token && styles['swap__token--empty'])} onClick={onClick}>
    {token &&
      (token.logo ? (
        <img src={token.logo} alt="" />
      ) : (
        <span className={styles.swap__tokenFallback} aria-hidden="true">
          <CoinIcon size={14} />
        </span>
      ))}
    <span>{token ? (symbol ?? '…') : (placeholder ?? 'Select')}</span>
    <CaretDownIcon size={12} weight="bold" />
  </button>
)

/**
 * Swap Form
 * Exact-input swaps quoted across BOTH Uniswap venues at once and executed on whichever answers
 * best. v3: QuoterV2 previews every fee tier (and every tier pair for WNATIVE-routed token↔token
 * hops), SwapRouter02 executes, native legs travel as WNATIVE with unwrap-in-multicall on the way
 * out — the LaunchCard pattern. v4: V4Quoter probes hookless native↔token pool keys, the
 * UniversalRouter executes, native is currency 0x0 directly, and ERC20 input arrives through the
 * two-step Permit2 grant flow. A chain is live when either venue is fully configured — Robinhood
 * is v4-only, Celo v3-only (its native coin is an ERC20, so v4's 0x0-currency pools don't apply).
 */
const SwapForm = () => {
  const { address, chain: walletChain } = useConnection()
  const { chain, chainId, isConnected } = useActiveChain()
  const switchChain = useSwitchChain({ config })

  const [tokenIn, setTokenIn] = useState(NATIVE)
  const [tokenOut, setTokenOut] = useState(null)
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)

  const pickerRef = useRef(null)
  const pickerSideRef = useRef('in')
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

  // The two venues quote side by side and the best answer executes. v4 only handles
  // genuine native↔token pairs (native is currency 0x0 there), so Celo-style chains and
  // token↔token routes stay v3-only; Robinhood is v4-only the other way around.
  const v3Ready = Boolean(routerAddress && quoterAddress && wnative)
  const v4Ready = Boolean(univ4Router && univ4PoolManager && univ4Quoters.length > 0 && permit2 && !nativeIsErc20)
  const canSwapHere = v3Ready || v4Ready

  const nativeSymbol = chain?.nativeCurrency?.symbol ?? 'ETH'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)

  // What "the chain's own coin" means in the picker and as the default pay side
  const nativeEntry = useMemo(
    () =>
      nativeIsErc20 && wnative
        ? { address: wnative, symbol: nativeSymbol, name: chain?.nativeCurrency?.name, logo: chain?.iconUrl ?? null }
        : NATIVE,
    [nativeIsErc20, wnative, nativeSymbol, chain],
  )

  // Chains whose swap stack is fully configured — offered as one-click switches when the
  // active chain has none, so the page never dead-ends on a bare "not here" message
  const swapChains = useMemo(
    () =>
      appChains.filter((entry) => {
        const contracts = CONTRACTS[`chain${entry.id}`]
        const hasV3 = Boolean(contracts?.univ3Router && contracts?.univ3Quoter && contracts?.wnative)
        const hasV4 = Boolean(
          contracts?.univ4Router && contracts?.univ4PoolManager && contracts?.univ4Quoters?.length && contracts?.permit2,
        )
        return hasV3 || hasV4
      }),
    [],
  )

  // Same switch semantics as NetworkSelect: move the wallet when one is connected,
  // otherwise just the stored selection
  const handleQuickSwitch = (target) => {
    const apply = () => {
      setActiveChainId(target.id)
      setNetworkColor(target)
    }
    if (isConnected) {
      switchChain.mutate(
        { chainId: target.id },
        {
          onSuccess: apply,
          onError: (error) => {
            console.error('Switch chain failed:', error)
          },
        },
      )
    } else {
      apply()
    }
  }

  // Token addresses are chain-scoped; a chain switch invalidates both selections. chainId
  // must be a dependency in its own right — between two ordinary-native chains nativeEntry
  // is the same NATIVE constant and would never retrigger this on its own.
  useEffect(() => {
    setTokenIn(nativeEntry)
    setTokenOut(null)
    setAmount('')
  }, [chainId, nativeEntry])

  const inSide = useTokenSide(tokenIn, chainId, address)
  const outSide = useTokenSide(tokenOut, chainId, address)
  const symbolIn = tokenIn?.native ? nativeSymbol : inSide.symbol
  const symbolOut = tokenOut?.native ? nativeSymbol : outSide.symbol

  // Native entries carry no logo of their own; the chain icon stands in
  const displayTokenIn = tokenIn?.native ? { ...tokenIn, logo: chain?.iconUrl } : tokenIn
  const displayTokenOut = tokenOut?.native ? { ...tokenOut, logo: chain?.iconUrl } : tokenOut

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

  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: tokenIn?.address,
    functionName: 'allowance',
    args: [address ?? ZERO, routerAddress ?? ZERO],
    chainId,
    query: { enabled: Boolean(!tokenIn?.native && tokenIn?.address && address && routerAddress) },
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

  // Debounce typing so the quoter isn't asked on every keystroke
  const [debouncedAmount, setDebouncedAmount] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(amount), 350)
    return () => clearTimeout(timer)
  }, [amount])

  const parsedAmount = useMemo(() => {
    const raw = debouncedAmount.trim()
    if (!raw || inSide.decimals === null) return 0n
    try {
      return parseUnits(raw, inSide.decimals)
    } catch {
      return 0n
    }
  }, [debouncedAmount, inSide.decimals])

  // Every candidate route across both venues, one quoter call each, all batched into a single
  // multicall. v3: direct pairs probe each fee tier, WNATIVE-routed pairs every tier pair.
  // v4: hookless native↔token pool keys across the probe tiers, on every known quoter.
  // Routes without a pool simply fail their slot and drop out; the best output wins.
  const candidates = useMemo(() => {
    if (isSamePair || parsedAmount <= 0n || !tokenOut) return []
    const list = []

    if (v3Ready && inAddress && outAddress) {
      if (isDirect) {
        for (const fee of FEE_TIERS) {
          list.push({
            venue: 'v3',
            fees: [fee],
            contract: {
              abi: uniAbi.quoterV2,
              address: quoterAddress,
              functionName: 'quoteExactInputSingle',
              args: [{ tokenIn: inAddress, tokenOut: outAddress, amountIn: parsedAmount, fee, sqrtPriceLimitX96: 0n }],
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
              contract: {
                abi: uniAbi.quoterV2,
                address: quoterAddress,
                functionName: 'quoteExactInput',
                args: [encodePath([inAddress, wnative, outAddress], [feeA, feeB]), parsedAmount],
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
            contract: {
              abi: v4Abi.quoter,
              address: quoter,
              functionName: 'quoteExactInputSingle',
              args: [{ poolKey: v4PoolKey(v4Token, tier), zeroForOne, exactAmount: parsedAmount, hookData: '0x' }],
              chainId,
            },
          })
        }
      }
    }

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    v3Ready,
    v4Ready,
    quoterAddress,
    inAddress,
    outAddress,
    isSamePair,
    isDirect,
    parsedAmount,
    wnative,
    chainId,
    tokenIn,
    tokenOut,
  ])

  const { data: quoteResults, isLoading: isQuoting } = useReadContracts({
    contracts: candidates.map((candidate) => candidate.contract),
    query: { enabled: candidates.length > 0, refetchInterval: 15_000 },
  })

  const best = useMemo(() => {
    if (!quoteResults || candidates.length === 0) return null

    let bestIndex = -1
    let bestOut = 0n
    quoteResults.forEach((entry, index) => {
      if (entry.status !== 'success') return
      const amountOut = entry.result?.[0] ?? 0n
      if (amountOut > bestOut) {
        bestOut = amountOut
        bestIndex = index
      }
    })
    if (bestIndex < 0) return null

    const { venue, fees, tier } = candidates[bestIndex]
    return { amountOut: bestOut, venue, fees, tier }
  }, [quoteResults, candidates])

  const minOut = best ? withSlippage(best.amountOut, slippageBps) : 0n

  // Whole-token exchange rate, kept in BigInt in the output token's base units
  const rate = useMemo(() => {
    if (!best || parsedAmount <= 0n || inSide.decimals === null) return null
    return (best.amountOut * 10n ** BigInt(inSide.decimals)) / parsedAmount
  }, [best, parsedAmount, inSide.decimals])

  const { data: hash, isPending, writeContract, error: submitError } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isConfirmed) return
    inSide.refetchBalance?.()
    outSide.refetchBalance?.()
    refetchAllowance()
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

  // Approval requirements depend on which venue won the quote: v3 takes one plain approve to
  // SwapRouter02; v4 takes token→Permit2, then Permit2→UniversalRouter (amount + unexpired)
  const erc20In = Boolean(!tokenIn?.native && tokenIn?.address && parsedAmount > 0n)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const needsV3Approve = Boolean(best?.venue === 'v3' && erc20In && allowance < parsedAmount)
  const needsPermit2Erc20 = Boolean(best?.venue === 'v4' && erc20In && permit2Erc20Allowance < parsedAmount)
  const needsPermit2Grant = Boolean(
    best?.venue === 'v4' &&
      erc20In &&
      !needsPermit2Erc20 &&
      (!permit2Grant || permit2Grant[0] < parsedAmount || Number(permit2Grant[1]) <= nowSeconds),
  )
  const needsApproval = needsV3Approve || needsPermit2Erc20 || needsPermit2Grant
  const insufficient = parsedAmount > 0n && inSide.balance !== undefined && parsedAmount > inSide.balance
  const isBusy = isPending || isConfirming

  const handleAmountChange = (event) => {
    const next = event.target.value.replace(',', '.').replace(/[^0-9.]/g, '')
    if ((next.match(/\./g) ?? []).length > 1) return
    setAmount(next)
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
    // viem's formatUnits, not formatAmount — Max must round-trip through parseUnits exactly
    setAmount(formatUnits(spendable, inSide.decimals))
  }

  const handleFlip = () => {
    if (!tokenOut) return
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
  }

  const openPicker = (side) => {
    pickerSideRef.current = side
    pickerRef.current?.open()
  }

  const tokenKey = (token) => (token?.native ? 'native' : token?.address?.toLowerCase())

  // A trending row loads as "chain coin → that token", the pair most people want from a list
  const handleTrendingPick = (token) => {
    if (tokenKey(token) === tokenKey(nativeEntry)) return
    setTokenIn(nativeEntry)
    setTokenOut({ address: token.address, symbol: token.symbol, logo: token.logo ?? undefined })
  }

  // Picking the token already on the opposite side swaps the pair instead of duplicating it
  const handlePick = (token) => {
    if (pickerSideRef.current === 'in') {
      if (tokenKey(token) === tokenKey(tokenOut)) setTokenOut(tokenIn)
      setTokenIn(token)
    } else {
      if (tokenKey(token) === tokenKey(tokenIn)) setTokenIn(tokenOut ?? nativeEntry)
      setTokenOut(token)
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
    if (parsedAmount <= 0n || !best) return

    if (needsV3Approve || needsPermit2Erc20) {
      lastActionRef.current = 'approve'
      writeContract({
        abi: erc20Abi,
        address: tokenIn.address,
        functionName: 'approve',
        args: [needsV3Approve ? routerAddress : permit2, parsedAmount],
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
        args: [tokenIn.address, univ4Router, parsedAmount, nowSeconds + PERMIT2_EXPIRY_SECONDS],
        chainId,
      })
      return
    }

    lastActionRef.current = 'swap'

    // The native leg (either side) feeds the trending list's volume rollup
    const nativeLegWei = tokenIn.native
      ? parsedAmount
      : tokenOut.native
        ? best.amountOut
        : nativeIsErc20 && wnative && tokenIn.address?.toLowerCase() === wnative.toLowerCase()
          ? parsedAmount
          : nativeIsErc20 && wnative && tokenOut.address?.toLowerCase() === wnative.toLowerCase()
            ? best.amountOut
            : 0n
    pendingSwapRef.current = {
      networkId: chainId,
      wallet: address,
      tokenIn: tokenIn.native ? ZERO : tokenIn.address,
      tokenInSymbol: symbolIn ?? '',
      tokenOut: tokenOut.native ? ZERO : tokenOut.address,
      tokenOutSymbol: symbolOut ?? '',
      amountIn: parsedAmount.toString(),
      amountOut: best.amountOut.toString(),
      nativeWei: nativeLegWei.toString(),
      venue: best.venue,
    }

    if (best.venue === 'v4') {
      // Single-pool native↔token swap through the UniversalRouter; native input rides as tx
      // value, token input is pulled via the Permit2 grants approved above
      const nativeIn = Boolean(tokenIn.native)
      const v4Token = nativeIn ? tokenOut.address : tokenIn.address
      const swap = buildV4Swap(v4Token, best.tier, nativeIn, parsedAmount, minOut)
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

    if (isDirect) {
      const params = {
        tokenIn: inAddress,
        tokenOut: outAddress,
        fee: best.fees[0],
        // Native output lands on the router first so the same transaction can unwrap it
        recipient: tokenOut.native ? ROUTER_ADDRESS_THIS : address,
        amountIn: parsedAmount,
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
          value: tokenIn.native ? parsedAmount : 0n,
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
          amountIn: parsedAmount,
          amountOutMinimum: minOut,
        },
      ],
      chainId,
    })
  }

  let submitLabel = 'Swap'
  let submitDisabled = false
  if (!address) {
    submitLabel = 'Connect wallet'
  } else if (isWrongChain) {
    submitLabel = 'Switch network'
  } else if (!tokenOut) {
    submitLabel = 'Select a token'
    submitDisabled = true
  } else if (isWrapPair) {
    submitLabel = 'That pair is a wrap, not a swap'
    submitDisabled = true
  } else if (isSamePair) {
    submitLabel = 'Pick two different tokens'
    submitDisabled = true
  } else if (parsedAmount <= 0n) {
    submitLabel = 'Enter an amount'
    submitDisabled = true
  } else if (insufficient) {
    submitLabel = `Insufficient ${symbolIn ?? 'balance'}`
    submitDisabled = true
  } else if (!best) {
    submitLabel = isQuoting ? 'Fetching quote…' : 'No route for this pair'
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

  return (
    <div className={styles.swap}>
      <header className={styles.swap__header}>
        <p>Swap tokens straight against Uniswap pools — every token launched on Hup trades here too.</p>
        <NetworkSelect />
      </header>

      {!canSwapHere && (
        <div className={styles.swap__empty}>
          <p>Swaps aren’t live on {chain?.name ?? 'this network'} yet.</p>
          {swapChains.map((entry) => (
            <button key={entry.id} type="button" className={styles.swap__emptyChain} onClick={() => handleQuickSwitch(entry)}>
              {entry.iconUrl && <img src={entry.iconUrl} alt="" />}
              Switch to {entry.name}
            </button>
          ))}
        </div>
      )}

      {canSwapHere && (
        <form
          className={styles.swap__form}
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <div className={styles.swap__panel}>
            <div className={styles.swap__panelTop}>
              <label htmlFor="swap-amount-in">You pay</label>
              {address && inSide.balance !== undefined && (
                <button type="button" className={styles.swap__balance} onClick={handleMax}>
                  Balance: {formatAmount(inSide.balance, inSide.decimals ?? 18, 6)} <b>Max</b>
                </button>
              )}
            </div>
            <div className={styles.swap__panelMain}>
              <input
                id="swap-amount-in"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={handleAmountChange}
              />
              <TokenButton token={displayTokenIn} symbol={symbolIn} onClick={() => openPicker('in')} />
            </div>
          </div>

          <button type="button" className={styles.swap__flip} onClick={handleFlip} disabled={!tokenOut} aria-label="Flip tokens">
            <ArrowsDownUpIcon size={16} weight="bold" />
          </button>

          <div className={styles.swap__panel}>
            <div className={styles.swap__panelTop}>
              <label>You receive</label>
              {address && tokenOut && outSide.balance !== undefined && (
                <span className={styles.swap__balance}>Balance: {formatAmount(outSide.balance, outSide.decimals ?? 18, 6)}</span>
              )}
            </div>
            <div className={styles.swap__panelMain}>
              <output className={clsx(styles.swap__quote, isQuoting && styles['swap__quote--loading'])}>
                {best && outSide.decimals !== null ? formatAmount(best.amountOut, outSide.decimals, 7) : '0'}
              </output>
              <TokenButton token={displayTokenOut} symbol={symbolOut} placeholder="Select token" onClick={() => openPicker('out')} />
            </div>
          </div>

          {best && outSide.decimals !== null && (
            <dl className={styles.swap__details}>
              <div>
                <dt>Rate</dt>
                <dd>
                  1 {symbolIn} = {rate !== null ? formatAmount(rate, outSide.decimals, 6) : '—'} {symbolOut}
                </dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>
                  {best.venue === 'v4'
                    ? `v4 · ${feeLabel(best.tier.fee)}`
                    : best.fees.length === 1
                      ? `v3 · ${feeLabel(best.fees[0])}`
                      : `v3 via W${nativeSymbol} · ${best.fees.map(feeLabel).join(' → ')}`}
                </dd>
              </div>
              <div>
                <dt>Min received</dt>
                <dd>
                  {formatAmount(minOut, outSide.decimals, 6)} {symbolOut}
                </dd>
              </div>
              <div>
                <dt>Slippage</dt>
                <dd>
                  <NativePopover
                    placement="bottom-end"
                    trigger={
                      <button type="button" className={styles.swap__slippage} aria-label="Set slippage tolerance">
                        {(slippageBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
                        <GearSixIcon size={13} />
                      </button>
                    }
                  >
                    {({ close }) => (
                      <div className={styles.swap__slippagePanel}>
                        {SLIPPAGE_OPTIONS.map((bps) => (
                          <button
                            key={bps}
                            type="button"
                            className={clsx(bps === slippageBps && styles['swap__slippageOption--active'])}
                            onClick={() => {
                              setSlippageBps(bps)
                              close()
                            }}
                          >
                            {(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
                          </button>
                        ))}
                      </div>
                    )}
                  </NativePopover>
                </dd>
              </div>
            </dl>
          )}

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
