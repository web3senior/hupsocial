'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { erc20Abi, formatEther, parseUnits } from 'viem'
import {
  useConnection,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { useQuoteAsset } from '@/hooks/useQuoteAsset'
import useSlippagePreference, { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS } from '@/hooks/useSlippagePreference'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  TOTAL_SUPPLY,
  WAD,
  formatQuote,
  formatPrice,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
  marketCapWei,
  quoteWeiToUsd,
  sqrtPriceToPriceWei,
  tokenBaseToUsd,
  usdToQuoteWei,
  usdToTokenBase,
  withSlippage,
} from '@/lib/launch'
import { V4_NATIVE, buildV4SwapForKey } from '@/lib/uniswap-v4'
import { useLaunchPoolKey } from '@/hooks/useLaunchFeeSchedule'
import launchAbi from '@/abis/HupLaunch.json'
import v4Abi from '@/abis/UniswapV4.json'
import { toast } from '@/components/NextToast'
import { launchHref } from '@/lib/tokenRef'
import { ArrowsDownUpIcon, CoinIcon } from '@phosphor-icons/react'
import styles from './LaunchCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const AUTO_SLIPPAGE = (DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)
const MAX_SLIPPAGE_PERCENT = MAX_SLIPPAGE_BPS / 100

const ZERO = '0x0000000000000000000000000000000000000000'

// Buy sizes people actually reach for, and the sell fractions that pair with them
const BUY_PRESETS_USD = [10, 25, 100, 250]
const SELL_PRESETS_PCT = [10, 25, 50, 100]

// Every v4 pool emits through the one PoolManager, so the card watches that and filters by id
const POOL_MANAGER_SWAP_ABI = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'int128' },
      { name: 'amount1', type: 'int128' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'tick', type: 'int24' },
      { name: 'fee', type: 'uint24' },
    ],
  },
]

// v4 settles the native coin directly, so a Permit2 grant is only ever needed on a sell
const PERMIT2_EXPIRY_SECONDS = 60 * 60 * 24 * 30

// How often the card refetches, and therefore how long the countdown ring takes to empty. One
// value, because a ring that finishes before the fetch lands is a lie about being live. Kept
// short so a busy token visibly moves; swaps already push updates in ahead of this, so the timer
// is only the floor.
const REFRESH_MS = 8_000

/**
 * Launch Card
 * The in-post trading surface for a Hup Launch. One-phase launches are ordinary Uniswap v4
 * pools, so this card is a swap widget: the V4Quoter previews, the UniversalRouter executes, and
 * the same pool serves every aggregator that routes the token. The pool is hookless at the
 * canonical launch tier, so its key is built from the factory's constants rather than probed.
 *
 * @param {Object} props
 * @param {{launchId: string, token: string, chainId: number}} props.launchRef Content-JSON reference.
 * @param {boolean} [props.showSummary=true] Whether to draw the token's identity and figures above
 *   the ticket. A post has no other context, so the feed keeps them; the launch page already
 *   carries both in its own header, where repeating them is just noise beside the buy button.
 */
const LaunchCard = ({ launchRef, showSummary = true }) => {
  // The post's reference carries the token address as well as the id, so the card links to the
  // page's own identity without waiting for the launch to load
  const { launchId, chainId, token } = launchRef ?? {}
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  const [side, setSide] = useState('buy')
  const [amount, setAmount] = useState('')
  // Dollars is what people actually think in, so it leads. The toggle falls back to the asset
  // itself when there is no price feed for the chain.
  const [inUsd, setInUsd] = useState(true)
  // The tolerance itself is a habit rather than a piece of this token's data, so it lives in
  // localStorage and every ticket on the page shares it. The draft covers typing only — a
  // half-written "1." has to survive the keystroke that made it without being remembered.
  const [storedSlippageBps, setStoredSlippageBps] = useSlippagePreference()
  const [slippageDraft, setSlippageDraft] = useState(null)
  const slippage = slippageDraft ?? String(storedSlippageBps / 100)
  // Price straight off the last swap, so the position reprices the instant anyone trades rather
  // than waiting a round trip for the indexer to catch up
  const [livePriceWei, setLivePriceWei] = useState(null)
  // Remounting the ring restarts its animation, so it always measures the wait that is
  // actually ahead rather than drifting away from the fetch it is counting down to
  const [cycle, setCycle] = useState(0)

  // What the swap actually goes out with: a blank or nonsense box falls back to auto rather than
  // sending a zero minimum, and the ceiling stops a fat finger authorising a 90% haircut
  const slippageBps = (() => {
    if (slippageDraft === null) return storedSlippageBps
    const percent = Number(slippageDraft)
    if (!Number.isFinite(percent) || percent <= 0) return DEFAULT_SLIPPAGE_BPS
    return Math.round(Math.min(percent, MAX_SLIPPAGE_PERCENT) * 100)
  })()
  const isAutoSlippage = slippage === AUTO_SLIPPAGE

  // Only a finished edit is remembered, so the stored tolerance is always one the box could
  // have been left showing
  const commitSlippage = (bps) => {
    setStoredSlippageBps(bps)
    setSlippageDraft(null)
  }

  const chainContracts = CONTRACTS[`chain${chainId}`]
  const launchAddress = chainContracts?.launch
  const routerAddress = chainContracts?.univ4Router
  const quoterAddress = chainContracts?.univ4Quoters?.[0]
  const permit2Address = chainContracts?.permit2
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)

  const holderQuery = address ? `?holder=${address.toLowerCase()}` : ''
  const {
    data: indexed,
    mutate: mutateIndexed,
    isValidating,
  } = useSWR(launchId && chainId ? `/api/v1/launches/${chainId}/${launchId}${holderQuery}` : null, fetcher, {
    refreshInterval: REFRESH_MS,
    // The ring counts fetches, not payload changes: SWR keeps the previous object when a poll
    // comes back deeply equal, so a quiet launch would otherwise freeze it on its first sweep
    onSuccess: () => setCycle((value) => value + 1),
  })
  const launch = indexed?.data

  // Posts written before the pages moved to addresses carry only an id in their content JSON;
  // the indexed row supplies the token for those, and the old URL still redirects if neither has
  const tokenPageHref = token || launch?.token ? launchHref(chainId, token || launch.token) : `/trade/${chainId}/${launchId}`

  const tokenAddress = launch?.token
  const quoteAddress = launch?.quote ?? V4_NATIVE
  // What this token trades against. Its decimals scale every figure on the card and, more to the
  // point, parse what the buyer types — so they are read off the chain rather than assumed.
  const quote = useQuoteAsset(chainId, quoteAddress)
  const quoteSymbol = quote.symbol
  const quoteDecimals = quote.decimals

  // Rebuilt from the launch itself rather than probed across fee tiers the way the swap page
  // must, and shared with every other surface that trades this pool
  const { poolKey, buyIsZeroForOne } = useLaunchPoolKey(launch, chainId)

  // The indexer keeps this current from each swap's own sqrtPriceX96; a swap seen live is
  // fresher still, so it takes precedence until the next fetch agrees
  const indexedPriceWei = BigInt(launch?.price ?? 0)
  const priceWei = livePriceWei ?? indexedPriceWei

  const { data: tokenBalance = 0n, refetch: refetchBalance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'balanceOf',
    args: [address ?? ZERO],
    chainId,
    // A trade made anywhere else — another tab, another device, an airdrop — moves this balance
    // without a swap event or receipt this card ever sees, so it polls on the ring's beat
    query: { enabled: Boolean(tokenAddress && address), refetchInterval: REFRESH_MS },
  })

  // Which asset this trade actually spends. A sell always spends the launch token; a buy spends
  // the quote, which is only an ERC20 when the launch was paired against one — a native buy
  // rides as tx value and needs no approval at all.
  const spendToken = side === 'buy' ? (quote.isNative ? null : quoteAddress) : tokenAddress

  // v4 pulls an ERC20 input through Permit2, which needs two grants: token → Permit2, then
  // Permit2 → UniversalRouter with an expiry.
  const wantsPermit2 = Boolean(spendToken && address && permit2Address)
  const { data: permit2Erc20Allowance = 0n, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: spendToken ?? undefined,
    functionName: 'allowance',
    args: [address ?? ZERO, permit2Address ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })
  const { data: permit2Grant, refetch: refetchPermit2Grant } = useReadContract({
    abi: v4Abi.permit2,
    address: permit2Address,
    functionName: 'allowance',
    args: [address ?? ZERO, spendToken ?? ZERO, routerAddress ?? ZERO],
    chainId,
    query: { enabled: wantsPermit2 },
  })

  const quoteUsd = launch?.quote_usd ?? null
  const canPriceUsd = Boolean(quoteUsd)
  const showUsd = inUsd && canPriceUsd

  // What the user typed, converted to base units of whatever is actually being spent
  const parsedAmount = useMemo(() => {
    const raw = amount.trim()
    if (!raw) return 0n
    try {
      if (showUsd) {
        return side === 'buy'
          ? usdToQuoteWei(raw, quoteUsd, quoteDecimals)
          : usdToTokenBase(raw, priceWei, quoteUsd, quoteDecimals)
      }
      // A buy is denominated in the quote asset, a sell in the launch token — which is always 18
      return side === 'buy' ? parseUnits(raw, quoteDecimals) : parseUnits(raw, 18)
    } catch {
      return 0n
    }
  }, [amount, side, showUsd, quoteUsd, priceWei, quoteDecimals])

  // The V4Quoter simulates the exact swap the router will run, fee and price impact included,
  // so the preview can never disagree with execution
  const { data: quoteResult } = useReadContract({
    abi: v4Abi.quoter,
    address: quoterAddress,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey: poolKey ?? undefined,
        zeroForOne: side === 'buy' ? buyIsZeroForOne : !buyIsZeroForOne,
        exactAmount: parsedAmount,
        hookData: '0x',
      },
    ],
    chainId,
    // Re-quoting keeps the preview and the minimum-out it feeds honest while the box sits filled
    query: { enabled: Boolean(quoterAddress && poolKey && parsedAmount > 0n), refetchInterval: REFRESH_MS },
  })
  const quotedOut = quoteResult?.[0] ?? 0n

  // Anyone's trade moves this token's price, so the card follows the pool rather than a timer
  useWatchContractEvent({
    address: chainContracts?.univ4PoolManager,
    abi: POOL_MANAGER_SWAP_ABI,
    eventName: 'Swap',
    args: launch?.pool_id ? { id: launch.pool_id } : undefined,
    chainId,
    enabled: Boolean(chainContracts?.univ4PoolManager && launch?.pool_id),
    onLogs: (logs) => {
      const last = logs?.[logs.length - 1]
      const sqrtPriceX96 = last?.args?.sqrtPriceX96
      if (sqrtPriceX96 && poolKey) {
        // tokenIsCurrency0 is the inverse of "spending the quote is zeroForOne"
        setLivePriceWei(sqrtPriceToPriceWei(sqrtPriceX96, !buyIsZeroForOne))
      }
      mutateIndexed()
      refetchBalance()
    },
  })

  /**
   * What this wallet is actually up or down.
   *
   * Cost basis comes from indexed trades, because the chain cannot tell you what someone paid —
   * only what they hold. Net spend is buys minus whatever they have already taken back out, so a
   * holder who has sold part of their position is not shown as having risked more than they have.
   */
  const position = useMemo(() => {
    const raw = indexed?.position
    if (!raw || tokenBalance === 0n || priceWei === 0n) return null

    const spentWei = BigInt(raw.native_in ?? 0) - BigInt(raw.native_out ?? 0)
    const valueWei = (tokenBalance * priceWei) / WAD
    const profitWei = valueWei - spentWei
    const profitPct = spentWei > 0n ? (Number(profitWei) / Number(spentWei)) * 100 : null

    // The market cap they bought in at, which is how a memecoin holder reads their entry
    const netTokens = BigInt(raw.net_tokens ?? 0)
    const avgEntryMcWei = netTokens > 0n && spentWei > 0n ? (spentWei * TOTAL_SUPPLY) / netTokens : null

    return { spentWei, valueWei, profitWei, profitPct, avgEntryMcWei }
  }, [indexed?.position, tokenBalance, priceWei])

  const { data: hash, isPending, writeContract, error: submitError } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  // Refresh everything the card shows once a trade lands. The input reset rides the refetches
  // via setTimeout so the effect body itself performs no synchronous state write.
  useEffect(() => {
    if (!isConfirmed) return
    refetchBalance()
    refetchAllowance()
    refetchPermit2Grant()
    mutateIndexed()
    const timer = setTimeout(() => setAmount(''), 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  // Drop the local override once the indexer has caught up, so the two cannot drift apart
  useEffect(() => {
    if (livePriceWei !== null && indexedPriceWei === livePriceWei) setLivePriceWei(null)
  }, [indexedPriceWei, livePriceWei])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const nowSeconds = Math.floor(Date.now() / 1000)
  const needsErc20Approval = Boolean(spendToken) && parsedAmount > 0n && permit2Erc20Allowance < parsedAmount
  const needsPermit2Grant =
    Boolean(spendToken) &&
    parsedAmount > 0n &&
    !needsErc20Approval &&
    (!permit2Grant || permit2Grant[0] < parsedAmount || Number(permit2Grant[1]) <= nowSeconds)
  const needsApproval = needsErc20Approval || needsPermit2Grant

  // A brief highlight whenever the position revalues, so a change is noticed rather than
  // silently swapped in while someone is looking at the amount field
  const [flash, setFlash] = useState(false)
  const lastValueRef = useRef(null)
  useEffect(() => {
    const current = position ? position.profitWei.toString() : null
    if (current === null) return
    if (lastValueRef.current !== null && lastValueRef.current !== current) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 600)
      lastValueRef.current = current
      return () => clearTimeout(timer)
    }
    lastValueRef.current = current
  }, [position])

  const isBusy = isPending || isConfirming
  const canSwap = Boolean(routerAddress && quoterAddress && permit2Address && poolKey)

  const handleSubmit = () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (isWrongChain) {
      switchChain.mutate?.({ chainId })
      return
    }
    if (parsedAmount <= 0n) {
      toast('Enter an amount first', 'error')
      return
    }

    if (needsErc20Approval) {
      writeContract({
        abi: erc20Abi,
        address: spendToken,
        functionName: 'approve',
        args: [permit2Address, parsedAmount],
        chainId,
      })
      return
    }

    if (needsPermit2Grant) {
      writeContract({
        abi: v4Abi.permit2,
        address: permit2Address,
        functionName: 'approve',
        args: [spendToken, routerAddress, parsedAmount, nowSeconds + PERMIT2_EXPIRY_SECONDS],
        chainId,
      })
      return
    }

    const minOut = withSlippage(quotedOut, slippageBps)
    const zeroForOne = side === 'buy' ? buyIsZeroForOne : !buyIsZeroForOne

    // One router call either way. Native input rides as tx value and native output is settled
    // as coin, so a seller never receives a wrapped token they would have to unwrap themselves.
    const { commands, inputs, value } = buildV4SwapForKey(poolKey, zeroForOne, parsedAmount, minOut)

    writeContract({
      abi: v4Abi.universalRouter,
      address: routerAddress,
      functionName: 'execute',
      args: [commands, inputs, BigInt(nowSeconds + 1800)],
      value,
      chainId,
    })
  }

  if (!launchId || !chainId) return null

  const imageUrl = launch?.image_cid ? resolveStorageImageUrl(launch.image_cid) : null

  return (
    <section className={styles.launchCard} onClick={(e) => e.stopPropagation()}>
      {showSummary && (
        <>
          <header className={styles.launchCard__header}>
            <Link href={tokenPageHref} className={styles.launchCard__identity}>
              {imageUrl ? (
                <img src={imageUrl} alt="" className={styles.launchCard__image} />
              ) : (
                <span className={styles.launchCard__image} aria-hidden="true">
                  <CoinIcon size={20} />
                </span>
              )}
              <span className={styles.launchCard__names}>
                <strong>{launch?.name ?? 'Token launch'}</strong>
                <em>${launch?.symbol ?? '—'}</em>
              </span>
            </Link>

            <span className={styles.launchCard__badges}>
              {Number(launch?.creator_share_bps ?? 0) === 0 && (
                <span className={styles.launchCard__badge}>No creator fee</span>
              )}
              <span className={styles.launchCard__badge}>Uniswap</span>
            </span>
          </header>

          <dl className={styles.launchCard__stats}>
            <div>
              <dt>Price</dt>
              <dd>
                {canPriceUsd ? formatUsd(quoteWeiToUsd(priceWei, quoteUsd, quoteDecimals)) : `${formatPrice(priceWei, 4, quoteDecimals)} ${quoteSymbol}`}
              </dd>
            </div>
            <div>
              <dt>Market cap</dt>
              <dd>
                {canPriceUsd
                  ? formatUsd(quoteWeiToUsd(marketCapWei(priceWei), quoteUsd, quoteDecimals))
                  : `${formatQuote(marketCapWei(priceWei), quoteDecimals)} ${quoteSymbol}`}
              </dd>
            </div>
            <div>
              <dt>Trades</dt>
              <dd>{launch?.trade_count ?? 0}</dd>
            </div>
          </dl>
        </>
      )}

      <div className={styles.launchCard__trade}>
        <div className={styles.launchCard__tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={side === 'buy'}
            className={clsx(side === 'buy' && styles['launchCard__tab--active'])}
            onClick={() => {
              setSide('buy')
              setAmount('')
            }}
          >
            Buy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={side === 'sell'}
            className={clsx(side === 'sell' && styles['launchCard__tab--active'])}
            onClick={() => {
              setSide('sell')
              setAmount('')
            }}
          >
            Sell
          </button>
        </div>

        {/* The amount is the loud thing on the ticket: an oversized field with the unit it is
            counted in beside it, and what comes back underneath */}
        <div className={styles.launchCard__field}>
          <span className={styles.launchCard__fieldLabel}>
            {side === 'buy' ? `Buy $${launch?.symbol ?? ''}` : `Sell $${launch?.symbol ?? ''}`}
          </span>

          <div className={styles.launchCard__fieldRow}>
            <input
              className={styles.launchCard__amount}
              type="text"
              inputMode="decimal"
              value={amount}
              placeholder={showUsd ? '$0' : '0.0'}
              aria-label={
                showUsd
                  ? 'Amount in US dollars'
                  : side === 'buy'
                    ? `Amount in ${quoteSymbol}`
                    : `Amount of ${launch?.symbol ?? 'tokens'}`
              }
              onChange={(e) => setAmount(e.target.value)}
              disabled={isBusy || !canSwap}
            />

            {canPriceUsd ? (
              <button
                type="button"
                className={styles.launchCard__denom}
                onClick={() => setInUsd((prev) => !prev)}
                title="Switch what you type in"
              >
                <ArrowsDownUpIcon size={13} weight="bold" />
                {showUsd ? 'USD' : side === 'buy' ? quoteSymbol : `$${launch?.symbol ?? ''}`}
              </button>
            ) : (
              <span className={styles.launchCard__denom}>
                {side === 'buy' ? quoteSymbol : `$${launch?.symbol ?? ''}`}
              </span>
            )}
          </div>

          <div className={styles.launchCard__convert}>
            <span>
              <ArrowsDownUpIcon size={12} />
              {quotedOut > 0n
                ? side === 'buy'
                  ? `${formatTokenAmount(quotedOut)} $${launch?.symbol ?? ''}`
                  : canPriceUsd
                    ? formatUsd(quoteWeiToUsd(quotedOut, quoteUsd, quoteDecimals))
                    : `${formatQuote(quotedOut, quoteDecimals)} ${quoteSymbol}`
                : `0 ${side === 'buy' ? `$${launch?.symbol ?? ''}` : quoteSymbol}`}
            </span>

            {side === 'sell' && tokenBalance > 0n && (
              <button
                type="button"
                className={styles.launchCard__max}
                onClick={() =>
                  setAmount(
                    showUsd
                      ? String(tokenBaseToUsd(tokenBalance, priceWei, quoteUsd, quoteDecimals) ?? 0)
                      : formatEther(tokenBalance),
                  )
                }
              >
                Max
              </button>
            )}
          </div>
        </div>

        <div className={styles.launchCard__presets}>
          {BUY_PRESETS_USD.map((preset) => (
            <button
              key={`buy-${preset}`}
              type="button"
              className={styles['launchCard__preset--buy']}
              disabled={!canPriceUsd || isBusy || !canSwap}
              onClick={() => {
                setSide('buy')
                setInUsd(true)
                setAmount(String(preset))
              }}
            >
              ${preset}
            </button>
          ))}
        </div>

        <div className={styles.launchCard__presets}>
          {SELL_PRESETS_PCT.map((pct) => (
            <button
              key={`sell-${pct}`}
              type="button"
              className={styles['launchCard__preset--sell']}
              disabled={tokenBalance === 0n || isBusy || !canSwap}
              onClick={() => {
                setSide('sell')
                setInUsd(false)
                setAmount(formatEther((tokenBalance * BigInt(pct)) / 100n))
              }}
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* What the swap will actually cost and return, on the terms it will be sent under */}
        <dl className={styles.launchCard__terms}>
          <div>
            <dt>Max slippage</dt>
            <dd className={styles.launchCard__slippage}>
              <button
                type="button"
                className={clsx(styles.launchCard__auto, isAutoSlippage && styles['launchCard__auto--on'])}
                aria-pressed={isAutoSlippage}
                onClick={() => commitSlippage(DEFAULT_SLIPPAGE_BPS)}
              >
                Auto
              </button>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Max slippage, percent"
                value={slippage}
                // Digits and a single point only — the field is a number, and a type="number"
                // spinner in a row this tight is more chrome than it is worth
                onChange={(event) =>
                  setSlippageDraft(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))
                }
                onBlur={() => commitSlippage(slippageBps)}
              />
              %
            </dd>
          </div>
          <div>
            <dt>You pay</dt>
            <dd>
              {parsedAmount > 0n
                ? side === 'buy'
                  ? `${formatQuote(parsedAmount, quoteDecimals)} ${quoteSymbol}`
                  : `${formatTokenAmount(parsedAmount)} $${launch?.symbol ?? ''}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>You receive</dt>
            <dd>
              {quotedOut > 0n
                ? side === 'buy'
                  ? `${formatTokenAmount(quotedOut)} $${launch?.symbol ?? ''}`
                  : `${formatQuote(quotedOut, quoteDecimals)} ${quoteSymbol}`
                : '—'}
              {side === 'buy' && quotedOut > 0n && canPriceUsd && (
                <small> · {formatUsd(tokenBaseToUsd(quotedOut, priceWei, quoteUsd, quoteDecimals))}</small>
              )}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          className={styles.launchCard__submit}
          onClick={handleSubmit}
          disabled={isBusy || !canSwap}
        >
          {isBusy
            ? 'Confirming…'
            : !canSwap
              ? 'Swaps not configured on this network yet'
              : isWrongChain
                ? `Switch to ${chainInfo?.name ?? 'network'}`
                : needsApproval
                  ? // A buy approves whatever the launch is paired against, not the token itself
                    `Approve ${side === 'buy' ? quoteSymbol : `$${launch?.symbol ?? ''}`}`
                  : side === 'buy'
                    ? `Buy $${launch?.symbol ?? ''}`
                    : `Sell $${launch?.symbol ?? ''}`}
        </button>

        {tokenBalance > 0n && (
          <div className={styles.launchCard__position}>
            <span className={styles.launchCard__positionLabel}>
              Your balance
              <svg
                key={cycle}
                className={clsx(styles.launchCard__tick, isValidating && styles['launchCard__tick--busy'])}
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <circle className={styles.launchCard__tickTrack} cx="10" cy="10" r="8" />
                <circle
                  className={styles.launchCard__tickFill}
                  cx="10"
                  cy="10"
                  r="8"
                  style={{ animationDuration: `${REFRESH_MS}ms` }}
                />
              </svg>
            </span>

            <div className={styles.launchCard__holding}>
              {imageUrl ? (
                <img src={imageUrl} alt="" className={styles.launchCard__holdingImage} />
              ) : (
                <span className={styles.launchCard__holdingImage} aria-hidden="true">
                  <CoinIcon size={16} />
                </span>
              )}
              <strong>
                {canPriceUsd
                  ? formatUsd(tokenBaseToUsd(tokenBalance, priceWei, quoteUsd, quoteDecimals))
                  : `${formatQuote((tokenBalance * priceWei) / WAD, quoteDecimals)} ${quoteSymbol}`}
              </strong>
              <span>
                {formatTokenAmount(tokenBalance)} ${launch?.symbol ?? ''}
              </span>
            </div>

            <dl className={styles.launchCard__terms}>
              <div>
                <dt>Spent</dt>
                <dd>
                  {position
                    ? canPriceUsd
                      ? formatUsd(quoteWeiToUsd(position.spentWei, quoteUsd, quoteDecimals))
                      : `${formatQuote(position.spentWei, quoteDecimals)} ${quoteSymbol}`
                    : '—'}
                </dd>
              </div>

              <div>
                <dt>Profit</dt>
                <dd>
                  {position ? (
                    <strong
                      className={clsx(
                        position.profitWei >= 0n ? styles['launchCard__pnl--up'] : styles['launchCard__pnl--down'],
                        flash && styles['launchCard__pnl--flash'],
                      )}
                    >
                      {position.profitWei >= 0n ? '+' : '−'}
                      {canPriceUsd
                        ? formatUsd(
                            Math.abs(
                              quoteWeiToUsd(position.profitWei < 0n ? -position.profitWei : position.profitWei, quoteUsd, quoteDecimals) ?? 0,
                            ),
                          )
                        : `${formatQuote(position.profitWei < 0n ? -position.profitWei : position.profitWei, quoteDecimals)} ${quoteSymbol}`}
                      {position.profitPct !== null && (
                        <span className={styles.launchCard__pnlBadge}>
                          {position.profitWei >= 0n ? '↑' : '↓'} {Math.abs(position.profitPct).toFixed(1)}%
                        </span>
                      )}
                    </strong>
                  ) : (
                    <span className={styles.launchCard__muted}>—</span>
                  )}
                </dd>
              </div>

              <div>
                <dt>Avg cost</dt>
                <dd>
                  {position?.avgEntryMcWei
                    ? `${
                        canPriceUsd
                          ? formatUsdCompact(quoteWeiToUsd(position.avgEntryMcWei, quoteUsd, quoteDecimals))
                          : `${formatQuote(position.avgEntryMcWei, quoteDecimals)} ${quoteSymbol}`
                      } MC`
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}

export default LaunchCard
