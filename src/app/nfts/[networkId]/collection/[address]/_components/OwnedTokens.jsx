'use client'

import { useState } from 'react'
import useOwnedTokenIds from '@/hooks/useOwnedTokenIds'
import useNftMetadata from '@/hooks/useNftMetadata'
import { useConnection } from 'wagmi'
import { normalizeTokenId } from '@/lib/walletNfts'
import SendNftModal from '@/components/SendNftModal'
import styles from './OwnedTokens.module.scss'

/**
 * LSP8 ids are bytes32 and unreadable raw. Number-format collections pack a plain integer into
 * those 32 bytes, so show the number when it looks like one and fall back to a shortened hex —
 * the profile gallery gets a properly formatted id from the index, but onchain reads don't.
 */
const displayTokenId = (raw) => {
  const value = String(raw)
  if (!value.startsWith('0x')) return value
  try {
    const asNumber = BigInt(value)
    if (asNumber > 0n && asNumber < 10n ** 12n) return asNumber.toString()
  } catch {
    // Falls through to the shortened form
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function OwnedTile({ chainId, collection, collectionName, rawId, isLsp8, onSend }) {
  const meta = useNftMetadata({ chainId, collection, tokenId: rawId, isLsp8, imageWidth: 320, still: true })
  const label = displayTokenId(rawId)
  const name = meta.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)

  const nft = {
    id: `${chainId}:${collection.toLowerCase()}:${rawId}`,
    chainId,
    address: collection,
    // SendNftModal takes the bytes32 form and widens it back for ERC721
    tokenId: normalizeTokenId(rawId),
    name,
    collection: collectionName || null,
    label,
    image: meta.image || null,
    imageOriginal: null,
    isLsp8: Boolean(isLsp8),
  }

  return (
    <figure className={styles.owned__item}>
      <span className={styles.owned__art}>
        {meta.image ? <img src={meta.image} alt="" loading="lazy" decoding="async" /> : <span className={styles.owned__artFallback} aria-hidden="true" />}
      </span>

      <figcaption className={styles.owned__caption}>
        <span className={styles.owned__name}>{name}</span>
        <span className={styles.owned__tokenId}>#{label}</span>
      </figcaption>

      <button type="button" className={styles.owned__send} onClick={() => onSend(nft)}>
        Send
      </button>
    </figure>
  )
}

/**
 * Owned Tokens
 * The connected wallet's own tokens inside this collection, with a transfer action. Unlike the
 * profile gallery this reads ownership straight from the contract (useOwnedTokenIds), so it
 * works on every chain rather than only the one with a wallet index.
 *
 * Renders nothing when disconnected or when the wallet holds none here — an empty strip on
 * every collection page would be noise.
 *
 * @param {Object} props
 * @param {number} props.chainId
 * @param {string} props.collection Collection contract address.
 * @param {string|null} props.collectionName
 * @param {boolean|null} props.isLsp8 Null until the collection's standard resolves.
 */
export default function OwnedTokens({ chainId, collection, collectionName, isLsp8 }) {
  const { address, isConnected } = useConnection()
  const [sendNft, setSendNft] = useState(null)

  // The read needs the standard to pick between tokenIdsOf and tokenOfOwnerByIndex
  const { tokenIds, balance, isEnumerable } = useOwnedTokenIds({
    chainId,
    collection,
    owner: address,
    isLsp8: Boolean(isLsp8),
    enabled: isConnected && typeof isLsp8 === 'boolean',
  })

  if (!isConnected || !balance) return null

  return (
    <section className={styles.owned}>
      <h3 className={styles.owned__heading}>
        Yours in this collection
        <span className={styles.owned__count}>{balance}</span>
      </h3>

      {tokenIds.length > 0 ? (
        <div className={styles.owned__grid}>
          {tokenIds.map((rawId) => (
            <OwnedTile
              key={String(rawId)}
              chainId={chainId}
              collection={collection}
              collectionName={collectionName}
              rawId={rawId}
              isLsp8={isLsp8}
              onSend={setSendNft}
            />
          ))}
        </div>
      ) : (
        // A real balance with nothing to list means the collection skipped ERC721Enumerable —
        // say so rather than implying the wallet holds nothing
        !isEnumerable && (
          <p className={styles.owned__note}>
            This collection doesn&apos;t publish which token ids you hold, so they can&apos;t be listed here.
          </p>
        )
      )}

      {sendNft && (
        <SendNftModal nft={sendNft} owner={address} onSent={() => setSendNft(null)} onClose={() => setSendNft(null)} />
      )}
    </section>
  )
}
