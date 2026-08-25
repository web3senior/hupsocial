'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { appChains } from '@/config/contracts'
import { formatVotes, pollStatus, toRelative } from '@/lib/polls'
import { CaretRightIcon, ListChecksIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachPollDialog.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

// Open polls first — the ones still worth attaching — then upcoming, then the closed record
const STATUS_RANK = { open: 0, upcoming: 1, closed: 2 }

/**
 * Attach Poll Dialog
 * The chooser behind the composer's Poll button: open a new poll, or attach one the viewer
 * already asked on the post's chain. A poll exists onchain on its own before any post
 * mentions it (see CreatePollDialog), so a failed publish — or simply a poll worth asking
 * twice — is a pick from a list here rather than a second transaction.
 * @param {Object} props
 * @param {number|null} props.chainId Chain the post will land on; polls are listed for it.
 * @param {Function} props.onAttach Called with { pollId, chainId } for the picked poll.
 * @param {Function} props.onCreateNew Called when the viewer chooses to open a new poll.
 */
const AttachPollDialog = forwardRef(function AttachPollDialog({ chainId, onAttach, onCreateNew }, ref) {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  // Fetched only while open: the composer mounts this dialog on every render, and the list
  // is irrelevant until the button is tapped
  const [isOpen, setIsOpen] = useState(false)

  const chainName = appChains.find((chain) => chain.id === Number(chainId))?.name || 'this network'

  const { data, isLoading } = useSWR(
    isOpen && address && chainId
      ? `/api/v1/polls?scope=created&participant=${address.toLowerCase()}&networkId=${chainId}&sort=recent&limit=50`
      : null,
    fetcher
  )

  const polls = useMemo(() => {
    const rows = data?.data ?? []
    return [...rows].sort((a, b) => STATUS_RANK[pollStatus(a).key] - STATUS_RANK[pollStatus(b).key])
  }, [data])

  useImperativeHandle(ref, () => ({
    open: () => {
      setIsOpen(true)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const pick = (poll) => {
    dialogRef.current?.close()
    onAttach?.({ pollId: String(poll.poll_id), chainId: Number(poll.network_id) })
  }

  const createNew = () => {
    dialogRef.current?.close()
    onCreateNew?.()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachPoll}
      aria-label="Add a poll"
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
      <div className={styles.attachPoll__body}>
        <header className={styles.attachPoll__header}>
          <h3>Add a poll</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.attachPoll__close}>
            <XIcon size={18} />
          </button>
        </header>

        <button type="button" className={styles.attachPoll__new} onClick={createNew}>
          <span className={styles.attachPoll__newIcon}>
            <PlusIcon size={18} weight="bold" />
          </span>
          <span className={styles.attachPoll__newText}>
            <strong>Create a new poll</strong>
            <small>Ask something and open it on {chainName}</small>
          </span>
          <CaretRightIcon size={16} className={styles.attachPoll__caret} />
        </button>

        <section className={styles.attachPoll__existing}>
          <h4>Or attach one you already asked</h4>

          {!address && <p className={styles.attachPoll__empty}>Connect your wallet to see your polls.</p>}
          {address && isLoading && <p className={styles.attachPoll__empty}>Loading your polls…</p>}
          {address && !isLoading && polls.length === 0 && (
            <p className={styles.attachPoll__empty}>
              <ListChecksIcon size={20} />
              You haven&apos;t opened any polls on {chainName} yet.
            </p>
          )}

          {polls.length > 0 && (
            <ul className={styles.attachPoll__list}>
              {polls.map((poll) => {
                const status = pollStatus(poll)
                const votes = Number(poll.total_votes) || 0
                const endedAt = Number(poll.closed_at) > 0 ? poll.closed_at : poll.closes_at

                return (
                  <li key={`${poll.network_id}-${poll.poll_id}`}>
                    <button type="button" className={styles.attachPoll__item} onClick={() => pick(poll)}>
                      <span className={styles.attachPoll__question}>{poll.question || `Poll #${poll.poll_id}`}</span>
                      <span className={styles.attachPoll__meta}>
                        <span className={clsx(styles.attachPoll__badge, styles[`attachPoll__badge--${status.key}`])}>{status.label}</span>
                        <span>
                          {formatVotes(votes)} {votes === 1 ? 'vote' : 'votes'}
                        </span>
                        <span>{status.key === 'closed' ? `Closed ${toRelative(endedAt)}` : `Closes ${toRelative(poll.closes_at)}`}</span>
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

export default AttachPollDialog
