'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import { formatBackers, formatCompactAmount, formatPercent, fundProgress, fundStatus, isFunded, toRelative } from '@/lib/fund'
import { CaretRightIcon, BagIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachFundDialog.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// Open campaigns first — the ones still worth attaching — then the closed record
const STATUS_RANK = { open: 0, closed: 1, withdrawn: 2, refunding: 3 }

/**
 * Attach Fund Dialog
 * The chooser behind the composer's Fundraise button: open a new campaign, or attach one the
 * viewer already started on the post's chain. A campaign exists onchain on its own before any
 * post mentions it (see CreateFundDialog), so a failed publish — or simply a campaign worth
 * posting about twice — is a pick from a list here rather than a second transaction.
 * @param {Object} props
 * @param {number|null} props.chainId Chain the post will land on; campaigns are listed for it.
 * @param {Function} props.onAttach Called with { campaignId, chainId } for the picked campaign.
 * @param {Function} props.onCreateNew Called when the viewer chooses to start a new campaign.
 */
const AttachFundDialog = forwardRef(function AttachFundDialog({ chainId, onAttach, onCreateNew }, ref) {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  // Fetched only while open: the composer mounts this dialog on every render, and the list is
  // irrelevant until the button is tapped
  const [isOpen, setIsOpen] = useState(false)

  const chain = appChains.find((entry) => entry.id === Number(chainId))
  const chainName = chain?.name || 'this network'
  const symbol = chain?.nativeCurrency?.symbol ?? 'ETH'

  const { data, isLoading } = useSWR(
    isOpen && address && chainId
      ? `/api/v1/fund?scope=created&participant=${address.toLowerCase()}&networkId=${chainId}&sort=recent&limit=50`
      : null,
    fetcher,
  )

  const campaigns = useMemo(() => {
    const rows = data?.data ?? []
    return [...rows].sort((a, b) => STATUS_RANK[fundStatus(a).key] - STATUS_RANK[fundStatus(b).key])
  }, [data])

  useImperativeHandle(ref, () => ({
    open: () => {
      setIsOpen(true)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const pick = (campaign) => {
    dialogRef.current?.close()
    onAttach?.({ campaignId: String(campaign.campaign_id), chainId: Number(campaign.network_id) })
  }

  const createNew = () => {
    dialogRef.current?.close()
    onCreateNew?.()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachFund}
      aria-label="Add a fundraise"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      // Nested inside the composer's own dialog — React re-dispatches close/cancel up the
      // component tree, so both must stop here or closing this also closes the composer
      onClose={(e) => {
        e.stopPropagation()
        setIsOpen(false)
      }}
      onCancel={(e) => e.stopPropagation()}
    >
      <div className={styles.attachFund__body}>
        <header className={styles.attachFund__header}>
          <h3>Add a fundraise</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.attachFund__close}>
            <XIcon size={18} />
          </button>
        </header>

        <button type="button" className={styles.attachFund__new} onClick={createNew}>
          <span className={styles.attachFund__newIcon}>
            <PlusIcon size={18} weight="bold" />
          </span>
          <span className={styles.attachFund__newText}>
            <strong>Start a new fundraise</strong>
            <small>Set a goal and open it on {chainName}</small>
          </span>
          <CaretRightIcon size={16} className={styles.attachFund__caret} />
        </button>

        <section className={styles.attachFund__existing}>
          <h4>Or attach one you already started</h4>

          {!address && <p className={styles.attachFund__empty}>Connect your wallet to see your campaigns.</p>}
          {address && isLoading && <p className={styles.attachFund__empty}>Loading your campaigns…</p>}
          {address && !isLoading && campaigns.length === 0 && (
            <p className={styles.attachFund__empty}>
              <BagIcon size={20} />
              You haven&apos;t started any campaigns on {chainName} yet.
            </p>
          )}

          {campaigns.length > 0 && (
            <ul className={styles.attachFund__list}>
              {campaigns.map((campaign) => {
                const status = fundStatus(campaign)
                const backers = Number(campaign.backer_count) || 0
                const endedAt = Number(campaign.closed_at) > 0 ? campaign.closed_at : campaign.closes_at

                return (
                  <li key={`${campaign.network_id}-${campaign.campaign_id}`}>
                    <button type="button" className={styles.attachFund__item} onClick={() => pick(campaign)}>
                      <span className={styles.attachFund__campaignTitle}>{campaign.title || `Campaign #${campaign.campaign_id}`}</span>
                      <span className={styles.attachFund__meta}>
                        <span className={clsx(styles.attachFund__badge, styles[`attachFund__badge--${status.key === 'open' || status.key === 'closed' ? (isFunded(campaign) ? 'funded' : status.key) : status.key}`])}>
                          {status.key === 'open' || status.key === 'closed' ? (isFunded(campaign) ? 'Funded' : status.label) : status.label}
                        </span>
                        <span>
                          {formatCompactAmount(campaign.raised, symbol)} · {formatPercent(fundProgress(campaign))}
                        </span>
                        <span>
                          {formatBackers(backers)} {backers === 1 ? 'backer' : 'backers'}
                        </span>
                        <span>{status.key === 'closed' ? `Ended ${toRelative(endedAt)}` : `Ends ${toRelative(campaign.closes_at)}`}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </NativeDialog>
  )
})

export default AttachFundDialog
