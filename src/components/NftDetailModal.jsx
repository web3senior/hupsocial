'use client'

import { useEffect, useRef, useState } from 'react'
import { CubeIcon, FrameCornersIcon, ImageIcon, XIcon } from '@phosphor-icons/react'
import { displayTokenId } from '@/lib/walletNfts'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import ModelViewer from '@/components/ui/ModelViewer'
import NativeDialog from '@/components/ui/NativeDialog'
import NftFrameDialog from '@/components/NftFrameDialog'
import TokenDetailPanel from '@/components/TokenDetailPanel'
import styles from './NftDetailModal.module.scss'

/**
 * NftDetailModal
 * One token's full record in the top layer — the artwork on the left, TokenDetailPanel's identity,
 * action card and sections on the right. A quick look at a token without leaving the page you are on —
 * the token's own page at /nfts/[chain]/collection/[address]/[tokenId] is where its action card links.
 *
 * The dialog owns the frame and the artwork only. Everything a reader can learn or do about the
 * token — list, transfer, offer, traits, offers, activity, price history — belongs to the panel,
 * so this surface and the listing page can never drift apart.
 *
 * The metadata read shares its SWR key with the tile that opened it — image width and the
 * still-frame hint are derived from the cached row, not part of the key — so opening this costs no
 * second fetch, and the panel's own read of the same key costs nothing again.
 *
 * Mount = open / unmount = close, matching the other dialogs.
 *
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.tokenId Token id in its raw form — bytes32 hex for LSP8, decimal for ERC721.
 * @param {boolean} [props.isLsp8]
 * @param {string|null} [props.collectionName] Names the token while its own metadata resolves.
 * @param {boolean} [props.showCollectionLink] Passed through — the collection page's own grid
 * turns it off, since a link back to the page you are on is a dead end.
 * @param {Function} props.onClose
 */
export default function NftDetailModal({ chainId, collection, tokenId, isLsp8, collectionName, showCollectionLink = true, onClose }) {
  const dialogRef = useRef(null)
  const [showModel, setShowModel] = useState(false)

  // Frame mode — the artwork hung in a picture frame on a gallery wall, opened over this dialog.
  // Its own close/cancel stop at its boundary, so leaving the wall never closes this too.
  const [framed, setFramed] = useState(false)

  const metadata = useNftMetadata({ chainId, collection, tokenId, isLsp8, imageWidth: 720 })

  const label = displayTokenId(tokenId)
  const name = metadata.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)
  const model = metadata.model

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.nftDetail}
      lightDismiss
      aria-label={name}
      onClick={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
    >
      <button type="button" className={styles.nftDetail__close} onClick={() => dialogRef.current?.close()} aria-label="Close">
        <XIcon size={18} />
      </button>

      <div className={styles.nftDetail__body}>
        <div className={styles.nftDetail__stage}>
          {showModel && model?.isRenderable ? (
            <ModelViewer src={model.url} poster={metadata.image} alt={`${name} in 3D`} />
          ) : metadata.image ? (
            <img src={metadata.image} alt={name} onError={handleBrokenImage} />
          ) : (
            <span className={styles.nftDetail__stageFallback} aria-hidden="true" />
          )}

          {/* Over the bottom-left of the artwork, opposite the 3D toggle: hangs the image in a
              frame on a wall. Only once there is an image to hang. */}
          {metadata.image && (
            <button
              type="button"
              className={styles.nftDetail__stageFrame}
              onClick={() => setFramed(true)}
              title="Hang the artwork in a frame on a wall — for a second screen or a TV"
            >
              <FrameCornersIcon size={14} weight="bold" />
              Frame mode
            </button>
          )}

          {/* Only for formats that actually paint — an fbx or usdz gets the download link in the
              panel's Details section instead of a button opening an empty canvas */}
          {model?.isRenderable && (
            <button type="button" className={styles.nftDetail__stageToggle} onClick={() => setShowModel((visible) => !visible)}>
              {showModel ? <ImageIcon size={14} weight="bold" /> : <CubeIcon size={14} weight="bold" />}
              {showModel ? 'View image' : 'View in 3D'}
            </button>
          )}
        </div>

        <TokenDetailPanel
          chainId={chainId}
          collection={collection}
          tokenId={tokenId}
          isLsp8={Boolean(isLsp8)}
          collectionName={collectionName}
          showCollectionLink={showCollectionLink}
          // The one surface with no URL of its own — a reader who wants to send this to somebody
          // needs the token's own page, so the action card offers it
          tokenHref={`/nfts/${chainId}/collection/${String(collection).toLowerCase()}/${encodeURIComponent(tokenId)}`}
          showListingLink
        />
      </div>

      {framed && (
        <NftFrameDialog
          chainId={chainId}
          collection={collection}
          tokenId={tokenId}
          isLsp8={Boolean(isLsp8)}
          collectionName={metadata.collectionName || collectionName || null}
          // The 720 copy this dialog already painted hangs at once; the frame swaps in its own
          // sharper rung once that has loaded
          poster={metadata.image}
          onClose={() => setFramed(false)}
        />
      )}
    </NativeDialog>
  )
}
