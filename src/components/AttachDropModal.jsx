'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { ArrowSquareOutIcon, InfoIcon } from '@phosphor-icons/react'
import { useDropCollection } from '@/hooks/useDropCollection'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { dropStandardLabel, isNumberedStandard, normalizeDropCardOptions } from '@/lib/drops'
import DropCard from './DropCard'
import NativeDialog from './ui/NativeDialog'
import ToggleSwitch from './ui/ToggleSwitch'
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
function DropRow({ drop, chainId, onSelect }) {
  const { image, icon } = useDropCollection({ chainId, collection: drop.collection, standardId: drop.standard_id })
  const artwork = image || icon
  const imageUrl = artwork ? resolveStorageImageUrl(artwork) : null
  const isOpenEdition = Number(drop.max_supply) === 0

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onSelect({
            dropId: String(drop.drop_id),
            chainId,
            collection: drop.collection,
            standardId: drop.standard_id,
            name: drop.name ?? '',
            symbol: drop.symbol ?? '',
            image: artwork,
            icon,
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

/** A labelled switch for one section of the embedded card. */
function OptionRow({ id, label, hint, checked, onChange }) {
  return (
    <div className={styles.attachDrop__option}>
      <label htmlFor={id}>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </label>
      <ToggleSwitch id={id} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  )
}

/**
 * Attach Drop Modal
 * Two steps. Pick: one of the author's live drops on the post's chain, from the indexed API.
 * Embed: the card exactly as the feed will render it, with switches for what it shows; the
 * choices ride in the payload as `show` and DropCard honours them everywhere the post appears.
 *
 * Creating a drop happens at /drops/create, not here. That flow deploys a contract, uploads
 * artwork and fixes a mint schedule — too much to run inside the composer, and duplicating the
 * form to fit was worse than sending the author to the one that already exists.
 *
 * Closed drops are filtered out of the picker: their card can't mint, so attaching one to a
 * fresh post is almost certainly a mistake. Allowlist-gated drops attach cleanly — the list
 * lives onchain in the engine, so any card can check eligibility with nothing extra in the payload.
 *
 * @param {Object} props
 * @param {number} props.chainId The chain the post lands on — the drop is pinned to it too.
 * @param {Object} [props.initial] An already-attached reference: opens on the embed step to adjust it.
 * @param {Function} props.onAttached Receives the nftDrop content reference.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const AttachDropModal = ({ chainId, initial = null, onAttached, onClose }) => {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  const [selected, setSelected] = useState(initial)
  const [show, setShow] = useState(() => normalizeDropCardOptions(initial?.show))

  // Mount = open / unmount = close, matching the TipModal dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const { data: mine } = useSWR(
    address ? `/api/v1/drops?creator=${address.toLowerCase()}&networkId=${chainId}&limit=50` : null,
    fetcher,
  )

  const myDrops = (mine?.data ?? []).filter((drop) => !drop.closed)

  const setOption = (key) => (value) => setShow((current) => ({ ...current, [key]: value }))
  // Editions share one artwork, so the pieces strip only exists for numbered collections
  const canShowPieces = isNumberedStandard(selected?.standardId)

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachDrop}
      aria-label={selected ? 'Embed this drop' : 'Attach an NFT drop'}
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.attachDrop__header}>
        {selected && !initial ? (
          <button type="button" className={styles.attachDrop__cancel} onClick={() => setSelected(null)}>
            Back
          </button>
        ) : (
          <button type="button" className={styles.attachDrop__cancel} onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        )}
        <h3>{selected ? 'Embed this drop' : 'Attach a drop'}</h3>
      </header>

      {selected ? (
        <>
          <main className={styles.attachDrop__body}>
            <div className={styles.attachDrop__options}>
              <OptionRow id="drop-embed-stats" label="Show stats" hint="Price, supply and mint progress" checked={show.stats} onChange={setOption('stats')} />
              {canShowPieces && (
                <OptionRow
                  id="drop-embed-pieces"
                  label="Show minted pieces"
                  hint="The latest pieces collectors have minted"
                  checked={show.pieces}
                  onChange={setOption('pieces')}
                />
              )}
              <OptionRow id="drop-embed-mint" label="Show mint button" hint="Off leaves a teaser card that links to the drop" checked={show.mint} onChange={setOption('mint')} />
            </div>

            <div className={styles.attachDrop__preview}>
              {/* Live reads, so the author sees the supply and price the feed will */}
              <DropCard drop={{ ...selected, show }} preview className={styles.attachDrop__card} />
            </div>
          </main>

          <footer className={styles.attachDrop__footer}>
            <button type="button" className={styles.attachDrop__attach} onClick={() => onAttached({ ...selected, show })}>
              {initial ? 'Save' : 'Attach to post'}
            </button>
          </footer>
        </>
      ) : (
        <main className={styles.attachDrop__body}>
          {myDrops.length > 0 ? (
            <>
              <p className={styles.attachDrop__sectionTitle}>Pin one of your drops</p>
              <ul className={styles.attachDrop__list}>
                {myDrops.map((drop) => (
                  <DropRow key={`${drop.network_id}-${drop.drop_id}`} drop={drop} chainId={chainId} onSelect={setSelected} />
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.attachDrop__empty}>
              You have no live drops on this network yet.
            </p>
          )}

          <p className={styles.attachDrop__note}>
            <InfoIcon size={15} weight="fill" />
            <span>
              Want a new one? Launch it on the drops page first — it deploys a contract and pins your artwork — then
              come back here and pin it to this post. Your draft is kept.
            </span>
          </p>

          {/* A new tab, so the composer and its draft survive the trip */}
          <Link
            href={`/drops/create?chain=${chainId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.attachDrop__create}
          >
            <ArrowSquareOutIcon size={16} />
            Create a drop
          </Link>
        </main>
      )}
    </NativeDialog>
  )
}

export default AttachDropModal
