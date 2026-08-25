'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { ArrowSquareOutIcon, CopySimpleIcon, EyeIcon, EyeSlashIcon } from '@phosphor-icons/react'
import useNftMetadata from '@/hooks/useNftMetadata'
import { useProfile } from '@/hooks/useProfile'
import { getPostById } from '@/lib/api'
import { amountOf, assetOf, explorerTxUrl, getKindMeta, hrefOf, shortAddress } from './activityModel'
import styles from './ActivityRow.module.scss'

// No viewer address is passed on purpose: the post endpoint keeps gated and encrypted content
// locked without one, so a paid post can never leak its body into a public feed.
const postFetcher = ([, networkId, postId]) =>
  getPostById(networkId, postId).then((response) => (Array.isArray(response?.data) ? response.data[0] : response?.data) || null)

export default function ActivityRow({ row }) {
  const router = useRouter()
  const [showReceipt, setShowReceipt] = useState(false)

  const meta = getKindMeta(row.kind)
  const Icon = meta.icon
  const href = useMemo(() => hrefOf(row), [row])
  const amount = useMemo(() => amountOf(row), [row])
  const asset = useMemo(() => assetOf(row), [row])

  // Rows pointing at the same post share one SWR key, so a burst of likes on one post costs a
  // single request no matter how many lines it fills.
  const previewPostId = meta.previews && row.entity_type === 'post' ? row.entity_id : null
  const { data: post } = useSWR(
    previewPostId && row.network_id ? ['activity-post', row.network_id, previewPostId] : null,
    postFetcher,
    // Deleted posts answer 404 forever — retrying them would burn requests for no preview.
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  )

  const nft = useNftMetadata({
    chainId: row.network_id,
    collection: asset?.collection,
    tokenId: asset?.tokenId,
    isLsp8: asset?.isLsp8,
    enabled: asset?.type === 'nft',
    imageWidth: 96,
    still: true,
  })

  // Media-only posts have nothing to quote; the row still names the actor and links to the post.
  const previewText = useMemo(() => {
    const elements = post?.content?.elements
    if (elements?.length) return elements[0]?.data?.text || ''
    return typeof post?.content === 'string' ? post.content : ''
  }, [post])

  const openTarget = () => href && router.push(href)
  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openTarget()
  }

  return (
    <div className={styles.entry}>
      <article
        className={clsx(styles.row, href && styles['row--clickable'])}
        data-tone={meta.tone}
        role={href ? 'link' : undefined}
        tabIndex={href ? 0 : undefined}
        onClick={openTarget}
        onKeyDown={href ? handleKeyDown : undefined}
      >
        <span className={styles.row__icon} title={meta.label}>
          <Icon size={19} weight={meta.weight || 'regular'} />
        </span>

        <div className={styles.row__body}>
          <p className={styles.row__sentence}>
            <Sentence row={row} amount={amount} asset={asset} nftName={nft.name} />
          </p>

          {previewText && <p className={styles.row__preview}>{previewText}</p>}
        </div>

        {nft.image && (
          <span className={styles.row__thumb}>
            <Image src={nft.image} alt="" width={44} height={44} unoptimized />
          </span>
        )}

        {/* The row itself navigates, so the receipt gets its own control — the hash it will show.
            A hash on its own reads as a link to the explorer, which is not what this does: the
            border and the eye say "opens the receipt here", and the eye closes when it is open. */}
        {row.tx_hash && (
          <button
            type="button"
            className={styles.row__hash}
            aria-expanded={showReceipt}
            title={showReceipt ? 'Hide transaction details' : 'View transaction details'}
            onClick={(event) => {
              event.stopPropagation()
              setShowReceipt((current) => !current)
            }}
          >
            {showReceipt ? <EyeSlashIcon size={13} /> : <EyeIcon size={13} />}
            {row.tx_hash.slice(0, 8)}
          </button>
        )}
      </article>

      {showReceipt && row.tx_hash && <Receipt row={row} />}
    </div>
  )
}

/** What the chain recorded: the trio every indexed row carries, plus a way out to the explorer. */
function Receipt({ row }) {
  const explorer = explorerTxUrl(row)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.tx_hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard blocked (insecure context, denied permission) — the hash is on screen to select.
    }
  }

  return (
    <dl className={styles.receipt}>
      <dt>tx</dt>
      <dd>
        <span className={styles.receipt__hash}>{row.tx_hash}</span>
        <button type="button" className={styles.receipt__copy} onClick={copy}>
          <CopySimpleIcon size={12} />
          {copied ? 'copied' : 'copy'}
        </button>
      </dd>

      <dt>block</dt>
      <dd>{row.block_number === null ? 'not indexed — reported by the swap page at confirmation' : row.block_number.toLocaleString('en')}</dd>

      {row.log_index !== null && (
        <>
          <dt>log</dt>
          <dd>#{row.log_index}</dd>
        </>
      )}

      <dt>chain</dt>
      <dd>
        {row.network_name} · {row.network_id}
      </dd>

      <dt>actor</dt>
      <dd className={styles.receipt__hash}>{row.actor}</dd>

      {explorer && (
        <>
          <dt>explorer</dt>
          <dd>
            <a href={explorer} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
              open receipt <ArrowSquareOutIcon size={12} />
            </a>
          </dd>
        </>
      )}
    </dl>
  )
}

/**
 * The line itself, in the third person — a public feed can never reuse the notification copy,
 * which is written for one recipient ("Your post was indexed", "bought your NFT").
 */
function Sentence({ row, amount, asset, nftName }) {
  const actor = <ActorLink address={row.actor} />
  // A wallet can like or tip its own post, and "Alice liked Alice's post" reads as a bug.
  const isSelfSubject = Boolean(row.subject) && row.subject.toLowerCase() === row.actor?.toLowerCase()
  const subject = row.subject && !isSelfSubject ? <ActorLink address={row.subject} /> : null
  const assetLabel = asset?.type === 'nft' ? nftName || 'an NFT' : asset?.label || null

  switch (row.kind) {
    case 'post':
      return withActor(actor, 'posted')
    case 'comment':
      return withActor(actor, 'replied')
    case 'repost':
      return withActor(actor, 'reposted')
    case 'like':
      if (isSelfSubject) return withActor(actor, 'liked their own post')
      return subject ? (
        <>
          {actor} <span className={styles.row__verb}>liked</span> {subject}
          <span className={styles.row__verb}>&apos;s post</span>
        </>
      ) : (
        withActor(actor, 'liked a post')
      )
    case 'follow':
      return subject ? (
        <>
          {actor} <span className={styles.row__verb}>followed</span> {subject}
        </>
      ) : (
        withActor(actor, 'followed someone')
      )
    case 'tip':
      return (
        <>
          {actor} <span className={styles.row__verb}>tipped</span>
          {subject ? <> {subject}</> : null}
          {isSelfSubject ? <span className={styles.row__verb}> their own post</span> : null}
          {amount ? <Amount value={amount} /> : null}
        </>
      )
    case 'nft_sale':
      return (
        <>
          {actor} <span className={styles.row__verb}>bought</span> <span className={styles.row__asset}>{assetLabel || 'an NFT'}</span>
          {amount ? (
            <>
              <span className={styles.row__verb}> for</span>
              <Amount value={amount} />
            </>
          ) : null}
        </>
      )
    case 'offer_made':
      return (
        <>
          {actor} <span className={styles.row__verb}>offered</span>
          {amount ? <Amount value={amount} /> : null}
          {assetLabel ? (
            <>
              <span className={styles.row__verb}> for</span> <span className={styles.row__asset}>{assetLabel}</span>
            </>
          ) : null}
        </>
      )
    // Accepting an offer means handing over the asset and taking the payout, so the line reads as
    // the sale it is — and falls back to the neutral wording when the asset cannot be named.
    case 'offer_filled':
      return assetLabel ? (
        <>
          {actor} <span className={styles.row__verb}>sold</span> <span className={styles.row__asset}>{assetLabel}</span>
          <span className={styles.row__verb}> for</span>
          {amount ? <Amount value={amount} /> : null}
        </>
      ) : (
        <>
          {actor} <span className={styles.row__verb}>filled an offer for</span>
          {amount ? <Amount value={amount} /> : null}
        </>
      )
    case 'bet':
      return (
        <>
          {actor} <span className={styles.row__verb}>bet</span>
          {amount ? <Amount value={amount} /> : null}
          {row.meta?.title ? (
            <>
              <span className={styles.row__verb}> on</span> <span className={styles.row__asset}>{row.meta.title}</span>
            </>
          ) : null}
        </>
      )
    case 'swap':
      return (
        <>
          {actor} <span className={styles.row__verb}>swapped</span>{' '}
          <span className={styles.row__asset}>
            {row.meta?.token_in_symbol || '?'} → {row.meta?.token_out_symbol || '?'}
          </span>
        </>
      )
    case 'community_created':
      return (
        <>
          {actor} <span className={styles.row__verb}>created the community</span>{' '}
          <span className={styles.row__asset}>{row.meta?.community_name || `#${row.entity_id}`}</span>
        </>
      )
    // The row's subject is the community's creator; naming them reads as ownership without
    // repeating the actor when someone joins their own community.
    case 'community_joined':
      return (
        <>
          {actor} <span className={styles.row__verb}>joined</span>{' '}
          {subject ? (
            <>
              {subject}
              <span className={styles.row__verb}>&apos;s community</span>{' '}
            </>
          ) : null}
          <span className={styles.row__asset}>{row.meta?.community_name || `#${row.entity_id}`}</span>
        </>
      )
    default:
      return withActor(actor, row.kind)
  }
}

const withActor = (actor, verb) => (
  <>
    {actor} <span className={styles.row__verb}>{verb}</span>
  </>
)

function Amount({ value }) {
  return <span className={styles.row__amount}>{value}</span>
}

function ActorLink({ address }) {
  const { profile } = useProfile(address)
  // `new-user` is the hook's placeholder for a wallet with no profile at all — a truncated
  // address identifies them, a shared placeholder name does not.
  const resolved = profile?.fullName || (profile?.name === 'new-user' ? null : profile?.name)
  const name = resolved || shortAddress(address)

  return (
    <Link href={`/${address}`} className={styles.row__actor} onClick={(event) => event.stopPropagation()}>
      {name}
    </Link>
  )
}
