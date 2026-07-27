'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { ChartLineUpIcon, PlusIcon } from '@phosphor-icons/react'
import { marketStatus } from '@/lib/predict'
import CreateMarketDialog from './CreateMarketDialog'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachMarketModal.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Attach Market Modal
 * Lets the post composer attach a prediction market on the post's chain: either one of the
 * author's still-open markets (from the indexed API), or a brand-new one created inline via
 * CreateMarketDialog — the market id is read from the creation receipt so the attachment
 * never waits on the indexer.
 * @param {Object} props
 * @param {number} props.chainId The chain the post lands on — markets must live there too.
 * @param {Function} props.onAttached Receives the { marketId, chainId } content reference.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const AttachMarketModal = ({ chainId, onAttached, onClose }) => {
  const dialogRef = useRef(null)
  const createDialogRef = useRef(null)
  const { address } = useConnection()

  // Mount = open / unmount = close, matching the TipModal dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const { data: mine } = useSWR(
    address ? `/api/v1/predict?scope=mine&participant=${address.toLowerCase()}&networkId=${chainId}&limit=10` : null,
    fetcher,
  )

  // Only still-bettable markets are worth pinning to a fresh post
  const openMarkets = (mine?.data ?? []).filter((market) => marketStatus(market).key === 'open')

  const handleCreated = (marketRef) => {
    // Receipt parsing can fail on exotic RPCs — the market exists onchain either way, the
    // picker just stays open so the author can attach it manually once indexed
    if (marketRef?.marketId) onAttached({ marketId: marketRef.marketId, chainId })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachMarket}
      aria-label="Attach a prediction market"
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.attachMarket__header}>
        <button type="button" className={styles.attachMarket__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Attach a market</h3>
      </header>

      <main className={styles.attachMarket__body}>
        <button
          type="button"
          className={styles.attachMarket__create}
          // The create dialog stacks on top of this one in the browser's top layer; the
          // picker stays open underneath so canceling creation falls back to it
          onClick={() => createDialogRef.current?.open()}
        >
          <PlusIcon size={16} />
          New market on this chain
        </button>

        {openMarkets.length > 0 && (
          <>
            <p className={styles.attachMarket__sectionTitle}>Or pin one of your open markets</p>
            <ul className={styles.attachMarket__list}>
              {openMarkets.map((market) => (
                <li key={`${market.network_id}-${market.market_id}`}>
                  <button type="button" onClick={() => onAttached({ marketId: String(market.market_id), chainId })}>
                    <ChartLineUpIcon size={16} />
                    <span>{market.title || `Market #${market.market_id}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <CreateMarketDialog ref={createDialogRef} fixedChainId={chainId} onCreated={handleCreated} />
    </NativeDialog>
  )
}

export default AttachMarketModal
