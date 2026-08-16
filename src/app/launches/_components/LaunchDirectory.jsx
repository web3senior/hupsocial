'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { useActiveChain } from '@/hooks/useActiveChain'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { formatNative, formatPrice, marketCapWei } from '@/lib/launch'
import CreateLaunchDialog from '@/components/CreateLaunchDialog'
import NetworkSelect from '@/components/ui/NetworkSelect'
import { CoinIcon, MagnifyingGlassIcon, RocketLaunchIcon } from '@phosphor-icons/react'
import styles from './LaunchDirectory.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const SCOPES = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'mine', label: 'Mine' },
]

/**
 * Launch Directory
 * The standalone home for token launches: browse what's live on the active chain, and launch one
 * without composing a post. The composer flow stays the primary path — a launch that arrives with
 * a post gets distribution the moment it exists — but a token still needs somewhere to live for
 * people who arrive from a link rather than the feed.
 */
const LaunchDirectory = () => {
  const createDialogRef = useRef(null)
  const { address } = useConnection()
  const { chainId } = useActiveChain()

  const [scope, setScope] = useState('trending')
  const [query, setQuery] = useState('')

  const launchAddress = CONTRACTS[`chain${chainId}`]?.launch
  const needsCreator = scope === 'mine' && !address

  const params = new URLSearchParams({ scope, networkId: String(chainId ?? ''), limit: '30' })
  if (query.trim()) params.set('q', query.trim())
  if (scope === 'mine' && address) params.set('creator', address.toLowerCase())

  const { data, isLoading } = useSWR(chainId && !needsCreator ? `/api/v1/launches?${params}` : null, fetcher, {
    refreshInterval: 30_000,
  })
  const launches = data?.data ?? []

  return (
    <div className={styles.directory}>
      <header className={styles.directory__header}>
        {/* No heading here — PageTitle already puts "Tokens" in the fixed header */}
        <p>Every token is a live Uniswap pool from block one. Liquidity locked forever, fees auto-compound.</p>
        <div className={styles.directory__actions}>
          <NetworkSelect />
          <button
            type="button"
            className={styles.directory__launch}
            onClick={() => createDialogRef.current?.open()}
            disabled={!launchAddress}
            title={launchAddress ? undefined : 'Token launches are not available on this network yet'}
          >
            <RocketLaunchIcon size={16} weight="fill" />
            Launch
          </button>
        </div>
      </header>

      <div className={styles.directory__controls}>
        <div className={styles.directory__tabs} role="tablist">
          {SCOPES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={scope === entry.key}
              className={clsx(scope === entry.key && styles['directory__tab--active'])}
              onClick={() => setScope(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className={styles.directory__search}>
          <MagnifyingGlassIcon size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search tokens"
            aria-label="Search tokens"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {!launchAddress && (
        <p className={styles.directory__empty}>Token launches aren’t live on this network yet. Switch chains above.</p>
      )}

      {launchAddress && needsCreator && (
        <p className={styles.directory__empty}>Connect your wallet to see the tokens you’ve launched.</p>
      )}

      {launchAddress && !needsCreator && !isLoading && launches.length === 0 && (
        <p className={styles.directory__empty}>
          {query.trim() ? 'No tokens match that search.' : 'Nothing here yet. Be the first to launch one.'}
        </p>
      )}

      <ul className={styles.directory__list}>
        {launches.map((launch) => {
          // Last-trade price maintained by the indexer from each Swap's own sqrtPriceX96
          const priceWei = BigInt(launch.price ?? 0)
          const imageUrl = launch.image_cid ? resolveStorageImageUrl(launch.image_cid) : null

          return (
            <li key={`${launch.network_id}-${launch.launch_id}`}>
              <Link href={`/launches/${launch.network_id}/${launch.launch_id}`} className={styles.directory__card}>
                {imageUrl ? (
                  <img src={imageUrl} alt="" className={styles.directory__image} />
                ) : (
                  <span className={styles.directory__image} aria-hidden="true">
                    <CoinIcon size={20} />
                  </span>
                )}

                <span className={styles.directory__identity}>
                  <strong>
                    {launch.name} <em>${launch.symbol}</em>
                  </strong>
                  <small>{launch.description || 'No description'}</small>
                </span>

                <span className={styles.directory__figures}>
                  <b>{formatNative(marketCapWei(priceWei))}</b>
                  <small>{formatPrice(priceWei)}</small>
                </span>

                <span className={styles.directory__meta}>
                  <small>{launch.trade_count ?? 0} trades</small>
                  <small>{formatNative(launch.volume_native)} vol</small>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <CreateLaunchDialog ref={createDialogRef} fixedChainId={chainId} showSuccessStep />
    </div>
  )
}

export default LaunchDirectory
