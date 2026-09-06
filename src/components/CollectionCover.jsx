'use client'

import { useEffect } from 'react'
import clsx from 'clsx'
import useNftMetadata from '@/hooks/useNftMetadata'
import useStoredImage from '@/hooks/useStoredImage'
import { collectionBannerUri, collectionIconUri, collectionSamples } from '@/lib/collectionArtwork'
import { handleBrokenImage } from '@/lib/utils'
import HupMark from '@/components/ui/HupMark'
import styles from './CollectionCover.module.scss'

/**
 * One sample token's artwork. A hook can't be called in a loop over a variable-length list,
 * so the mosaic renders a fixed number of these instead — each resolves its own token through
 * the same batched, SWR-immutable cache the market cards use, so tokens already on screen
 * elsewhere cost nothing to draw here.
 * @param {Object} props
 * @param {Object} [props.sample] Normalized sample; absent slots render nothing.
 * @param {Function} [props.onName] Called with the collection name once metadata resolves.
 */
function CoverTile({ networkId, collection, sample, onName, markSize }) {
  const metadata = useNftMetadata({
    chainId: networkId,
    collection,
    tokenId: sample?.tokenId,
    isLsp8: sample?.isLsp8,
    enabled: Boolean(sample),
    imageWidth: 256,
    still: true,
  })

  useEffect(() => {
    if (metadata.collectionName) onName?.(metadata.collectionName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.collectionName])

  if (!sample) return null

  return (
    <div className={styles.cover__tile}>
      {metadata.image ? (
        <img src={metadata.image} alt="" loading="lazy" decoding="async" onError={handleBrokenImage} />
      ) : (
        <span className={styles.cover__mark}>
          <HupMark size={markSize} />
        </span>
      )}
    </div>
  )
}

/**
 * Collection Mosaic
 * What is on the shelf, standing in for a collection that ships no artwork of its own: the
 * most recent listing large beside the two behind it. Exported for surfaces that own their
 * artwork layer (the featured banner scrims and scales its own), everything else reaches it
 * through CollectionCover.
 * @param {Object} props
 * @param {Array<{tokenId: string, isLsp8: boolean}>} props.samples Normalized samples.
 * @param {number} [props.markSize=22] Size of the placeholder mark, per surface.
 */
export function CollectionMosaic({ networkId, collection, samples = [], onName, markSize = 22, className }) {
  if (!samples.length) {
    return (
      <span className={clsx(styles.cover__mark, className)}>
        <HupMark size={markSize} />
      </span>
    )
  }

  const tile = (sample) => <CoverTile networkId={networkId} collection={collection} sample={sample} onName={onName} markSize={markSize} />

  return (
    // One listing would leave the side column an empty strip, so the lead art takes the box
    <div className={clsx(styles.cover__mosaic, samples.length < 2 && styles['cover__mosaic--single'], className)}>
      {tile(samples[0])}
      {samples.length > 1 && (
        <div className={styles.cover__side}>
          {tile(samples[1])}
          {tile(samples[2])}
        </div>
      )}
    </div>
  )
}

/**
 * Collection Cover
 * The artwork that stands for a collection, decided the same way everywhere it appears.
 *
 * A collection's own image comes first — that is what its creator drew for this — and only a
 * collection that has none borrows from what is listed inside it. Which of the two own images
 * leads is the slot's call: a wide box wants the banner, a round thumb wants the icon, and
 * either falls through to the other before the mosaic.
 *
 * Sizing, radius and aspect belong to the consumer's own module; this owns the ladder and
 * the mosaic's internals only. Overlays (a chain badge) go in as children.
 * @param {Object} props
 * @param {Object} props.row A collection row from the collections or ranking API.
 * @param {'banner'|'icon'} [props.prefer='banner'] Which of the collection's own images leads.
 * @param {number} [props.width=512] Width hint for the image proxy.
 * @param {boolean} [props.blurIcon=false] Blow up and blur a square icon standing in for a
 * wide banner, so the box wears the collection's colours instead of a letterboxed logo.
 * @param {'mosaic'|'mark'} [props.fallback='mosaic'] What an artless collection falls back
 * to. A slot too small to read three thumbs in says 'mark' — the mosaic costs a metadata
 * read per tile, which is not a price a thumbnail should pay.
 * @param {Function} [props.onName] Called with the collection name if a mosaic tile resolves
 * one — a cover showing the collection's own image never reads a token, so a caller that
 * needs the name should take it from the row.
 */
export default function CollectionCover({ row, prefer = 'banner', width = 512, blurIcon = false, fallback = 'mosaic', markSize = 22, onName, className, children }) {
  const networkId = Number(row?.network_id)
  const address = row?.collection ? String(row.collection).toLowerCase() : null

  const banner = collectionBannerUri(row)
  const icon = collectionIconUri(row)
  const lead = prefer === 'icon' ? icon || banner : banner || icon

  const art = useStoredImage(lead, { width, still: true })

  return (
    <div className={clsx(styles.cover, className)}>
      {art.src ? (
        <img
          className={clsx(styles.cover__art, blurIcon && lead === icon && styles['cover__art--fill'])}
          src={art.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={art.onError}
        />
      ) : (
        <CollectionMosaic
          networkId={networkId}
          collection={address}
          samples={fallback === 'mosaic' ? collectionSamples(row) : []}
          onName={onName}
          markSize={markSize}
        />
      )}
      {children}
    </div>
  )
}
