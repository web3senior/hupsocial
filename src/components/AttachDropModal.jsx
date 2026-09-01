'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { PlusIcon } from '@phosphor-icons/react'
import { useDropCollection } from '@/hooks/useDropCollection'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { dropStandardLabel } from '@/lib/drops'
import CreateDropDialog from './CreateDropDialog'
import NativeDialog from './ui/NativeDialog'
import HupMark from '@/components/ui/HupMark'
import styles from './AttachDropModal.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const countFormat = new Intl.NumberFormat('en')

/**
 * One of the author's indexed drops. Its own component because the artwork resolves through
 * the useDropCollection hook (the index stores name/symbol but not the image), and the
 * resolved image rides into the attachment payload so the feed card renders it without
 * re-deriving anything.
 */
function DropRow({ drop, chainId, onAttached }) {
  const { image } = useDropCollection({ chainId, collection: drop.collection, standardId: drop.standard_id })
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const isOpenEdition = Number(drop.max_supply) === 0

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onAttached({
            dropId: String(drop.drop_id),
            chainId,
            collection: drop.collection,
            standardId: drop.standard_id,
            name: drop.name ?? '',
            symbol: drop.symbol ?? '',
            image,
          })
        }
      >
        {imageUrl ? <img src={imageUrl} alt="" className={styles.attachDrop__thumb} /> : <span className={styles.attachDrop__thumb}><HupMark size={14} /></span>}
        <span>
          {drop.name || `Drop #${drop.drop_id}`} <em>{drop.symbol || dropStandardLabel(drop.standard_id)}</em>
        </span>
        <span className={styles.attachDrop__status}>
          {isOpenEdition ? `${countFormat.format(drop.minted)} minted` : `${countFormat.format(drop.minted)}/${countFormat.format(Number(drop.max_supply))}`}
        </span>
      </button>
    </li>
  )
}

/**
 * Attach Drop Modal
 * Lets the post composer attach an NFT drop on the post's chain: one the author already
 * created (from the indexed API), or a brand-new one created inline via CreateDropDialog —
 * the drop id is read from the creation receipt so the attachment never waits on the indexer.
 * Closed drops are filtered out: their card can't mint, so attaching one to a fresh post is
 * almost certainly a mistake.
 *
 * Allowlist-gated drops re-attach cleanly — the list lives onchain in the engine, so any
 * card can check eligibility and mint with nothing extra in the payload.
 *
 * @param {Object} props
 * @param {number} props.chainId The chain the post lands on — the drop is pinned to it too.
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, offered as the artwork.
 * @param {string} [props.prefillDescription] Post text, seeding the drop description.
 * @param {Function} props.onAttached Receives the nftDrop content reference.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const AttachDropModal = ({ chainId, prefillImage = '', prefillDescription = '', onAttached, onClose }) => {
  const dialogRef = useRef(null)
  const createDialogRef = useRef(null)
  const { address } = useConnection()

  // Mount = open / unmount = close, matching the TipModal dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const { data: mine } = useSWR(
    address ? `/api/v1/drops?creator=${address.toLowerCase()}&networkId=${chainId}&limit=50` : null,
    fetcher,
  )

  const myDrops = (mine?.data ?? []).filter((drop) => !drop.closed)

  const handleCreated = (dropReference) => {
    // Receipt parsing can fail on exotic RPCs — the drop exists onchain either way, the picker
    // just stays open so the author can attach it manually once indexed
    if (dropReference?.dropId) {
      onAttached(dropReference)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachDrop}
      aria-label="Attach an NFT drop"
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.attachDrop__header}>
        <button type="button" className={styles.attachDrop__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Attach a drop</h3>
      </header>

      <main className={styles.attachDrop__body}>
        <button
          type="button"
          className={styles.attachDrop__create}
          // The create dialog stacks on top of this one in the browser's top layer; the picker
          // stays open underneath so canceling creation falls back to it
          onClick={() => createDialogRef.current?.open()}
        >
          <PlusIcon size={16} />
          Create a new drop
        </button>

        {myDrops.length > 0 && (
          <>
            <p className={styles.attachDrop__sectionTitle}>Or pin one of yours</p>
            <ul className={styles.attachDrop__list}>
              {myDrops.map((drop) => (
                <DropRow key={`${drop.network_id}-${drop.drop_id}`} drop={drop} chainId={chainId} onAttached={onAttached} />
              ))}
            </ul>
          </>
        )}
      </main>

      <CreateDropDialog
        ref={createDialogRef}
        fixedChainId={chainId}
        prefillImage={prefillImage}
        prefillDescription={prefillDescription}
        onCreated={handleCreated}
      />
    </NativeDialog>
  )
}

export default AttachDropModal
