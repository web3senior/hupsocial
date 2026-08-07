'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useConnection } from 'wagmi'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { normalizeAddress } from '@/lib/walletAssets'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { formatTokenDisplay } from '@/app/communities/tokenUnits'
import { useWalletAssets } from '@/hooks/useWalletAssets'
import { useTokenMarket } from '@/hooks/useTokenMarket'
import useTokenIcon from '@/hooks/useTokenIcon'
import { CaretDownIcon } from '@phosphor-icons/react'
import NativePopover from '../ui/NativePopover'
import AddTokenDialog from '../AddTokenDialog'
import SendTokenModal from '../SendTokenModal'
import NftGallery from './NftGallery'
import NoData from '../NoData'
import styles from './AssetsTab.module.scss'

// wagmi's config module stamps iconUrl onto the shared chain objects as a side effect, so
// derive it here too rather than depending on that module having been evaluated first
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 2,
})

// Rounding a real holding to $0.00 reads as worthless, which is a different claim from "tiny"
const formatUsd = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value > 0 && value < 0.01) return '<$0.01'
  return usdFormatter.format(value)
}

// DefiLlama reports 24h movement as a signed percentage (-0.37 meaning -0.37%), while
// Intl's percent style expects a ratio
const formatChange = (percent) =>
  typeof percent === 'number' && Number.isFinite(percent) ? percentFormatter.format(percent / 100) : null

const usdValueOf = (asset, price) => {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  try {
    return Number(BigInt(asset.balance)) / 10 ** asset.decimals * price
  } catch {
    return null
  }
}

/**
 * One holding. Its own component because the LSP4 icon lookup is a hook, and because a token
 * with no listing anywhere still has to render something recognisable.
 */
function AssetRow({ asset, chain, market, isOwner, onSend, onUnpin }) {
  const chainIcon = chainIconFor(chain)
  const indexIcon = asset.icon ? resolveStorageImageUrl(asset.icon, { width: 64 }) : null

  // Only reached for an LSP7 that neither the index nor GeckoTerminal could brand
  const lsp4Icon = useTokenIcon({
    chainId: asset.chainId,
    token: asset.address,
    enabled: Boolean(asset.isLsp7 && asset.address && !indexIcon && !market?.logo),
  })

  // The native coin's icon is the network's — for everything else the chain rides as a badge
  const tokenIcon = asset.isNative ? chainIcon : indexIcon || market?.logo || lsp4Icon
  const amount = formatTokenDisplay(asset.balance, asset.decimals)
  const usd = formatUsd(usdValueOf(asset, market?.usd))
  const change = formatChange(market?.change24h)
  const isDown = typeof market?.change24h === 'number' && market.change24h < 0

  return (
    <li className={styles.assets__row}>
      <span className={styles.assets__icon}>
        {tokenIcon ? (
          <img className={styles.assets__image} src={tokenIcon} alt="" loading="lazy" />
        ) : (
          <span className={styles.assets__monogram} aria-hidden="true">
            {asset.symbol.slice(0, 1)}
          </span>
        )}
        {!asset.isNative && chainIcon && (
          <img className={styles.assets__badge} src={chainIcon} alt="" title={chain?.name} loading="lazy" />
        )}
      </span>

      <div className={styles.assets__labels}>
        <span className={styles.assets__symbol}>{asset.symbol}</span>
        {/* The network always shows: the same symbol legitimately exists on several chains at
            once (ETH on mainnet, Base and Arbitrum), and those rows are otherwise identical */}
        <span className={styles.assets__meta}>
          <span className={styles.assets__network}>{chain?.name ?? `Chain ${asset.chainId}`}</span>
          {change && (
            <>
              <span aria-hidden="true">·</span>
              <span className={clsx(styles.assets__change, isDown && styles['assets__change--down'])}>{change}</span>
            </>
          )}
        </span>
      </div>

      <div className={styles.assets__amount}>
        {usd && <span className={styles.assets__value}>{usd}</span>}
        <span className={clsx(styles.assets__qty, !usd && styles['assets__qty--lead'])}>
          {amount ?? '—'} {asset.symbol}
        </span>
      </div>

      <div className={styles.assets__controls}>
        {asset.pinned && (
          <button
            type="button"
            className={styles.assets__unpin}
            onClick={() => onUnpin(asset.chainId, asset.address)}
            aria-label={`Stop tracking ${asset.symbol}`}
            title={`Stop tracking ${asset.symbol}`}
          >
            ×
          </button>
        )}
        {isOwner && (
          <button type="button" className={styles.assets__send} onClick={() => onSend(asset)} disabled={BigInt(asset.balance) === 0n}>
            Send
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * The network filter's own trigger and menu. Offers only chains this wallet actually holds
 * something on — a list of every supported network would mostly be options that filter to
 * nothing — each with what it is worth, so the choice is informative before it is made.
 */
function NetworkFilter({ options, value, total, onChange }) {
  const selected = options.find((option) => option.chainId === value)
  const selectedIcon = chainIconFor(selected?.chain)

  return (
    <NativePopover
      placement="bottom-start"
      className={styles.assets__networkPanel}
      trigger={
        <button type="button" className={styles.assets__networkFilter}>
          {selectedIcon && <img src={selectedIcon} alt="" />}
          {selected ? selected.chain?.name ?? `Chain ${selected.chainId}` : 'All networks'}
          <CaretDownIcon size={13} />
        </button>
      }
    >
      {({ close }) => (
        <ul className={styles.assets__networkList}>
          <li>
            <button
              type="button"
              data-selected={value === null ? 'true' : undefined}
              onClick={() => {
                onChange(null)
                close()
              }}
            >
              <span className={styles.assets__networkName}>All networks</span>
              {formatUsd(total) && <span className={styles.assets__networkValue}>{formatUsd(total)}</span>}
            </button>
          </li>
          {options.map((option) => {
            const icon = chainIconFor(option.chain)
            return (
              <li key={option.chainId}>
                <button
                  type="button"
                  data-selected={option.chainId === value ? 'true' : undefined}
                  onClick={() => {
                    onChange(option.chainId)
                    close()
                  }}
                >
                  {icon ? <img src={icon} alt="" /> : <span className={styles.assets__networkDot} aria-hidden="true" />}
                  <span className={styles.assets__networkName}>{option.chain?.name ?? `Chain ${option.chainId}`}</span>
                  {formatUsd(option.usd) && <span className={styles.assets__networkValue}>{formatUsd(option.usd)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </NativePopover>
  )
}

/**
 * AssetsTab
 * Fungible token holdings for the wallet whose profile is open, across every supported chain.
 * The owner gets a Send action per row; everyone else sees the same list read-only.
 */
export default function AssetsTab() {
  const params = useParams()
  const walletAddress = params?.wallet || ''
  const { address, isConnected } = useConnection()

  const { assets, isLoading, isError, refresh, pinToken, unpinToken } = useWalletAssets(walletAddress)
  const { market } = useTokenMarket(assets)

  const [sendAsset, setSendAsset] = useState(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [networkFilter, setNetworkFilter] = useState(null)

  const chainsById = useMemo(() => new Map(appChains.map((chain) => [chain.id, chain])), [])

  // Only the holder can move these tokens — every other viewer gets the read-only list
  const isOwner = isConnected && normalizeAddress(address) !== null && normalizeAddress(address) === normalizeAddress(walletAddress)

  // Most valuable first once prices land, the way a wallet lists them; rows without a known
  // price keep their chain order underneath
  const ordered = useMemo(() => {
    const valued = assets.map((asset, index) => ({ asset, index, usd: usdValueOf(asset, market[asset.id]?.usd) }))
    valued.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || a.index - b.index)
    return valued.map((entry) => entry.asset)
  }, [assets, market])

  // Built from the unfiltered holdings so choosing a network never changes what the menu offers
  const networkOptions = useMemo(() => {
    const byChain = new Map()
    for (const asset of assets) {
      const usd = usdValueOf(asset, market[asset.id]?.usd) ?? 0
      byChain.set(asset.chainId, (byChain.get(asset.chainId) ?? 0) + usd)
    }
    return [...byChain.entries()]
      .sort(([chainA, usdA], [chainB, usdB]) => usdB - usdA || chainA - chainB)
      .map(([chainId, usd]) => ({ chainId, usd, chain: chainsById.get(chainId) }))
  }, [assets, market, chainsById])

  // Spending the last of a chain's holdings would otherwise strand the tab on a filter that can
  // never match again. Adjusted during render rather than in an effect so no frame shows the
  // dead filter; the load guard keeps a mid-refresh blank from clearing a deliberate choice.
  if (networkFilter && !isLoading && assets.length > 0 && !assets.some((asset) => asset.chainId === networkFilter)) {
    setNetworkFilter(null)
  }

  const visible = useMemo(
    () => (networkFilter ? ordered.filter((asset) => asset.chainId === networkFilter) : ordered),
    [ordered, networkFilter]
  )

  // The total follows the filter — a figure that outlived the list it describes is worse than none
  const total = useMemo(
    () => visible.reduce((sum, asset) => sum + (usdValueOf(asset, market[asset.id]?.usd) ?? 0), 0),
    [visible, market]
  )
  const grandTotal = useMemo(
    () => assets.reduce((sum, asset) => sum + (usdValueOf(asset, market[asset.id]?.usd) ?? 0), 0),
    [assets, market]
  )

  const filteredChain = networkFilter ? chainsById.get(networkFilter) : null

  // One render path rather than early returns: the NFT gallery is independent of the token
  // read, so a wallet holding only NFTs must not be short-circuited by an empty or
  // still-loading balance list
  return (
    <div className={styles.assets}>
      <div className={styles.assets__toolbar}>
        {total > 0 && (
          <div className={styles.assets__total}>
            <span className={styles.assets__totalLabel}>{filteredChain ? filteredChain.name : 'Total'}</span>
            {/* formatUsd, not the raw formatter — a dust portfolio reading "$0.00" claims the
                holdings are worthless rather than small */}
            <span className={styles.assets__totalValue}>{formatUsd(total)}</span>
          </div>
        )}
        <div className={styles.assets__actions}>
          {networkOptions.length > 1 && (
            <NetworkFilter options={networkOptions} value={networkFilter} total={grandTotal} onChange={setNetworkFilter} />
          )}
          <button type="button" className={styles.assets__action} onClick={() => setIsAddOpen(true)}>
            Add token
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-column gap-1">
          <div className={clsx('shimmer', styles.assets__shimmer)} />
          <div className={clsx('shimmer', styles.assets__shimmer)} />
          <div className={clsx('shimmer', styles.assets__shimmer)} />
        </div>
      )}

      {!isLoading && isError && (
        <p className={styles.assets__error}>Could not load balances. Check your connection and try again.</p>
      )}

      {!isLoading && !isError && assets.length === 0 && (
        <>
          <NoData name="tokens" />
          <p className={styles.assets__hint}>
            Outside LUKSO only well-known tokens are found automatically. Add a token address to track anything else.
          </p>
        </>
      )}

      {/* A filter that matches nothing is a dead end unless it says how to get out of it */}
      {!isLoading && !isError && assets.length > 0 && visible.length === 0 && filteredChain && (
        <p className={styles.assets__hint}>
          Nothing held on {filteredChain.name}.{' '}
          <button type="button" className={styles.assets__reset} onClick={() => setNetworkFilter(null)}>
            Show all networks
          </button>
        </p>
      )}

      {visible.length > 0 && (
        <ul className={styles.assets__list}>
          {visible.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              chain={chainsById.get(asset.chainId)}
              market={market[asset.id]}
              isOwner={isOwner}
              onSend={setSendAsset}
              onUnpin={unpinToken}
            />
          ))}
        </ul>
      )}

      <NftGallery owner={normalizeAddress(walletAddress)} isOwner={isOwner} chainId={networkFilter} />

      {sendAsset && (
        <SendTokenModal
          asset={sendAsset}
          owner={normalizeAddress(walletAddress)}
          onSent={refresh}
          onClose={() => setSendAsset(null)}
        />
      )}
      {isAddOpen && <AddTokenDialog onPin={pinToken} onClose={() => setIsAddOpen(false)} />}
    </div>
  )
}
