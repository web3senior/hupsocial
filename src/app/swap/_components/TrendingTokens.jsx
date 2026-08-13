'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { SWAP_TOKENS } from '@/lib/tokens'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { formatNative } from '@/lib/launch'
import { CoinIcon, FlameIcon } from '@phosphor-icons/react'
import styles from './TrendingTokens.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '')

/**
 * Trending Tokens
 * What's actually moving on Hup, per chain, from two in-house signals merged: tokens people
 * swapped through this page recently (swap_activity, ranked by distinct traders so one wallet
 * can't trend a token alone) and tokens launched on Hup (cidex-indexed launch pools). No
 * external market APIs — this is Hup's own activity. Tapping a row loads it as the receive
 * side of the form, quote ready.
 */
const TrendingTokens = ({ chainId, nativeSymbol, onSelect }) => {
  const { data: swapped } = useSWR(chainId ? `/api/v1/swaps/trending?networkId=${chainId}&days=7&limit=8` : null, fetcher, {
    refreshInterval: 60_000,
  })
  const { data: launches } = useSWR(
    chainId ? `/api/v1/launches?scope=trending&networkId=${chainId}&limit=8` : null,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const rows = useMemo(() => {
    const launchByToken = new Map(
      (launches?.data ?? []).filter((entry) => entry.token).map((entry) => [entry.token.toLowerCase(), entry]),
    )
    const curatedSymbols = new Map((SWAP_TOKENS[chainId] ?? []).map((token) => [token.address.toLowerCase(), token.symbol]))

    // Swap-page activity leads — it is the page's own demand signal — then launches that
    // nobody has swapped here yet trail in the launch API's trending order
    const merged = (swapped?.data ?? []).map((entry) => {
      const launch = launchByToken.get(entry.token)
      launchByToken.delete(entry.token)
      return {
        address: entry.token,
        symbol: entry.symbol || curatedSymbols.get(entry.token) || shortAddress(entry.token),
        logo: launch?.image_cid ? resolveStorageImageUrl(launch.image_cid) : null,
        isLaunch: Boolean(launch),
        stat: `${entry.swap_count} swap${Number(entry.swap_count) === 1 ? '' : 's'} · ${entry.trader_count} trader${
          Number(entry.trader_count) === 1 ? '' : 's'
        }`,
        volume: BigInt(entry.volume_native ?? 0),
      }
    })

    for (const launch of launchByToken.values()) {
      merged.push({
        address: launch.token,
        symbol: launch.symbol,
        logo: launch.image_cid ? resolveStorageImageUrl(launch.image_cid) : null,
        isLaunch: true,
        stat: `${launch.trade_count ?? 0} trades`,
        volume: BigInt(launch.volume_native ?? 0),
      })
    }

    return merged.slice(0, 8)
  }, [swapped, launches, chainId])

  if (rows.length === 0) return null

  return (
    <section className={styles.trending}>
      <h2 className={styles.trending__title}>
        <FlameIcon size={15} weight="fill" />
        Trending on Hup
      </h2>
      <ul className={styles.trending__list}>
        {rows.map((token) => (
          <li key={token.address}>
            <button type="button" className={styles.trending__row} onClick={() => onSelect?.(token)}>
              {token.logo ? (
                <img src={token.logo} alt="" className={styles.trending__logo} />
              ) : (
                <span className={styles.trending__logo} aria-hidden="true">
                  <CoinIcon size={16} />
                </span>
              )}
              <span className={styles.trending__identity}>
                <strong>
                  {token.symbol}
                  {token.isLaunch && <em className={styles.trending__badge}>Launch</em>}
                </strong>
                <small>{token.stat}</small>
              </span>
              {token.volume > 0n && (
                <span className={styles.trending__volume}>
                  {formatNative(token.volume)} {nativeSymbol}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TrendingTokens
