'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { useWalletNfts } from '@/hooks/useWalletNfts'
import SendNftModal from '../SendNftModal'
import styles from './NftGallery.module.scss'

/**
 * One tile. Its own component for the artwork fallback chain: the resize proxy first, then the
 * CDN original when that times out (it does, on the multi-megabyte animations some collections
 * ship), then the placeholder. A bare <img> can't express that — on failure the browser paints
 * a broken-image icon and the alt text over the tile.
 */
function NftTile({ nft, isOwner, onSend }) {
  // still: the first frame is all a thumbnail needs, and it skips re-encoding animations
  const [source, setSource] = useState(() =>
    nft.image ? resolveStorageImageUrl(nft.image, { width: 320, still: true }) : null
  )
  const [failed, setFailed] = useState(false)
  const triedOriginal = useRef(false)

  const handleError = () => {
    if (!triedOriginal.current && nft.imageOriginal) {
      triedOriginal.current = true
      setSource(nft.imageOriginal)
      return
    }
    setFailed(true)
  }

  return (
    <figure className={styles.gallery__item}>
      {/* The link wraps only the artwork and caption — the Send button is a sibling, since
          nesting a button inside an anchor is invalid and swallows the click */}
      <Link className={styles.gallery__link} href={`/nfts/${nft.chainId}/collection/${nft.address}`}>
        <span className={styles.gallery__art}>
          {source && !failed ? (
            // alt="" deliberately: the name sits in the caption right below, so the image is
            // decorative — and empty alt means a failure shows nothing rather than spilling text
            <img src={source} alt="" loading="lazy" decoding="async" onError={handleError} />
          ) : (
            <span className={styles.gallery__artFallback} aria-hidden="true" />
          )}
        </span>

        <figcaption className={styles.gallery__caption}>
          <span className={styles.gallery__name}>{nft.name}</span>
          {nft.label && <span className={styles.gallery__tokenId}>#{nft.label}</span>}
        </figcaption>
      </Link>

      {isOwner && (
        <button type="button" className={styles.gallery__send} onClick={() => onSend(nft)}>
          Send
        </button>
      )}
    </figure>
  )
}

/**
 * NftGallery
 * The NFT half of the profile Assets tab. NFTs have no USD price, so they sit in their
 * own grid below the token rows rather than joining them or the portfolio total.
 *
 * Only LUKSO can enumerate a wallet's NFTs (see lib/walletNfts). On every other chain this
 * renders nothing at all — an empty grid would read as "you own none" rather than "we can't
 * tell from here".
 *
 * `chainId` is the Assets tab's network filter. Narrowing to a chain with no enumerable NFTs
 * empties the grid, which the same silence covers: nothing found and nothing knowable look
 * identical from here, so neither gets a claim made about it.
 */
export default function NftGallery({ owner, isOwner, chainId = null }) {
  const { nfts: allNfts, isLoading, refresh } = useWalletNfts(owner)
  const [sendNft, setSendNft] = useState(null)

  const nfts = chainId ? allNfts.filter((nft) => nft.chainId === chainId) : allNfts

  if (isLoading) {
    return (
      <section className={styles.gallery}>
        <h3 className={styles.gallery__heading}>NFTs</h3>
        <div className={styles.gallery__grid}>
          <div className={clsx('shimmer', styles.gallery__shimmer)} />
          <div className={clsx('shimmer', styles.gallery__shimmer)} />
          <div className={clsx('shimmer', styles.gallery__shimmer)} />
        </div>
      </section>
    )
  }

  // Nothing found is indistinguishable from nothing knowable off LUKSO, so say nothing
  if (nfts.length === 0) return null

  return (
    <section className={styles.gallery}>
      <h3 className={styles.gallery__heading}>
        NFTs
        <span className={styles.gallery__count}>{nfts.length}</span>
      </h3>

      <div className={styles.gallery__grid}>
        {nfts.map((nft) => (
          <NftTile key={nft.id} nft={nft} isOwner={isOwner} onSend={setSendNft} />
        ))}
      </div>

      {sendNft && <SendNftModal nft={sendNft} owner={owner} onSent={refresh} onClose={() => setSendNft(null)} />}
    </section>
  )
}
