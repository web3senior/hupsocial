'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatUnits } from 'viem'
import { useConnection } from 'wagmi'
import { ArrowSquareOutIcon, CheckIcon, CopyIcon, CoinIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { addressExplorerUrl } from '@/lib/explorer'
import { networkColorStyle } from '@/lib/networkColors'
import { SOCIAL_URLS, isTokenPageEmpty } from '@/lib/tokenPage'
import TokenManageDialog from '@/components/TokenManageDialog'
import TokenPageBody from '@/components/TokenPageBody'
import { sameAddress, shortAddress } from '@/lib/address'
import { percentLabel, priceLabel } from '@/lib/cashtagFormat'
import PriceSparkline from '@/components/ui/PriceSparkline'
import TokenIcon from '@/components/ui/TokenIcon'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/NextToast'
import styles from './TokenOverview.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// The windows the history endpoint can answer. Kept short of the cashtag card's full set: this
// page is a first look at a contract, not a research tool, and every extra button is a request.
const RANGES = ['1D', '1W', '1M', '1Y']

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

/**
 * Token Overview
 * The page for a contract Hup did not launch: what the token says it is onchain, what the public
 * market feeds know about it, and a way to trade it.
 *
 * Everything below identity is optional and absent rather than zeroed — a token an hour old, or
 * one on a chain no aggregator indexes, has a name and a supply and nothing else, and that is
 * still a page worth serving. What it deliberately never does is imply endorsement: the contract
 * address is the headline identity, because a ticker alone is the one thing a lookalike can copy.
 *
 * @param {Object} props
 * @param {number} props.networkId
 * @param {string} props.address The token contract, lowercased — this page's whole identity.
 * @param {Object} [props.initialToken] The server's read, so the page renders before any fetch.
 */
const TokenOverview = ({ networkId, address, initialToken = null }) => {
  const [range, setRange] = useState('1D')
  const [copied, setCopied] = useState(false)
  const [managing, setManaging] = useState(false)
  const { address: walletAddress } = useConnection()

  const { data, mutate } = useSWR(`/api/v1/tokens/${networkId}/${address}?range=${range}`, fetcher, {
    fallbackData: range === '1D' && initialToken ? { success: true, data: initialToken } : undefined,
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    // Only the series changes with the range; without this the whole page empties and re-enters
    // on every range click, which reads as a navigation rather than a redraw
    keepPreviousData: true,
  })

  const token = data?.data ?? initialToken
  const page = token?.page ?? null

  // Whether the connected wallet may write this page is the contract's answer, not ours. It
  // arrives with the token because several chains' public RPCs refuse cross-origin calls, so
  // reading owner() from the browser fails outright on them; the server checks it again against a
  // signature before storing anything, so a wrong answer here shows a button that fails rather
  // than an edit that lands.
  const canEdit = Boolean(
    walletAddress && token?.page_authority?.address && sameAddress(walletAddress, token.page_authority.address),
  )
  const chain = useMemo(() => appChains.find((entry) => entry.id === networkId), [networkId])
  const explorerUrl = addressExplorerUrl(networkId, address, chain?.blockExplorers?.default?.url ?? null)

  const symbol = token?.symbol || null
  const name = token?.name || symbol || 'Unknown token'
  const change = typeof token?.change_24h === 'number' ? token.change_24h : null
  const isUp = change === null ? true : change >= 0
  const history = token?.history ?? null

  const supply =
    token?.total_supply && token?.decimals !== null && token?.decimals !== undefined
      ? compactNumber.format(Number(formatUnits(BigInt(token.total_supply), token.decimals)))
      : null

  // Zeros hide alongside nulls: the aggregators report 0 where they simply don't track a figure,
  // and a "$0" tile is misinformation rather than information
  const stats = []
  if (token) {
    if (token.market_cap_usd) stats.push({ label: 'Market cap', value: compactUsd.format(token.market_cap_usd) })
    else if (token.fdv_usd) stats.push({ label: 'FDV', value: compactUsd.format(token.fdv_usd) })
    if (token.volume_24h_usd) stats.push({ label: '24h volume', value: compactUsd.format(token.volume_24h_usd) })
    if (token.liquidity_usd) stats.push({ label: 'Liquidity', value: compactUsd.format(token.liquidity_usd) })
    if (supply) stats.push({ label: 'Total supply', value: supply })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy the address', 'error')
    }
  }

  if (data && !data.success && !token) {
    return (
      <EmptyState icon={CoinIcon} align="center" size="lg">
        Nothing answered at {shortAddress(address)} on {chain?.name ?? `network ${networkId}`}. Check the address and
        the chain — a token only exists on the one it was deployed to.
      </EmptyState>
    )
  }

  return (
    <article className={styles.token} style={networkColorStyle(chain)}>
      <header className={styles.token__header}>
        {/* No chain badge: the chain is named in the meta row a line below, and a mark repeating
            it costs the header its only piece of artwork */}
        <TokenIcon token={{ logo: token?.logo, address }} chainId={networkId} size="lg" />

        <div className={styles.token__identity}>
          <h1>
            {name}
            {symbol && <span className={styles.token__symbol}>${symbol}</span>}
          </h1>

          <div className={styles.token__meta}>
            <button type="button" className={styles.token__address} onClick={handleCopy} title={address}>
              {shortAddress(address)}
              {copied ? <CheckIcon size={13} weight="bold" /> : <CopyIcon size={13} />}
            </button>

            <span className={styles.token__rule} aria-hidden="true" />

            <span className={styles.token__chain}>{chain?.name ?? `Network ${networkId}`}</span>

            {explorerUrl && (
              <>
                <span className={styles.token__rule} aria-hidden="true" />

                <a className={styles.token__explorer} href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  Explorer
                  <ArrowSquareOutIcon size={13} />
                </a>
              </>
            )}
          </div>

          {/* Said plainly rather than implied by an absence of panels: a reader arriving from a
              cashtag has no way to know which of the two kinds of page they are on */}
          {page?.tagline && <p className={styles.token__tagline}>{page.tagline}</p>}

          <p className={styles.token__origin}>
            Not launched on Hup — this page reads the contract and public market data.
          </p>
        </div>

        <div className={styles.token__actions}>
          <Link className={styles.token__trade} href={`/swap?chain=${networkId}&token=${address}`}>
            Trade
          </Link>

          {/* Only the address the contract names as its owner sees this; the server checks the
              same thing against a signature before it stores anything */}
          {canEdit && (
            <button
              type="button"
              className={styles.token__edit}
              onClick={() => setManaging(true)}
              title={isTokenPageEmpty(page) ? 'Set up this page' : 'Edit this page'}
            >
              <PencilSimpleIcon size={14} aria-hidden="true" />
              <span className="sr-only">{isTokenPageEmpty(page) ? 'Set up this page' : 'Edit this page'}</span>
            </button>
          )}
        </div>
      </header>

      {token?.price_usd ? (
        <section className={styles.token__market}>
          <div className={styles.token__price}>
            <strong>{priceLabel(token.price_usd)}</strong>
            {change !== null && (
              <em className={clsx(styles.token__change, styles[`token__change--${isUp ? 'up' : 'down'}`])}>
                {isUp ? '↑' : '↓'} {percentLabel(change)}
                <span>24h</span>
              </em>
            )}
          </div>

          {history?.points?.length > 1 && (
            <>
              <PriceSparkline
                points={history.points}
                direction={isUp ? 'up' : 'down'}
                height={140}
                baseline
                className={styles.token__chart}
                label={`${symbol || 'Token'} price over the past ${range}`}
                title={`${symbol || 'Token'} · past ${range}`}
              />

              <div className={styles.token__ranges}>
                {RANGES.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={clsx(range === option && styles['token__range--active'])}
                    onClick={() => setRange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        token && (
          <EmptyState icon={CoinIcon} size="sm" className={styles.token__noMarket}>
            No market data yet — no public feed has priced this token. Its identity and supply above are read straight
            from the contract.
          </EmptyState>
        )
      )}

      <TokenPageBody page={page} name={name} />

      {stats.length > 0 && (
        <dl className={styles.token__stats}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && managing && (
        <TokenManageDialog
          networkId={networkId}
          tokenAddress={address}
          symbol={symbol}
          page={page}
          onClose={() => setManaging(false)}
          onSaved={(saved) => {
            // Fold the response into the cached row so the page repaints without a refetch
            mutate((current) => (current?.data ? { ...current, data: { ...current.data, page: saved } } : current), {
              revalidate: false,
            })
          }}
        />
      )}
    </article>
  )
}

export default TokenOverview
