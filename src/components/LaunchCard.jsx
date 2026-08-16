'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { encodeFunctionData, erc20Abi, formatEther, parseEther, parseUnits } from 'viem'
import { useConnection, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  WAD,
  POOL_FEE,
  formatNative,
  formatPrice,
  formatTokenAmount,
  marketCapWei,
  sqrtPriceToPriceWei,
  withSlippage,
} from '@/lib/launch'
import launchAbi from '@/abis/HupLaunch.json'
import uniAbi from '@/abis/UniswapV3Periphery.json'
import { toast } from '@/components/NextToast'
import { CoinIcon } from '@phosphor-icons/react'
import styles from './LaunchCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const SLIPPAGE_BPS = 250 // 2.5%, the pools.trade default

// SwapRouter02's Constants.ADDRESS_THIS — the router itself, as an intermediate recipient so a
// sell's WNATIVE output can be unwrapped to native in the same multicall
const ROUTER_ADDRESS_THIS = '0x0000000000000000000000000000000000000002'
const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * Launch Card
 * The in-post trading surface for a Hup Launch. One-phase launches are ordinary Uniswap v3
 * pools, so this card is a swap widget: QuoterV2 previews, SwapRouter02 executes, and the same
 * pool serves every aggregator that routes the token. Metadata comes from the indexer; price
 * comes straight from the pool's slot0 so the card can never show a stale curve.
 *
 * @param {Object} props
 * @param {{launchId: string, token: string, chainId: number}} props.launchRef Content-JSON reference.
 */
const LaunchCard = ({ launchRef }) => {
  const { launchId, chainId } = launchRef ?? {}
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  const [side, setSide] = useState('buy')
  const [amount, setAmount] = useState('')

  const chainContracts = CONTRACTS[`chain${chainId}`]
  const launchAddress = chainContracts?.launch
  const routerAddress = chainContracts?.univ3Router
  const quoterAddress = chainContracts?.univ3Quoter
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)

  const { data: indexed } = useSWR(launchId && chainId ? `/api/v1/launches/${chainId}/${launchId}` : null, fetcher, {
    refreshInterval: 30_000,
  })
  const launch = indexed?.data

  const tokenAddress = launch?.token
  const poolAddress = launch?.pool

  // WNATIVE comes from the factory itself — the one address the swap path depends on that is
  // baked into the deployment rather than configured per client
  const { data: wnative } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'wnative',
    chainId,
    query: { enabled: Boolean(launchAddress), staleTime: Infinity },
  })

  const tokenIsToken0 = Boolean(
    tokenAddress && wnative && tokenAddress.toLowerCase() < wnative.toLowerCase(),
  )

  // Live price from the pool, not the indexed row — slot0 is one storage read
  const { data: slot0, refetch: refetchSlot0 } = useReadContract({
    abi: uniAbi.pool,
    address: poolAddress,
    functionName: 'slot0',
    chainId,
    query: { enabled: Boolean(poolAddress), refetchInterval: 15_000 },
  })

  const priceWei = useMemo(
    () => (slot0 ? sqrtPriceToPriceWei(slot0[0], tokenIsToken0) : BigInt(launch?.price ?? 0)),
    [slot0, tokenIsToken0, launch?.price],
  )

  const { data: tokenBalance = 0n, refetch: refetchBalance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'balanceOf',
    args: [address ?? ZERO],
    chainId,
    query: { enabled: Boolean(tokenAddress && address) },
  })

  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'allowance',
    args: [address ?? ZERO, routerAddress ?? ZERO],
    chainId,
    query: { enabled: Boolean(tokenAddress && address && routerAddress) },
  })

  const parsedAmount = useMemo(() => {
    const raw = amount.trim()
    if (!raw) return 0n
    try {
      return side === 'buy' ? parseEther(raw) : parseUnits(raw, 18)
    } catch {
      return 0n
    }
  }, [amount, side])

  // QuoterV2 simulates the exact swap the router will run, other LPs and all
  const { data: quoteResult } = useReadContract({
    abi: uniAbi.quoterV2,
    address: quoterAddress,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: side === 'buy' ? wnative ?? ZERO : tokenAddress ?? ZERO,
        tokenOut: side === 'buy' ? tokenAddress ?? ZERO : wnative ?? ZERO,
        amountIn: parsedAmount,
        fee: POOL_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
    chainId,
    query: { enabled: Boolean(quoterAddress && wnative && tokenAddress && parsedAmount > 0n) },
  })
  const quotedOut = quoteResult?.[0] ?? 0n

  const { data: hash, isPending, writeContract, error: submitError } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  // Refresh everything the card shows once a trade lands. The input reset rides the refetches
  // via setTimeout so the effect body itself performs no synchronous state write.
  useEffect(() => {
    if (!isConfirmed) return
    refetchSlot0()
    refetchBalance()
    refetchAllowance()
    const timer = setTimeout(() => setAmount(''), 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const needsApproval = side === 'sell' && parsedAmount > 0n && allowance < parsedAmount
  const isBusy = isPending || isConfirming
  const canSwap = Boolean(routerAddress && quoterAddress && poolAddress && wnative)

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

    if (needsApproval) {
      writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [routerAddress, parsedAmount],
        chainId,
      })
      return
    }

    const minOut = withSlippage(quotedOut, SLIPPAGE_BPS)

    if (side === 'buy') {
      // Router wraps msg.value into WNATIVE itself; tokens land directly with the buyer
      writeContract({
        abi: uniAbi.swapRouter02,
        address: routerAddress,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: wnative,
            tokenOut: tokenAddress,
            fee: POOL_FEE,
            recipient: address,
            amountIn: parsedAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
        value: parsedAmount,
        chainId,
      })
      return
    }

    // Sell: swap to WNATIVE held by the router, then unwrap to native in the same transaction —
    // the seller receives coin, never a wrapped token they'd have to unwrap themselves
    const swapCall = encodeFunctionData({
      abi: uniAbi.swapRouter02,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: tokenAddress,
          tokenOut: wnative,
          fee: POOL_FEE,
          recipient: ROUTER_ADDRESS_THIS,
          amountIn: parsedAmount,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })
    const unwrapCall = encodeFunctionData({
      abi: uniAbi.swapRouter02,
      functionName: 'unwrapWETH9',
      args: [minOut, address],
    })

    writeContract({
      abi: uniAbi.swapRouter02,
      address: routerAddress,
      functionName: 'multicall',
      args: [[swapCall, unwrapCall]],
      chainId,
    })
  }

  if (!launchId || !chainId) return null

  const imageUrl = launch?.image_cid ? resolveStorageImageUrl(launch.image_cid) : null

  return (
    <section className={styles.launchCard} onClick={(e) => e.stopPropagation()}>
      <header className={styles.launchCard__header}>
        <Link href={`/launches/${chainId}/${launchId}`} className={styles.launchCard__identity}>
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
            {formatPrice(priceWei)} {nativeSymbol}
          </dd>
        </div>
        <div>
          <dt>Market cap</dt>
          <dd>
            {formatNative(marketCapWei(priceWei))} {nativeSymbol}
          </dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{launch?.trade_count ?? 0}</dd>
        </div>
      </dl>

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

        <div className={styles.launchCard__input}>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="0.0"
            aria-label={side === 'buy' ? `Amount in ${nativeSymbol}` : `Amount of ${launch?.symbol ?? 'tokens'}`}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isBusy || !canSwap}
          />
          <span>{side === 'buy' ? nativeSymbol : `$${launch?.symbol ?? ''}`}</span>
          {side === 'sell' && tokenBalance > 0n && (
            <button type="button" onClick={() => setAmount(formatEther(tokenBalance))}>
              Max
            </button>
          )}
        </div>

        {quotedOut > 0n && (
          <p className={styles.launchCard__quote}>
            Receive ≈{' '}
            <strong>
              {side === 'buy'
                ? `${formatTokenAmount(quotedOut)} $${launch?.symbol}`
                : `${formatNative(quotedOut)} ${nativeSymbol}`}
            </strong>
          </p>
        )}

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
                  ? `Approve $${launch?.symbol ?? ''}`
                  : side === 'buy'
                    ? `Buy $${launch?.symbol ?? ''}`
                    : `Sell $${launch?.symbol ?? ''}`}
        </button>

        {tokenBalance > 0n && (
          <p className={styles.launchCard__holding}>
            You hold {formatTokenAmount(tokenBalance)} ${launch?.symbol} ·{' '}
            {formatNative((tokenBalance * priceWei) / WAD)} {nativeSymbol}
          </p>
        )}
      </div>
    </section>
  )
}

export default LaunchCard
