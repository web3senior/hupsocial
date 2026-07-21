'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import clsx from 'clsx'
import { zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { marketStatus, outcomeColor, parseJsonArray, toRelative } from '@/lib/predict'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import useStakeToken, { formatStake } from '@/hooks/useStakeToken'
import predictAbi from '@/abis/HupPredict.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import PlaceBetModal from '@/components/PlaceBetModal'
import Share from '@/components/ui/Share'
import { ContentSpinner } from '@/components/Loading'
import {
  CaretLeftIcon,
  CaretRightIcon,
  CoinsIcon,
  CurrencyDollarIcon,
  ScalesIcon,
  ShareNetworkIcon,
  TimerIcon,
  UserIcon,
  UsersIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import styles from './MarketDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

export default function MarketDetail({ networkId, marketId }) {
  const router = useRouter()
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  const chainId = Number(networkId)
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const predictAddress = CONTRACTS[`chain${chainId}`]?.predict || null
  const publicClient = usePublicClient({ chainId })
  const isWrongChain = Boolean(walletChain && address && walletChain.id !== chainId)

  const detailKey = `/api/v1/predict/${marketId}?networkId=${chainId}${address ? `&bettor=${address.toLowerCase()}` : ''}`
  // refreshInterval keeps chances/pools/activity live while the page is open
  const { data: detail, isLoading, mutate } = useSWR(detailKey, fetcher, { refreshInterval: 10000 })

  const market = detail?.data?.market
  const status = market ? marketStatus(market) : null
  const outcomes = market ? parseJsonArray(market.outcome_labels) : []
  const pools = market ? parseJsonArray(market.outcome_pools) : []
  const judges = market ? parseJsonArray(market.judges) : []
  const position = detail?.data?.position ?? []
  const claim = detail?.data?.claim ?? null
  const holders = detail?.data?.holders ?? []
  const recentBets = detail?.data?.recentBets ?? []
  const participantCount = detail?.data?.participantCount ?? 0

  const { symbol, decimals } = useStakeToken(chainId, market?.token, Boolean(Number(market?.is_token_lsp7)))

  const lowerAddress = address?.toLowerCase()
  const isCreator = Boolean(lowerAddress && market?.wallet_address === lowerAddress)
  const isJudge = Boolean(lowerAddress && judges.includes(lowerAddress))

  // Render-stable clock (lazy initializer runs once) — SWR revalidation refreshes the page
  // data anyway, so second-precision liveness isn't worth an impure render
  const [mountedAt] = useState(() => Math.floor(Date.now() / 1000))
  const deadlinePassed = market ? Number(market.betting_deadline) <= mountedAt : false

  // Onchain truth for what the connected wallet can claim right now (covers winnings,
  // refunds, and the already-claimed case without recomputing pool math clientside)
  const { data: claimable, refetch: refetchClaimable } = useReadContract({
    abi: predictAbi,
    address: predictAddress,
    functionName: 'claimableAmount',
    args: [BigInt(marketId), address ?? zeroAddress],
    chainId,
    query: { enabled: Boolean(predictAddress && address && market && ['resolved', 'refunding'].includes(status?.key)) },
  })

  // enableRefunds unlocks at this unix time — read live so the button appears without a reload
  const { data: refundEligibleAt } = useReadContract({
    abi: predictAbi,
    address: predictAddress,
    functionName: 'refundEligibleAt',
    args: [BigInt(marketId)],
    chainId,
    query: { enabled: Boolean(predictAddress && market && ['open', 'awaiting'].includes(status?.key)) },
  })
  const refundsUnlockable = Boolean(refundEligibleAt && Number(refundEligibleAt) > 0 && Number(refundEligibleAt) <= mountedAt)

  const [betOutcome, setBetOutcome] = useState(null)
  const [resolveMode, setResolveMode] = useState(false)
  const [resolveChoice, setResolveChoice] = useState(null)
  const [infoTab, setInfoTab] = useState('holders')
  const [isBurnerBusy, setIsBurnerBusy] = useState(false)
  const [lastAction, setLastAction] = useState(null)

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming || isBurnerBusy

  useEffect(() => {
    if (submitError) toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed || !lastAction) return
    toast(`${lastAction} confirmed — the page updates once the indexer catches up`, 'success')
    refetchClaimable()
    mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  /** Sends a HupPredict write through the burner session when active, else the wallet. */
  const submitTx = async (functionName, args, actionLabel) => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!predictAddress) {
      toast("The predict contract isn't available on this network yet", 'error')
      return
    }

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsBurnerBusy(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: predictAddress,
          abi: predictAbi,
          functionName,
          args,
        })
        toast(`${actionLabel} confirmed — the page updates once the indexer catches up`, 'success')
        setResolveMode(false)
        setResolveChoice(null)
        refetchClaimable()
        mutate()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsBurnerBusy(false)
      }
      return
    }

    setLastAction(actionLabel)
    writeContract({ abi: predictAbi, address: predictAddress, functionName, args, chainId })
    // Resolve mode exits as soon as the transaction is handed to the wallet — if it's
    // rejected or fails, the judge just re-enters it
    setResolveMode(false)
    setResolveChoice(null)
  }

  if (isLoading) return <ContentSpinner />

  if (!market) {
    return (
      <div className={styles.market__missing}>
        <WarningIcon size={32} />
        <p>This market doesn&apos;t exist on {chainInfo?.name || `network #${chainId}`} — or the indexer hasn&apos;t caught up yet.</p>
      </div>
    )
  }

  const totalPool = BigInt(market.total_pool || '0')
  const volume = formatStake(market.total_pool, decimals)
  const positionByOutcome = Object.fromEntries(position.map((row) => [Number(row.outcome), row.amount]))
  const claimableAmount = claimable !== undefined && decimals !== undefined ? formatStake(claimable.toString(), decimals) : null

  const canBet = status.key === 'open' && Boolean(address)
  const canCloseBetting = status.key === 'open' && (isCreator || isJudge)
  const canResolve = isJudge && (status.key === 'awaiting' || (status.key === 'open' && deadlinePassed))
  const canCancel = (isCreator || isJudge) && ['open', 'awaiting'].includes(status.key)

  return (
    <div className={`${styles.market} animate fade`}>
      <button type="button" className={styles.market__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      {market.image_cid && (
        <img className={styles.market__cover} src={resolveStorageImageUrl(market.image_cid, { width: 1200 }) || market.image_cid} alt="" />
      )}

      <header className={styles.market__header}>
        <span className={clsx(styles.market__badge, styles[`market__badge--${status.key}`])}>{status.label}</span>
        <h1 className={styles.market__title}>{market.title || 'Untitled market'}</h1>

        <p className={styles.market__meta}>
          <span>
            <TimerIcon size={14} />
            {toRelative(market.opened_at)}
          </span>
        </p>

        {/* Creator and judges render through the shared Profile component, like posts —
            avatar hover card, follow affordances, and the /{'{wallet}'} profile link included */}
        <div className={styles.market__people}>
          <div className={styles.market__peopleGroup}>
            <small>
              <UserIcon size={12} />
              Creator
            </small>
            <Profile variant="fullWithoutTime" creator={market.wallet_address} networkId={chainId} />
          </div>
          <div className={styles.market__peopleGroup}>
            <small>
              <ScalesIcon size={12} />
              {judges.length === 1 ? 'Judge' : 'Judges'}
            </small>
            {judges.map((judge) => (
              <Profile key={judge} variant="fullWithoutTime" creator={judge} networkId={chainId} />
            ))}
          </div>
        </div>

        {market.description && <p className={styles.market__description}>{market.description}</p>}

        <p className={styles.market__volume}>
          <span>
            <CurrencyDollarIcon size={20} />
            Volume: {volume ?? '…'} {symbol}
          </span>
          <span className={styles.market__participants}>
            <UsersIcon size={16} />
            {participantCount} {participantCount === 1 ? 'bettor' : 'bettors'}
          </span>
        </p>

        {status.key === 'open' && (
          <p className={styles.market__deadline}>Betting closes {toRelative(market.betting_deadline)}</p>
        )}
        {status.key === 'awaiting' && refundEligibleAt && Number(refundEligibleAt) > 0 && !refundsUnlockable && (
          <p className={styles.market__deadline}>If no judge resolves, refunds unlock {toRelative(Number(refundEligibleAt))}</p>
        )}

        {isWrongChain && (address ? canBet || canResolve || canCloseBetting || canCancel || refundsUnlockable : false) && (
          <div className={styles.market__chainWarning}>
            <WarningIcon size={14} />
            <span>This market lives on {chainInfo?.name || 'another network'}.</span>
            <button type="button" onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        <div className={styles.market__actions}>
          {canCloseBetting && !resolveMode && (
            <button
              type="button"
              className={styles['market__action--primary']}
              onClick={() => submitTx('closeBetting', [address, BigInt(marketId)], 'Betting closed')}
              disabled={isBusy || isWrongChain}
            >
              Close Betting
            </button>
          )}

          {canResolve && !resolveMode && (
            <button type="button" className={styles['market__action--primary']} onClick={() => setResolveMode(true)} disabled={isBusy}>
              Resolve
            </button>
          )}

          {resolveMode && (
            <>
              <button
                type="button"
                className={styles['market__action--primary']}
                onClick={() =>
                  submitTx(
                    'resolve',
                    [address, BigInt(marketId), resolveChoice],
                    `Resolved to "${outcomes[resolveChoice]?.label || `#${resolveChoice + 1}`}"`,
                  )
                }
                disabled={isBusy || resolveChoice === null || isWrongChain}
              >
                {resolveChoice === null
                  ? 'Pick the winning outcome below'
                  : `Confirm: ${outcomes[resolveChoice]?.label || `Outcome #${resolveChoice + 1}`} won`}
              </button>
              <button type="button" className={styles.market__action} onClick={() => { setResolveMode(false); setResolveChoice(null) }} disabled={isBusy}>
                Never mind
              </button>
            </>
          )}

          {claimable !== undefined && claimable > 0n && (
            <button
              type="button"
              className={styles['market__action--claim']}
              onClick={() => submitTx('claim', [address, BigInt(marketId)], status.key === 'resolved' ? 'Winnings claimed' : 'Refund claimed')}
              disabled={isBusy || isWrongChain}
            >
              <CoinsIcon size={16} />
              Claim {claimableAmount ?? ''} {symbol}
            </button>
          )}

          {refundsUnlockable && (
            <button
              type="button"
              className={styles.market__action}
              onClick={() => submitTx('enableRefunds', [BigInt(marketId)], 'Refunds enabled')}
              disabled={isBusy || isWrongChain}
            >
              Enable refunds — the judge ran out of time
            </button>
          )}

          {canCancel && !resolveMode && (
            <button
              type="button"
              className={styles.market__action}
              onClick={() => submitTx('cancelMarket', [address, BigInt(marketId)], 'Market canceled')}
              disabled={isBusy || isWrongChain}
            >
              Cancel &amp; refund everyone
            </button>
          )}

          {/* Same target menu a post's share action offers (copy link, X, Telegram, ...) */}
          <Share
            url={`${window.location.origin}/predict/${chainId}/${marketId}`}
            title={market.title || 'Prediction market'}
            creator={market.wallet_address}
            copyLabel="Copy market link"
            copiedToast="Market link copied"
            trigger={
              <button type="button" className={styles.market__action} aria-label="Share market">
                <ShareNetworkIcon size={16} />
                Share
              </button>
            }
          />
        </div>

        {claim && (
          <p className={styles.market__claimed}>
            You claimed {formatStake(claim.amount, decimals) ?? claim.amount} {symbol} {toRelative(claim.claimed_at)}.
          </p>
        )}
      </header>

      <section className={styles.market__outcomes} aria-label="Outcomes">
        {Array.from({ length: Number(market.outcome_count) }, (_, index) => {
          const pool = BigInt(pools[index] ?? '0')
          const share = totalPool > 0n ? Number((pool * 10000n) / totalPool) / 100 : 0
          // Parimutuel implied payout: the fee-adjusted pot divided by this outcome's pool
          const distributable = Number(totalPool) * (1 - Number(market.fee_bps) / 10000)
          const multiplier = pool > 0n ? distributable / Number(pool) : null
          const yourBet = positionByOutcome[index]
          const isWinner = status.key === 'resolved' && Number(market.winning_outcome) === index
          const clickable = (canBet || resolveMode) && !isBusy

          return (
            <button
              key={index}
              type="button"
              className={clsx(
                styles.market__outcome,
                isWinner && styles['market__outcome--winner'],
                resolveMode && resolveChoice === index && styles['market__outcome--selected'],
              )}
              onClick={() => {
                if (resolveMode) setResolveChoice(index)
                else if (canBet) setBetOutcome(index)
              }}
              disabled={!clickable}
            >
              <span
                className={styles.market__outcomeFill}
                style={{ width: `${share}%`, backgroundColor: outcomeColor(index, market.outcome_count) }}
                aria-hidden
              />
              <span className={styles.market__outcomeBody}>
                <span className={styles.market__outcomeName}>
                  {outcomes[index]?.emoji ? `${outcomes[index].emoji} ` : ''}
                  {outcomes[index]?.label || `Outcome #${index + 1}`}
                  {isWinner && ' 🏆'}
                </span>
                <span className={styles.market__outcomeStats}>
                  <span>
                    <small>Total</small>
                    {formatStake(pool.toString(), decimals) ?? '…'} {symbol}
                  </span>
                  {yourBet && (
                    <span>
                      <small>Your bet</small>
                      {formatStake(yourBet, decimals) ?? '…'} {symbol}
                    </span>
                  )}
                </span>
              </span>
              {totalPool > 0n && pool > 0n && (
                <span className={styles.market__chance}>
                  <strong style={{ color: outcomeColor(index, market.outcome_count) }}>{share.toFixed(share < 10 ? 1 : 0)}%</strong>
                  {multiplier !== null && ['open', 'awaiting'].includes(status.key) && (
                    <small>pays ~{multiplier.toFixed(multiplier < 10 ? 2 : 1)}×</small>
                  )}
                  {multiplier !== null && status.key === 'resolved' && isWinner && (
                    <small>paid ~{multiplier.toFixed(multiplier < 10 ? 2 : 1)}×</small>
                  )}
                </span>
              )}
              {(canBet || resolveMode) && <CaretRightIcon size={18} className={styles.market__outcomeChevron} />}
            </button>
          )
        })}
      </section>

      {/* Polymarket-style breakdown: top holders per outcome, all positions with projected
          payouts, and the live bet feed — all from the indexed read model */}
      <section className={styles.market__info}>
        <div className={styles.market__infoTabs} role="tablist" aria-label="Market breakdown">
          {[
            { key: 'holders', label: 'Top Holders' },
            { key: 'positions', label: 'Positions' },
            { key: 'activity', label: 'Activity' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={infoTab === tab.key}
              className={clsx(styles.market__infoTab, infoTab === tab.key && styles['market__infoTab--active'])}
              onClick={() => setInfoTab(tab.key)}
              data-label={tab.label}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {holders.length === 0 && <p className={styles.market__infoEmpty}>No bets yet — the breakdown appears with the first stake.</p>}

        {infoTab === 'holders' && holders.length > 0 && (
          <div className={styles.market__holdersGrid}>
            {Array.from({ length: Number(market.outcome_count) }, (_, index) => {
              const outcomeHolders = holders.filter((holder) => Number(holder.outcome) === index).slice(0, 8)
              if (outcomeHolders.length === 0) return null

              return (
                <div key={index} className={styles.market__holdersColumn}>
                  <div className={styles.market__holdersHeader}>
                    <h3>{outcomes[index]?.label || `Outcome #${index + 1}`} holders</h3>
                    <small>STAKE</small>
                  </div>
                  {outcomeHolders.map((holder) => (
                    <div key={holder.wallet_address} className={styles.market__personRow}>
                      <Profile
                        variant="fullWithoutTime"
                        creator={holder.wallet_address}
                        networkId={chainId}
                        className={styles.market__personProfile}
                      />
                      <span className={styles.market__personValue} style={{ color: outcomeColor(index, market.outcome_count) }}>
                        {formatStake(holder.amount, decimals) ?? '…'}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {infoTab === 'positions' && holders.length > 0 && (
          <div className={styles.market__positions}>
            {holders.slice(0, 30).map((holder) => {
              const outcomeIndex = Number(holder.outcome)
              const pool = Number(pools[outcomeIndex] ?? '0')
              const distributable = Number(totalPool) * (1 - Number(market.fee_bps) / 10000)
              // Projected payout if this outcome wins, at the pools as they stand now
              const toWin = pool > 0 ? (Number(holder.amount) * distributable) / pool : 0

              return (
                <div key={`${holder.wallet_address}-${holder.outcome}`} className={styles.market__personRow}>
                  <Profile
                    variant="fullWithoutTime"
                    creator={holder.wallet_address}
                    networkId={chainId}
                    className={styles.market__personProfile}
                  />
                  <span className={styles.market__personOutcome}>{outcomes[outcomeIndex]?.label || `#${outcomeIndex + 1}`}</span>
                  <span className={styles.market__personMeta}>
                    {formatStake(holder.amount, decimals) ?? '…'} {symbol}
                  </span>
                  {['open', 'awaiting'].includes(status.key) && toWin > 0 && (
                    <span className={styles.market__personValue}>
                      to win {formatStake(BigInt(Math.floor(toWin)).toString(), decimals) ?? '…'} {symbol}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {infoTab === 'activity' && recentBets.length > 0 && (
          <div className={styles.market__positions}>
            {recentBets.map((bet) => (
              <div key={bet.tx_hash + bet.amount + bet.outcome} className={styles.market__personRow}>
                <Profile
                  variant="fullWithoutTime"
                  creator={bet.wallet_address}
                  networkId={chainId}
                  className={styles.market__personProfile}
                />
                <span className={styles.market__personAction}>
                  bet <strong>{formatStake(bet.amount, decimals) ?? '…'} {symbol}</strong> on{' '}
                  <strong>{outcomes[Number(bet.outcome)]?.label || `#${Number(bet.outcome) + 1}`}</strong>
                </span>
                <span className={styles.market__personMeta}>{toRelative(bet.bet_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {betOutcome !== null && (
        <PlaceBetModal
          market={market}
          outcomeIndex={betOutcome}
          outcomeLabel={outcomes[betOutcome]?.label || `Outcome #${betOutcome + 1}`}
          onClose={() => setBetOutcome(null)}
          onPlaced={() => mutate()}
        />
      )}
    </div>
  )
}
