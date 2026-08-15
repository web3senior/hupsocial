'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useConnection, useSendTransaction, useSwitchChain, useChainId } from 'wagmi'
import { parseEther } from 'viem'
import clsx from 'clsx'
import { CheckIcon, CopyIcon, GasPumpIcon, WarningIcon } from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { shortTxError } from '@/lib/utils'
import styles from './page.module.scss'

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact' })
const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
// Sub-dollar amounts round to $0.00 under the standard formatter, which reads as free
const smallUsdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })

const formatUsd = (value) => (value === null || value === undefined ? null : (value < 1 ? smallUsdFormatter : usdFormatter).format(value))

// A per-post fee is often a fraction of a cent, and "$0.00" reads as missing data rather
// than as good news
const formatCost = (value) => {
  if (value === null || value === undefined) return null
  return value > 0 && value < 0.01 ? '<$0.01' : formatUsd(value)
}

// People think in dollars, not in a gas token they may never have held
const PRESETS = [5, 10, 25]

// Native amount a dollar figure buys, as a string parseEther accepts
const toNative = (usd, price) => {
  if (!price || !Number.isFinite(usd) || usd <= 0) return null

  const native = usd / price
  // 8 decimals is finer than any donation needs and never hits parseEther's 18-place limit
  return native.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

// Below this many posts of runway a chain is close enough to empty to say so
const LOW_RUNWAY = 500

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(json.error || 'Could not read relayer status')
  return json.data
}

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

function ChainRow({ chain, relayer }) {
  const { isConnected } = useConnection()
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()

  const [amount, setAmount] = useState('')
  const [isSending, setIsSending] = useState(false)

  const balance = chain.balance === null ? null : Number(chain.balance)
  const isEmpty = balance !== null && balance === 0
  const isLow = chain.postsRemaining !== null && chain.postsRemaining < LOW_RUNWAY

  // Dollars where the token has a listed price, the token itself where it does not — every
  // testnet lands in the second case, and no exchange rate exists to invent one from
  const isPriced = Boolean(chain.price)
  const unit = isPriced ? '$' : chain.symbol
  const nativeAmount = isPriced ? toNative(Number(amount), chain.price) : amount
  const postsFunded = chain.costPerPostUsd && isPriced ? Math.floor(Number(amount) / chain.costPerPostUsd) : null

  const donate = async () => {
    if (!isConnected) {
      toast('Connect your wallet first', 'error')
      return
    }

    if (!nativeAmount || Number(nativeAmount) <= 0) {
      toast('Enter an amount first', 'error')
      return
    }

    try {
      setIsSending(true)

      // The transfer has to land on the chain it is meant to fund — native currency does
      // not travel between them
      if (walletChainId !== chain.id) await switchChainAsync({ chainId: chain.id })

      await sendTransactionAsync({
        chainId: chain.id,
        to: relayer,
        value: parseEther(nativeAmount),
      })

      setAmount('')
      toast(`Thank you — ${amountFormatter.format(Number(nativeAmount))} ${chain.symbol} added to the tank`, 'success')
    } catch (err) {
      console.error('Donation failed:', err)
      toast(shortTxError(err, 'Donation failed'), 'error')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <li className={styles.chain}>
      <div className={styles.chain__header}>
        <span className={styles.chain__name}>{chain.name}</span>

        {chain.trusted === false && (
          <span className={styles.chain__badge} title="This network's contract has not been pointed at the forwarder yet">
            <WarningIcon size={12} />
            not relaying
          </span>
        )}
        {isEmpty && chain.trusted !== false && <span className={styles.chain__badge}>empty</span>}
        {isLow && !isEmpty && chain.trusted !== false && (
          <span className={clsx(styles.chain__badge, styles['chain__badge--low'])}>running low</span>
        )}
      </div>

      <div className={styles.chain__figures}>
        <div className={styles.figure}>
          <span className={styles.figure__value}>
            {balance === null ? '—' : amountFormatter.format(balance)} <small>{chain.symbol}</small>
          </span>
          <span className={styles.figure__label}>{chain.balanceUsd === null ? 'in the tank' : `${formatUsd(chain.balanceUsd)} in the tank`}</span>
        </div>

        <div className={styles.figure}>
          <span className={styles.figure__value}>
            {chain.postsRemaining === null ? '—' : `≈ ${compactFormatter.format(chain.postsRemaining)}`}
          </span>
          <span className={styles.figure__label}>
            posts covered{chain.costPerPostUsd ? ` · ${formatCost(chain.costPerPostUsd)} each` : ''}
          </span>
        </div>
      </div>

      <div className={styles.chain__donate}>
        {/* Dollar presets need a price to convert; a testnet token has none, so that row
            asks for its own units instead of offering amounts it cannot honor */}
        {isPriced && (
          <div className={styles.presets}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(styles.presets__item, amount === String(preset) && styles['presets__item--active'])}
                onClick={() => setAmount(String(preset))}
                disabled={isSending}
              >
                ${preset}
              </button>
            ))}
          </div>
        )}

        <label className={styles.chain__amount}>
          <span className="sr-only">{isPriced ? 'Amount in US dollars' : `Amount in ${chain.symbol}`}</span>
          {isPriced && <span className={styles.chain__symbol}>{unit}</span>}
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder={isPriced ? 'Custom' : '0.0'}
            value={amount}
            disabled={isSending}
            onChange={(event) => setAmount(event.target.value)}
          />
          {!isPriced && <span className={styles.chain__symbol}>{chain.symbol}</span>}
        </label>

        <button type="button" className={styles.chain__send} onClick={donate} disabled={isSending}>
          {isSending ? 'Sending…' : 'Fuel up'}
        </button>
      </div>

      {isPriced && nativeAmount && (
        <p className={styles.chain__conversion}>
          ≈ {amountFormatter.format(Number(nativeAmount))} {chain.symbol}
          {postsFunded > 0 && ` — covers about ${compactFormatter.format(postsFunded)} posts`}
        </p>
      )}
    </li>
  )
}

export default function GasPage() {
  const mounted = useClientMounted()
  const [copied, setCopied] = useState(false)

  const { data, error, isLoading } = useSWR('/api/v1/relay/status', fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  })

  const copyRelayer = () => {
    navigator.clipboard
      .writeText(data.relayer)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast('Copy failed', 'error'))
  }

  return (
    <>
      <PageTitle name="Gas tank" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <header className={styles.hero}>
            <GasPumpIcon size={32} />
            <h1 className={styles.hero__title}>The gas tank</h1>
            <p className={styles.hero__body}>
              Posting on Hup is free — a relayer submits your post and pays the fee. This is what it has left, per
              network. Anyone can top it up, and everything sent here goes to covering other people&apos;s posts.
            </p>

            {data?.totalUsd > 0 && (
              <p className={styles.hero__total}>
                <strong>{formatUsd(data.totalUsd)}</strong> in the tank right now
              </p>
            )}
          </header>

          {!mounted || isLoading ? (
            <div className={styles.page__loading}>
              <ContentSpinner size="32px" />
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <WarningIcon size={40} />
              <h3>Couldn&apos;t read the tank</h3>
              <p>{error.message}</p>
            </div>
          ) : (
            <>
              <button type="button" className={styles.relayer} onClick={copyRelayer}>
                <span className={styles.relayer__label}>Relayer</span>
                <span className={styles.relayer__address}>{shortAddress(data.relayer)}</span>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>

              <ul className={styles.chains}>
                {data.chains.map((chain) => (
                  <ChainRow key={chain.id} chain={chain} relayer={data.relayer} />
                ))}
              </ul>

              <p className={styles.footnote}>
                Donations are voluntary and non-refundable. The relayer is a hot wallet that does one thing — pay gas
                for posts — and the post counts above are estimates at the current gas price.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
