'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { formatUnits, isAddress, parseUnits } from 'viem'
import { useConnection, useSwitchChain } from 'wagmi'
import { config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { networkColorStyle } from '@/lib/networkColors'
import { describeWalletError } from '@/lib/walletErrors'
import { clampFeeBps, formatAmount } from '@/lib/uniswap'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { describeRouterRevert } from '@/lib/uniswap-v4'
import { getChainIconUrl } from '@/lib/chains'
import { canTradeOnSolana, isSolanaNetworkId, solanaChainFor } from '@/config/solana'
import { isMint } from '@/lib/solanaSwap'
import useTokenSwap, { canSwapOn, useTokenIdentity } from '@/hooks/useTokenSwap'
import useSolanaSwap, { SOL_DECIMALS, useSolanaAccount, useSolanaTokenInfo } from '@/hooks/useSolanaSwap'
import { useSolanaWallet } from '@/hooks/useSolanaWallet'
import useNativePrice from '@/hooks/useNativePrice'
import useTokenMarket from '@/hooks/useTokenMarket'
import TokenIcon from '@/components/ui/TokenIcon'
import CopyButton from '@/components/ui/CopyButton'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { toast } from '@/components/NextToast'
import styles from './TokenTradeCard.module.scss'

// The dollar rungs the widget offers. Small on purpose: this is a tap inside a feed, not a
// position — anyone sizing a real trade will type a number.
const USD_PRESETS = [1, 5, 15, 50]

// What the presets become on a chain with no market price for its coin, so a testnet card
// still trades instead of showing dollars nobody can price
const COIN_PRESETS = [0.001, 0.005, 0.01, 0.05]

// Selling is denominated in what the reader already holds, because "$5 of a token you own"
// is a quantity they would have to work out themselves
const SELL_PRESETS = [25, 50, 100]

// Gas coins that are already dollars, so a dollar preset needs no conversion (Arc pays gas in USDC)
const STABLE_NATIVE = new Set(['USDC', 'USDT', 'USDG'])

const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const smallUsdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 })
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** A contract address as a card can show one: enough of both ends to check against a source. */
const shortAddress = (value) => (typeof value === 'string' && value.length > 14 ? value.slice(0, 6) + '…' + value.slice(-4) : (value ?? ''))

const priceLabel = (value) => {
  if (!Number.isFinite(value) || value <= 0) return null
  return value < 0.01 ? smallUsdFormat.format(value) : usdFormat.format(value)
}

/**
 * A coin amount in its chain's base units, or zero when it cannot be expressed.
 *
 * toFixed rather than String(): a small dollar amount over a large coin price lands in
 * exponential notation, which parseUnits rejects outright. Module scope rather than inline in
 * the memo below because the React compiler declines to memoize a block containing try/catch.
 */
const toBaseUnits = (coinAmount, decimals) => {
  if (!Number.isFinite(coinAmount) || coinAmount <= 0) return 0n
  try {
    return parseUnits(coinAmount.toFixed(decimals), decimals)
  } catch {
    return 0n
  }
}

/**
 * Whether a post's token entry names something this app can actually route a trade for. EVM
 * entries need a chain with a venue; Solana entries need a base58 mint on a cluster Jupiter
 * indexes. Anything else is dropped rather than rendered as a button that cannot work.
 */
const isTradeable = (token) => {
  const chainId = Number(token?.chainId)
  if (isSolanaNetworkId(chainId)) return canTradeOnSolana(chainId) && isMint(token?.address)
  return Boolean(token?.address) && isAddress(token.address) && canSwapOn(chainId)
}

/** The amount a buy is sized at, in whichever unit its preset ladder is labelled in. */
const chosenBuyAmount = (custom, preset) => {
  const typed = custom.trim() === '' ? null : Number(custom)
  return typed !== null && Number.isFinite(typed) && typed > 0 ? typed : preset
}

/**
 * What the reader is about to spend, in the spending side's base units: a slice of their
 * holding when selling, and the preset or typed amount converted through the coin price when
 * buying. Pure, so the card can call it during render and let the compiler memoize it.
 */
const sizeAmountIn = ({ active, buying, tokenBalance, sellPercent, custom, preset, nativePrice, coinDecimals = 18 }) => {
  if (!active) return 0n
  if (!buying) {
    if (tokenBalance === undefined) return 0n
    return (tokenBalance * BigInt(sellPercent)) / 100n
  }

  const chosen = chosenBuyAmount(custom, preset)
  if (!chosen || chosen <= 0) return 0n
  // A typed amount is in the same unit as the buttons beside it — dollars, or coin
  return toBaseUnits(nativePrice ? chosen / nativePrice : chosen, coinDecimals)
}

/** A base-unit amount as the card states it: compact past ten thousand, four significant digits below. */
const qtyLabel = (value, decimals) => {
  if (value === undefined || value === null || decimals === null || decimals === undefined) return null
  const asNumber = Number(formatUnits(value, decimals))
  if (!Number.isFinite(asNumber)) return null
  return asNumber >= 10_000 ? compactNumber.format(asNumber) : formatAmount(value, decimals, 4)
}

/**
 * Token Trade Card
 * The widget a post carries when its author attached tokens: pick one, tap a preset, sign once.
 *
 * Everything the card trades on is resolved live — decimals and balances off the chain, price
 * off the market route — because the post's own JSON is author-controlled and editable after
 * the fact. The only things taken from the post are which tokens to show and what fee rate to
 * ask for, and the rate is clamped before it can reach a router. The fee is paid to the post's
 * signed author, never to an address the JSON names.
 *
 * @param {Object} props
 * @param {Object} props.trade The post's `content.tokenTrade` payload.
 * @param {string} props.author The post row's wallet_address — who the creator fee pays.
 */
export default function TokenTradeCard({ trade, author }) {
  const { address, isConnected, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { address: solanaAddress, isConnected: solanaConnected, connect: connectSolana, wallets: solanaWallets } = useSolanaWallet()

  // Only tokens the app could actually route for — a chain that lost its venue config should
  // drop the card, not offer a button that cannot work
  const tokens = useMemo(() => {
    const list = Array.isArray(trade?.tokens) ? trade.tokens : []
    return list.filter(isTradeable).slice(0, 4)
  }, [trade])

  const [activeIndex, setActiveIndex] = useState(0)
  const [mode, setMode] = useState('buy')
  const [presetIndex, setPresetIndex] = useState(1)
  const [custom, setCustom] = useState('')
  const [sellPercent, setSellPercent] = useState(SELL_PRESETS[0])

  const active = tokens[Math.min(activeIndex, tokens.length - 1)] ?? null
  const chainId = Number(active?.chainId)
  const onSolana = isSolanaNetworkId(chainId)
  const chainInfo = useMemo(
    () => (isSolanaNetworkId(chainId) ? solanaChainFor(chainId) : (appChains.find((candidate) => candidate.id === chainId) ?? null)),
    [chainId],
  )
  // Built from the chain id rather than config/chainBadges, whose slug map stops at the older
  // chains — Monad, Robinhood and Arc would all render unbadged through it
  const chainBadge = useMemo(() => {
    const url = getChainIconUrl(chainId)
    return url ? { url, label: chainInfo?.name ?? `chain ${chainId}` } : null
  }, [chainId, chainInfo])

  // --- prices, from whichever upstream answers for this chain family ---

  const evmNativePrice = useNativePrice(onSolana ? null : chainId)
  // Every attached EVM token, not only the active one — the switcher pills need artwork too, and
  // the market route already takes a batch, so asking for all of them costs one request either way
  const marketAssets = useMemo(
    () =>
      tokens
        .filter((entry) => !isSolanaNetworkId(Number(entry.chainId)))
        .map((entry) => ({ id: `${entry.chainId}:${entry.address}`, chainId: Number(entry.chainId), address: entry.address })),
    [tokens],
  )
  const { market } = useTokenMarket(marketAssets)
  const solanaMints = useMemo(
    () => tokens.filter((entry) => isSolanaNetworkId(Number(entry.chainId))).map((entry) => entry.address),
    [tokens],
  )
  const { info: solanaInfo, solPrice, others: solanaOthers } = useSolanaTokenInfo(onSolana ? active?.address : null, solanaMints)

  /**
   * Artwork for any attached token, wherever its chain's answer comes from.
   *
   * Everything is run through resolveStorageImageUrl with a width, because plenty of token icons
   * are IPFS gateway URLs and the browser blocks a cross-origin read of those (ORB) — that step
   * recovers the CID and serves it from this origin instead.
   */
  const logoFor = (entry) => {
    if (!entry) return null
    const id = Number(entry.chainId)
    const raw = isSolanaNetworkId(id)
      ? ((entry.address === active?.address ? solanaInfo : solanaOthers?.[entry.address])?.logo ?? entry.logo)
      : (market[`${id}:${String(entry.address).toLowerCase()}`]?.logo ?? entry.logo)

    return raw ? (resolveStorageImageUrl(raw, { width: 96 }) ?? raw) : null
  }

  // A chain whose gas coin is a dollar stablecoin needs no price feed to price it — Arc's is
  // USDC, so $5 is 5 coins exactly, and waiting on a feed that may never answer would drop the
  // card to its coin-denominated rungs for no reason
  const nativePrice = onSolana ? solPrice : (STABLE_NATIVE.has(chainInfo?.nativeCurrency?.symbol) ? 1 : evmNativePrice)
  const quoteMarket = onSolana
    ? solanaInfo
    : active
      ? market[`${chainId}:${String(active.address).toLowerCase()}`]
      : null

  // Solana takes no creator cut: Jupiter will not skim without a token account to skim into,
  // and a post's author is an EVM address with no linked Solana pubkey to derive one from
  const feeBps = onSolana ? 0 : clampFeeBps(trade?.feeBps)
  const buying = mode === 'buy'

  // --- what the reader is spending, in base units ---

  // Sizing a sell needs the balance before an amount exists, and the engine takes the amount.
  // Reading identity separately breaks that loop; the engine shares these exact queries.
  const evmIdentity = useTokenIdentity(onSolana ? null : chainId, onSolana ? null : (active?.address ?? null), address ?? null)
  const solIdentity = useSolanaAccount(onSolana ? chainId : null, onSolana ? (active?.address ?? null) : null, solanaAddress)

  const decimals = onSolana ? solIdentity.decimals : evmIdentity.decimals
  const tokenBalance = onSolana ? solIdentity.tokenBalance : evmIdentity.tokenBalance
  // SOL is nine decimals where every EVM coin here is eighteen, and the presets are priced in
  // the spending coin — getting this wrong misprices a $5 buy by nine orders of magnitude
  const coinDecimals = onSolana ? SOL_DECIMALS : 18

  // The rungs are dollars on a chain with a coin price and coin on one without. Holding the
  // choice as a position on the ladder rather than as a value means a price arriving late
  // swaps the ladder underneath without leaving the selection pointing at nothing.
  const usdRungs = Boolean(nativePrice)
  const buyRungs = usdRungs ? USD_PRESETS : COIN_PRESETS
  const preset = buyRungs[presetIndex] ?? buyRungs[1]

  // Left to the React compiler rather than hand-memoized: it is arithmetic over values that
  // change together, and a useMemo here only stops the compiler doing a better job of it
  const amountIn = sizeAmountIn({ active, buying, tokenBalance, sellPercent, custom, preset, nativePrice, coinDecimals })

  // Both engines are called every render — hooks cannot be conditional — and the one that does
  // not match the active token is handed a null and quotes nothing.
  const evmSwap = useTokenSwap({
    chainId: onSolana ? undefined : chainId,
    token: onSolana ? null : (active?.address ?? null),
    direction: mode,
    amountIn: onSolana ? 0n : amountIn,
    account: address ?? null,
    feeBps,
    feeRecipient: author ?? null,
  })
  const solSwap = useSolanaSwap({
    chainId: onSolana ? chainId : null,
    token: onSolana ? (active?.address ?? null) : null,
    direction: mode,
    amountIn: onSolana ? amountIn : 0n,
  })
  const swap = onSolana ? solSwap : evmSwap

  // --- outcome reporting, which has to outlive a re-render of this card ---

  const reportedRef = useRef(null)
  useEffect(() => {
    if (!swap.isConfirmed || !swap.hash || reportedRef.current === swap.hash) return
    reportedRef.current = swap.hash
    toast(swap.lastAction === 'approve' ? 'Approved — ready to trade' : 'Trade confirmed', 'success')
    if (swap.lastAction !== 'swap') return undefined
    // Clearing the field rides a timeout so the effect body itself performs no synchronous
    // state write — the same dance the other trading surfaces use after a receipt
    const timer = setTimeout(() => setCustom(''), 0)
    return () => clearTimeout(timer)
  }, [swap.isConfirmed, swap.hash, swap.lastAction])

  const erroredRef = useRef(null)
  useEffect(() => {
    if (!swap.submitError || erroredRef.current === swap.submitError) return
    erroredRef.current = swap.submitError
    const reason =
      describeRouterRevert(swap.submitError, { symbol: swap.symbol ?? active?.symbol ?? 'tokens' }) ??
      describeWalletError(swap.submitError, { chain: chainInfo, fallback: 'Trade rejected' })
    toast(reason, 'error')
  }, [swap.submitError, swap.symbol, active, chainInfo])

  // Switching token or side invalidates whatever was typed for the old one. Done in the
  // handlers rather than in an effect on the value — the only way either changes is a tap,
  // and an effect would be a second render chasing the first.
  const pickToken = (index) => {
    setActiveIndex(index)
    setCustom('')
  }

  const pickMode = (next) => {
    setMode(next)
    setCustom('')
  }

  if (tokens.length === 0 || !active) return null

  // --- labels ---

  const symbol = swap.launchMeta?.symbol ?? swap.symbol ?? quoteMarket?.symbol ?? active.symbol ?? 'token'
  const tokenName = swap.launchMeta?.name ?? swap.name ?? quoteMarket?.name ?? null
  // Solana has no chain to be on the wrong one of — the wallet is separate from the EVM one
  // and a cluster is not something a wallet switches between mid-session
  const walletHere = onSolana ? solanaConnected : isConnected
  const isWrongChain = !onSolana && isConnected && walletChain?.id !== chainId
  // From the engine, not guessed here: on a chain whose coin has two faces the winning pool
  // decides which scale the amounts are in, and only the engine knows which one won
  const spendDecimals = swap.spendDecimals ?? (buying ? coinDecimals : decimals)
  const receiveDecimals = swap.receiveDecimals ?? (buying ? decimals : coinDecimals)
  // useBalance only names the coin once a wallet is connected, and this card is read by
  // signed-out visitors more often than not — the chain itself knows its own ticker
  const coinSymbol = swap.nativeSymbol ?? chainInfo?.nativeCurrency?.symbol ?? 'coin'
  const receiveSymbol = buying ? symbol : coinSymbol

  const change24h = quoteMarket?.change24h ?? null
  const hasChange = Number.isFinite(change24h)
  const isUp = hasChange ? change24h >= 0 : true

  const spendLabel = qtyLabel(swap.spendAmountIn ?? amountIn, spendDecimals)
  const receiveLabel = qtyLabel(swap.expectedOut, receiveDecimals)

  const amountChosen = amountIn > 0n
  const canAct = amountChosen && !swap.insufficient && Boolean(swap.quote)

  const actionLabel = () => {
    if (!walletHere) return onSolana ? 'Connect Solana wallet' : 'Connect wallet'
    if (isWrongChain) return `Switch to ${chainInfo?.name ?? 'the right network'}`
    if (!amountChosen) return buying ? 'Pick an amount' : `You hold no ${symbol}`
    if (swap.insufficient) return `Not enough ${buying ? coinSymbol : symbol}`
    if (swap.isQuoting && !swap.quote) return 'Finding the best price…'
    if (swap.noRoute) return onSolana ? 'No route for this pair' : 'No pool for this pair'
    if (swap.isBusy) return 'Confirm in your wallet…'
    if (swap.needsApproval) return `Approve ${symbol} · 1 of 2`
    if (buying) return `Buy ${describeSpend({ custom, preset, usdRungs, coinSymbol })} of ${symbol}`
    return `Sell ${sellPercent}% of your ${symbol}`
  }

  const handleAction = () => {
    if (!walletHere) {
      // Solana connects by wallet name rather than through the EVM modal; with exactly one
      // detected there is nothing to choose between, so connect it rather than asking
      if (onSolana && solanaWallets?.length === 1) {
        connectSolana?.(solanaWallets[0].name)?.catch?.(() => {})
        return
      }
      toast(onSolana ? 'Connect a Solana wallet to trade' : 'Connect your wallet to trade', 'error')
      return
    }
    if (isWrongChain) {
      switchChain.mutate?.({ chainId })
      return
    }
    if (!canAct) return
    swap.submit()
  }

  const presets = buying ? buyRungs : SELL_PRESETS
  const presetLabel = (value) => {
    if (!buying) return `${value}%`
    return usdRungs ? usdFormat.format(value) : `${value} ${coinSymbol}`
  }
  // A typed amount takes the selection off the ladder, so nothing is highlighted while it stands
  const isPresetActive = (value, index) =>
    buying ? custom.trim() === '' && index === presetIndex : sellPercent === value

  return (
    <section
      className={styles.tokenTrade}
      style={networkColorStyle(chainInfo)}
      // The card lives inside a post card that opens the thread on click
      onClick={(event) => event.stopPropagation()}
    >
      {tokens.length > 1 && (
        <div className={styles.tokenTrade__pills} role="tablist" aria-label="Tokens in this post">
          {tokens.map((token, index) => (
            <button
              key={`${token.chainId}:${token.address}`}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={clsx(styles.tokenTrade__pill, index === activeIndex && styles['tokenTrade__pill--active'])}
              onClick={() => pickToken(index)}
            >
              {/* No symbol passed: the pill prints the ticker right beside the disc, so initials
                  inside it would just say the same word twice */}
              <TokenIcon token={{ logo: logoFor(token), address: token.address }} chainId={Number(token.chainId)} size="sm" />
              {token.symbol ?? 'token'}
            </button>
          ))}
        </div>
      )}

      <header className={styles.tokenTrade__head}>
        <TokenIcon
          token={{ logo: swap.launchMeta?.logo ?? logoFor(active), address: active.address, symbol }}
          chainId={chainId}
          size="md"
          badge={chainBadge}
        />

        <div className={styles.tokenTrade__identity}>
          <span className={styles.tokenTrade__titles}>
            {tokenName && <span className={styles.tokenTrade__name}>{tokenName}</span>}
            <span className={styles.tokenTrade__symbol}>{symbol}</span>
          </span>

          <span className={styles.tokenTrade__meta}>
            {/* The contract, because on a card that asks for money the address is the only thing
                that actually identifies the token — a ticker is not unique on any chain */}
            <CopyButton
              value={active.address}
              label={shortAddress(active.address)}
              title={`Copy the ${symbol} contract address`}
              size={12}
              className={styles.tokenTrade__address}
            />
            {priceLabel(quoteMarket?.usd) && <span className={styles.tokenTrade__price}>{priceLabel(quoteMarket.usd)}</span>}
            {hasChange && (
              <span className={clsx(styles.tokenTrade__change, styles[`tokenTrade__change--${isUp ? 'up' : 'down'}`])}>
                {isUp ? '↑' : '↓'} {percentFormat.format(Math.abs(change24h))}%
              </span>
            )}
          </span>
        </div>

        {/* Sell only appears once there is something to sell — offering it to a reader holding
            nothing is a dead tab that still costs a tap to discover */}
        {tokenBalance > 0n && (
          <SegmentedControl
            options={[
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
            ]}
            value={mode}
            onChange={pickMode}
            label="Trade direction"
            size="sm"
            className={styles.tokenTrade__mode}
          />
        )}
      </header>

      <div className={styles.tokenTrade__presets}>
        {presets.map((value, index) => (
          <button
            key={value}
            type="button"
            className={clsx(styles.tokenTrade__preset, isPresetActive(value, index) && styles['tokenTrade__preset--active'])}
            onClick={() => {
              if (buying) {
                setPresetIndex(index)
                setCustom('')
              } else {
                setSellPercent(value)
              }
            }}
          >
            {presetLabel(value)}
          </button>
        ))}
        {buying && (
          <input
            type="text"
            inputMode="decimal"
            className={styles.tokenTrade__custom}
            placeholder="Custom"
            value={custom}
            aria-label={usdRungs ? 'Custom amount in dollars' : `Custom amount in ${coinSymbol}`}
            onChange={(event) => {
              const next = event.target.value.replace(/[^0-9.]/g, '')
              if ((next.match(/\./g) ?? []).length <= 1) setCustom(next)
            }}
          />
        )}
      </div>

      {/* A quote can land before the token's decimals do, and without decimals there is no way
          to write the amount down. That is a loading state, not a dead pair — saying "no route"
          there would blame the pool for our own missing read. */}
      <p className={styles.tokenTrade__detail}>
        {(swap.isQuoting && !swap.quote) || (swap.quote && !receiveLabel) ? (
          <span className={clsx('shimmer', styles.tokenTrade__detailSkeleton)} />
        ) : swap.quote ? (
          <>
            <span className={styles.tokenTrade__receive}>
              ≈ {receiveLabel} {receiveSymbol}
            </span>
            {spendLabel && (
              <span className={styles.tokenTrade__spend}>
                for {spendLabel} {buying ? coinSymbol : symbol}
              </span>
            )}
            {/* The rate the winning route can actually take, not the one the post asked for — a
                classic AMM has no fee primitive, so a trade that lands there carries no cut and
                must not claim one */}
            {swap.feeBps > 0 && (
              <span className={styles.tokenTrade__spend}>· {percentFormat.format(swap.feeBps / 100)}% to author</span>
            )}
            <span className={styles.tokenTrade__venue}>· {onSolana ? 'Jupiter' : (swap.quote?.label ?? 'Uniswap')}</span>
          </>
        ) : (
          <span className={styles.tokenTrade__spend}>
            {!amountChosen ? 'Pick an amount' : swap.noRoute ? 'No route for this size' : 'Finding a price…'}
          </span>
        )}
      </p>

      <button
        type="button"
        // Green says go. When the button is reporting a state rather than offering a trade —
        // no route, not enough coin, nothing picked — it drops to neutral, so the colour never
        // promises something the label is denying.
        className={clsx(
          styles.tokenTrade__action,
          walletHere && !isWrongChain && !canAct
            ? styles['tokenTrade__action--idle']
            : styles[`tokenTrade__action--${buying ? 'buy' : 'sell'}`],
        )}
        onClick={handleAction}
        disabled={walletHere && !isWrongChain && (!canAct || swap.isBusy)}
      >
        {actionLabel()}
      </button>
    </section>
  )
}

/** How the button names the amount, in whichever unit the buttons beside it are labelled in. */
const describeSpend = ({ custom, preset, usdRungs, coinSymbol }) => {
  const chosen = chosenBuyAmount(custom, preset)
  return usdRungs ? usdFormat.format(chosen) : `${chosen} ${coinSymbol}`
}


