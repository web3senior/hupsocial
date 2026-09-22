'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useChainId, useConnection } from 'wagmi'
import { CheckCircleIcon, PenNibIcon, ReceiptIcon, WalletIcon, WarningIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import EmptyState from '@/components/ui/EmptyState'
import { appChains, CONTRACTS } from '@/config/contracts'
import { ACTION_FEES } from '@/config/actionFees'
import { useClientMounted } from '@/hooks/useClientMount'
import { chainIconFor, networkColorStyle } from '@/lib/networkColors'
import FeeTrend from './_components/FeeTrend'
import styles from './page.module.scss'

const REFRESH_MS = 30000

const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
// Sub-cent fees keep two significant digits; rounding them to $0.00 reads as missing data
const tinyUsdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 })
const coinPriceFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumSignificantDigits: 4 })
const nativeFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 })
const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const gweiFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 })
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const formatUsd = (value) => {
  if (value === null || value === undefined) return null
  if (value === 0) return usdFormatter.format(0)
  return (value < 0.01 ? tinyUsdFormatter : usdFormatter).format(value)
}

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Could not read fees')
  return json.data
}

// Joins the route's raw figures into what a row renders: the total, its parts, and who pays it
const costFor = (chain, actionId) => {
  const action = chain.actions.find((entry) => entry.id === actionId)
  if (!action?.onchain) return { onchain: false }

  const network = Number(action.network)
  const l1 = Number(action.l1)
  const protocol = Number(action.protocol)
  const native = network + l1 + protocol
  const toUsd = (amount) => (chain.price ? amount * chain.price : null)

  return {
    onchain: true,
    gas: Number(action.gas),
    native,
    usd: toUsd(native),
    parts: { network, l1, protocol },
    partsUsd: { network: toUsd(network), l1: toUsd(l1), protocol: toUsd(protocol) },
    sponsored: action.sponsored,
    freeForYou: action.sponsored && chain.tankFunded === true,
  }
}

const payerOf = (chain, cost) => {
  if (!cost.onchain) return { tone: 'free', icon: PenNibIcon, label: 'Free, just a signature' }
  if (cost.freeForYou) return { tone: 'free', icon: CheckCircleIcon, label: 'Free, the gas tank pays' }
  if (cost.sponsored) return { tone: 'you', icon: WarningIcon, label: 'You pay, the gas tank is empty' }
  return { tone: 'you', icon: WalletIcon, label: 'You pay' }
}

const chainInfoFor = (id) => appChains.find((chain) => chain.id === id)

function ChainRow({ chain, cost, max, showBar, isSelected, onSelect }) {
  const info = chainInfoFor(chain.id)
  const payer = payerOf(chain, cost)
  const PayerIcon = payer.icon
  const width = cost.onchain && max > 0 && cost.usd !== null ? Math.max((cost.usd / max) * 100, 0.75) : 0

  return (
    <li className={styles.row} style={networkColorStyle(info)}>
      <button
        type="button"
        className={clsx(styles.row__button, isSelected && styles['row__button--selected'])}
        aria-pressed={isSelected}
        onClick={() => onSelect(chain.id)}
      >
        <span className={styles.row__chain}>
          {chainIconFor(info) && <img src={chainIconFor(info)} alt="" className={styles.row__icon} />}
          <span className={styles.row__name}>{chain.name}</span>
        </span>

        <span className={styles.row__track} aria-hidden="true">
          {showBar && <span className={styles.row__bar} style={{ width: `${width}%` }} />}
        </span>

        <span className={styles.row__value}>
          {cost.onchain ? formatUsd(cost.usd) ?? `${nativeFormatter.format(cost.native)} ${chain.symbol}` : 'Free'}
        </span>

        <span className={clsx(styles.row__payer, styles[`row__payer--${payer.tone}`])}>
          <PayerIcon size={14} aria-hidden="true" />
          {payer.label}
        </span>
      </button>
    </li>
  )
}

function Breakdown({ chain, action, cost }) {
  const info = chainInfoFor(chain.id)
  const explorer = info?.blockExplorers?.default?.url?.replace(/\/$/, '')
  const hup = CONTRACTS[`chain${chain.id}`]?.hup
  const payer = payerOf(chain, cost)

  const amount = (native, usd) => (
    <span className={styles.breakdown__amount}>
      {formatUsd(usd) ?? `${nativeFormatter.format(native)} ${chain.symbol}`}
      {usd !== null && native > 0 && (
        <small>
          {nativeFormatter.format(native)} {chain.symbol}
        </small>
      )}
    </span>
  )

  if (!cost.onchain) {
    return (
      <section className={styles.breakdown} style={networkColorStyle(info)} aria-live="polite">
        <h2 className={styles.breakdown__title}>
          {action.label} on {chain.name}
        </h2>
        <p className={styles.breakdown__lead}>
          Nothing is paid, to anyone. Your wallet signs a message to prove it is you, and Hup saves the change. No transaction
          is sent, so there is no gas.
        </p>
      </section>
    )
  }

  const trendCosts = chain.trend.map((price) => Number(price) * cost.gas * 1e-18 * (chain.price ?? 1))

  return (
    <section className={styles.breakdown} style={networkColorStyle(info)} aria-live="polite">
      <h2 className={styles.breakdown__title}>
        {action.label} on {chain.name}
      </h2>
      <p className={styles.breakdown__lead}>
        {cost.freeForYou
          ? 'Hup’s gas tank pays this for you. The money below still moves, it just does not come from your wallet.'
          : 'Your wallet pays this when you confirm. Here is every place the money goes.'}
      </p>

      <ul className={styles.breakdown__list}>
        <li className={styles.breakdown__item}>
          <span className={styles.breakdown__label}>
            Network fee
            <small>Paid to the validators that run {chain.name}, for processing the transaction</small>
          </span>
          {amount(cost.parts.network, cost.partsUsd.network)}
        </li>

        {cost.parts.l1 > 0 && (
          <li className={styles.breakdown__item}>
            <span className={styles.breakdown__label}>
              Data fee
              <small>{chain.name} stores its data on Ethereum, and Ethereum charges for that space</small>
            </span>
            {amount(cost.parts.l1, cost.partsUsd.l1)}
          </li>
        )}

        <li className={styles.breakdown__item}>
          <span className={styles.breakdown__label}>
            Hup fee
            <small>
              What Hup keeps.{' '}
              {explorer && hup ? (
                <a href={`${explorer}/address/${hup}#readContract`} target="_blank" rel="noopener noreferrer">
                  Check the contract’s fee yourself ↗
                </a>
              ) : (
                'Read live from the contract.'
              )}
            </small>
          </span>
          {amount(cost.parts.protocol, cost.partsUsd.protocol)}
        </li>

        {action.storage && (
          <li className={styles.breakdown__item}>
            <span className={styles.breakdown__label}>
              Image storage
              <small>The picture is pinned to IPFS on Hup’s own account. Only its content id goes onchain</small>
            </span>
            <span className={styles.breakdown__amount}>Paid by Hup</span>
          </li>
        )}

        <li className={clsx(styles.breakdown__item, styles['breakdown__item--total'])}>
          <span className={styles.breakdown__label}>
            You pay
            <small>{cost.freeForYou ? payer.label : 'From your wallet, when you confirm'}</small>
          </span>
          <span className={styles.breakdown__amount}>{cost.freeForYou ? formatUsd(0) : amount(cost.native, cost.usd)}</span>
        </li>
      </ul>

      <dl className={styles.facts}>
        <div className={styles.facts__item}>
          <dt>Gas used</dt>
          <dd>{compactFormatter.format(cost.gas)}</dd>
        </div>
        <div className={styles.facts__item}>
          <dt>Gas price</dt>
          <dd>{gweiFormatter.format(Number(chain.gasPrice) / 1e9)} gwei</dd>
        </div>
        <div className={styles.facts__item}>
          <dt>{chain.symbol} price</dt>
          <dd>{chain.price ? coinPriceFormatter.format(chain.price) : 'No market price'}</dd>
        </div>
        {cost.usd > 0 && (
          <div className={styles.facts__item}>
            <dt>{action.plural} per $1</dt>
            <dd>≈ {compactFormatter.format(Math.floor(1 / cost.usd))}</dd>
          </div>
        )}
      </dl>

      {trendCosts.length > 1 && (
        <FeeTrend
          values={trendCosts}
          format={(value) => (chain.price ? formatUsd(value) : `${nativeFormatter.format(value)} ${chain.symbol}`)}
          label={`${action.label} cost on ${chain.name} over the last ${trendCosts.length} blocks`}
        />
      )}
    </section>
  )
}

export default function FeesPage() {
  const mounted = useClientMounted()
  const walletChainId = useChainId()
  const { isConnected } = useConnection()
  const [actionId, setActionId] = useState(ACTION_FEES[0].id)
  const [selectedChainId, setSelectedChainId] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const { data, error, isLoading } = useSWR('/api/v1/fees', fetcher, { refreshInterval: REFRESH_MS, revalidateOnFocus: true })

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  const action = ACTION_FEES.find((entry) => entry.id === actionId)

  const rows = useMemo(() => {
    if (!data) return []
    return data.chains
      .filter((chain) => !chain.testnet)
      .map((chain) => ({ chain, cost: costFor(chain, actionId) }))
      .sort((a, b) => {
        if (a.cost.onchain !== b.cost.onchain) return a.cost.onchain ? -1 : 1
        return (a.cost.usd ?? Infinity) - (b.cost.usd ?? Infinity)
      })
  }, [data, actionId])

  const groups = [
    { id: 'tank', title: 'The gas tank can pay on these networks', rows: rows.filter((row) => row.cost.onchain && row.cost.sponsored), bars: true },
    { id: 'wallet', title: 'Your wallet pays on these networks', rows: rows.filter((row) => row.cost.onchain && !row.cost.sponsored), bars: false },
    { id: 'free', title: 'Free on these networks, just a signature', rows: rows.filter((row) => !row.cost.onchain), bars: false },
  ].filter((group) => group.rows.length > 0)
  const max = Math.max(0, ...rows.filter((row) => row.cost.sponsored).map((row) => row.cost.usd ?? 0))
  const everywhereFree = rows.length > 0 && rows.every((row) => !row.cost.onchain)

  // Signed out, wagmi still reports its first configured chain (Ethereum), which is no one's choice
  const fallbackChainId = isConnected && rows.some((row) => row.chain.id === walletChainId) ? walletChainId : rows[0]?.chain.id
  const selected = rows.find((row) => row.chain.id === (selectedChainId ?? fallbackChainId))

  const secondsAgo = data ? Math.max(0, Math.round((now - data.at) / 1000)) : null

  return (
    <>
      <PageTitle name="Fees" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <header className={styles.hero}>
            <ReceiptIcon size={32} />
            <h1 className={styles.hero__title}>Where your fee goes</h1>
            <p className={styles.hero__body}>
              Some things on Hup are a signature and cost nothing. Others are a transaction on a public network, and that network
              charges a small fee. This page reads every network live and shows what each action costs, who pays it, and who
              receives it.
            </p>
            {secondsAgo !== null && (
              <p className={styles.hero__live}>
                <span className={styles.hero__dot} aria-hidden="true" />
                Live, updated {relativeFormatter.format(-secondsAgo, 'second')}
              </p>
            )}
          </header>

          <div className={styles.actions} role="tablist" aria-label="Action">
            {ACTION_FEES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === actionId}
                className={clsx(styles.actions__item, entry.id === actionId && styles['actions__item--active'])}
                onClick={() => setActionId(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {!mounted || isLoading ? (
            <div className={styles.page__loading}>
              <ContentSpinner size="32px" />
            </div>
          ) : error ? (
            <EmptyState icon={WarningIcon} size="lg" align="center">
              Couldn’t read the networks right now. {error.message}
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState size="lg" align="center">
              No network answered.
            </EmptyState>
          ) : everywhereFree ? (
            <section className={styles.breakdown}>
              <h2 className={styles.breakdown__title}>{action.label} is free on every network</h2>
              <p className={styles.breakdown__lead}>
                Your wallet signs a message to prove it is you, and Hup saves it. No transaction is sent, so no gas is paid, to
                anyone.
              </p>
            </section>
          ) : (
            <>
              {groups.map((group) => (
                <section key={group.id} className={styles.group}>
                  <h2 className={styles.group__title}>{group.title}</h2>
                  <ul className={styles.rows} aria-label={`${action.label} cost, ${group.title.toLowerCase()}`}>
                    {group.rows.map(({ chain, cost }) => (
                      <ChainRow
                        key={chain.id}
                        chain={chain}
                        cost={cost}
                        max={max}
                        showBar={group.bars}
                        isSelected={selected?.chain.id === chain.id}
                        onSelect={setSelectedChainId}
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {selected && <Breakdown chain={selected.chain} action={action} cost={selected.cost} />}
            </>
          )}

          <p className={styles.footnote}>
            Gas used is the median of real Hup transactions. Prices are the network’s current fee and the coin’s market price,
            refreshed every {REFRESH_MS / 1000} seconds. Wallets may show a higher maximum when you confirm, and refund what goes
            unused. <Link href="/gas">Top up the gas tank</Link> to keep actions free for everyone.
          </p>
        </div>
      </div>
    </>
  )
}
