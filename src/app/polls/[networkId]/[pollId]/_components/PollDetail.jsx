'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { useConnection, usePublicClient, useWriteContract } from 'wagmi'
import { CONTRACTS, appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { formatVotes, pollOptions, pollStatus, toRelative } from '@/lib/polls'
import { shortTxError, handleBrokenAvatar, FALLBACK_AVATAR_SRC } from '@/lib/utils'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import pollsAbi from '@/abis/HupPolls.json'
import { toast } from '@/components/NextToast'
import PollCard from '@/components/PollCard'
import PollTimer from '@/components/PollTimer'
import { CaretLeftIcon, ListChecksIcon } from '@phosphor-icons/react'
import styles from './PollDetail.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortWallet = (wallet) => (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '')

/**
 * Poll Avatar
 * `profile_image` arrives in whatever shape the row carries — `ipfs://` from our own DB, a full
 * api.universalprofile.cloud URL from the LUKSO indexer — so the universal resolver does the
 * routing rather than the IPFS one, which would send that whole CDN URL as the CID and leave
 * every UP avatar on the default.
 *
 * Resolving through the sharp proxy keeps a 64px slot from pulling a full-size original, but the
 * proxy's raced gateways don't hold every CID and LUKSO's CDN serves some that they miss. So a
 * proxy miss retries the address's own URL before giving up on the default.
 * @param {Object} props
 * @param {string|null} props.src Raw profile image reference from the API.
 * @param {number} props.size Rendered width, in px, handed to the resize proxy.
 * @param {string} props.className Avatar class from the consumer's module.
 */
function PollAvatar({ src, size, className }) {
  const origin = typeof src === 'string' && src.startsWith('http') ? src : null
  const proxied = resolveStorageImageUrl(src, { width: size })

  const retryThenFallback = (event) => {
    const img = event.currentTarget
    if (origin && !img.dataset.retriedOrigin && img.src !== origin) {
      img.dataset.retriedOrigin = 'true'
      img.src = origin
      return
    }
    handleBrokenAvatar(event)
  }

  return <img src={proxied || origin || FALLBACK_AVATAR_SRC} alt="" onError={retryThenFallback} className={className} />
}

// A plain link rather than history.back(): a shared poll URL is usually the first page of the
// visit, and "back" from there would leave the site
const BackToPolls = () => (
  <Link href="/polls" className={styles.detail__back}>
    <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
    Back to polls
  </Link>
)

/**
 * Poll Detail
 * The /polls/[networkId]/[pollId] page. The ballot itself is the same PollCard the feed
 * renders — one voting surface, so the two can never disagree about what a poll allows —
 * and this page adds what a card has no room for: who asked, who voted, and the creator's
 * own control to end it early.
 * @param {Object} props
 * @param {string|number} props.networkId Chain the poll lives on.
 * @param {string|number} props.pollId Onchain poll id.
 */
export default function PollDetail({ networkId, pollId }) {
  const chainId = Number(networkId)
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const { writeContractAsync } = useWriteContract()
  const [isClosing, setIsClosing] = useState(false)

  const { data: detail, mutate } = useSWR(
    `/api/v1/polls/${pollId}?networkId=${chainId}${address ? `&voter=${address.toLowerCase()}` : ''}`,
    fetcher,
  )

  const poll = detail?.data?.poll
  const recentVotes = detail?.data?.recentVotes ?? []

  // The status badge and the close-early control are derived from the clock at render time,
  // so a window that ends on screen needs a re-render as well as fresh data — the refetch
  // alone would not re-render if nothing in the payload changed
  const [, setPhaseTick] = useState(0)
  const refreshPhase = () => {
    setPhaseTick((tick) => tick + 1)
    mutate()
  }

  if (detail && !poll) {
    return (
      <div className={styles.detail}>
        <BackToPolls />
        <div className={styles.detail__empty}>
          <ListChecksIcon size={32} />
          <p>This poll doesn&apos;t exist on this network.</p>
        </div>
      </div>
    )
  }

  if (!poll) return <p className={styles.detail__empty}>Loading poll...</p>

  const status = pollStatus(poll)
  const options = pollOptions(poll)
  const chain = appChains.find((entry) => entry.id === chainId)
  const explorer = chain?.blockExplorers?.default?.url
  const isCreator = address && poll.wallet_address && address.toLowerCase() === poll.wallet_address.toLowerCase()
  const canCloseEarly = isCreator && status.key === 'open'
  // Mirrors the API's own gate; the client only decides what to say about it, never whether
  // the data arrives
  const canSeeResults = status.key === 'closed' || Boolean(detail?.data?.ballot)

  const closePoll = async () => {
    const pollsAddress = CONTRACTS[`chain${chainId}`]?.polls
    if (!pollsAddress || !chain) return

    setIsClosing(true)
    try {
      const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

      if (session.active) {
        const tx = await writeWithBurnerSession({
          chain,
          contractAddress: pollsAddress,
          abi: pollsAbi,
          functionName: 'closePoll',
          args: [address, BigInt(pollId)],
        })
        await tx.wait().catch(() => null)
      } else {
        await writeContractAsync({ abi: pollsAbi, address: pollsAddress, functionName: 'closePoll', args: [address, BigInt(pollId)], chainId })
      }

      toast('Voting closed — the result is final', 'success')
      mutate()
    } catch (err) {
      toast(shortTxError(err, 'Could not close the poll'), 'error')
    } finally {
      setIsClosing(false)
    }
  }

  return (
    <div className={styles.detail}>
      <BackToPolls />

      <header className={styles.detail__header}>
        <Link href={`/${poll.wallet_address}`} className={styles.detail__creator}>
          <PollAvatar src={poll.profile_image} size={64} className={styles.detail__avatar} />
          <span>
            <strong>{poll.display_name || shortWallet(poll.wallet_address)}</strong>
            <small>asked {toRelative(poll.opened_at)}</small>
          </span>
        </Link>

        <span className={clsx(styles.detail__badge, styles[`detail__badge--${status.key}`])}>{status.label}</span>
      </header>

      {/* The card is the ballot — the page never renders a second voting path */}
      <PollCard pollRef={{ pollId: String(pollId), chainId }} />

      {canCloseEarly && (
        <button type="button" className={styles.detail__close} onClick={closePoll} disabled={isClosing}>
          {isClosing ? 'Closing...' : 'End voting now'}
        </button>
      )}

      <dl className={styles.detail__facts}>
        <div>
          <dt>Votes</dt>
          <dd>{formatVotes(poll.total_votes)}</dd>
        </div>
        <div>
          <dt>Options</dt>
          <dd>{options.length}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{chain?.name || `#${chainId}`}</dd>
        </div>
        <div>
          <dt>Voting</dt>
          <dd>
            <PollTimer opensAt={poll.opens_at} closesAt={Number(poll.closed_at) > 0 ? poll.closed_at : poll.closes_at} onPhaseChange={refreshPhase} />
          </dd>
        </div>
      </dl>

      <section className={styles.detail__voters}>
        <h2>Who voted</h2>
        {recentVotes.length === 0 && <p className={styles.detail__empty}>No votes yet.</p>}
        <ul>
          {recentVotes.map((vote) => (
            <li key={`${vote.wallet_address}-${vote.voted_at}`}>
              <Link href={`/${vote.wallet_address}`} className={styles.detail__voter}>
                <PollAvatar src={vote.profile_image} size={48} className={styles.detail__avatar} />
                <span>{vote.display_name || shortWallet(vote.wallet_address)}</span>
              </Link>
              {/* Absent until the viewer has voted or the poll has closed — the API withholds
                  the column rather than the client hiding it */}
              {vote.option_index !== undefined && (
                <span className={styles.detail__voterChoice}>
                  {options[Number(vote.option_index)]?.label || `Option #${Number(vote.option_index) + 1}`}
                </span>
              )}
              <span className={styles.detail__voterTime}>{toRelative(vote.voted_at)}</span>
            </li>
          ))}
        </ul>

        <p className={styles.detail__note}>
          {canSeeResults
            ? 'Every ballot is public onchain — this list is what the chain already says.'
            : 'Vote to see what everyone picked.'}
        </p>
      </section>

      {explorer && (
        <a className={styles.detail__tx} href={`${explorer}/tx/${poll.tx_hash}`} target="_blank" rel="noreferrer">
          View the poll onchain
        </a>
      )}
    </div>
  )
}
