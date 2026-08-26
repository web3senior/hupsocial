'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import clsx from 'clsx'
import { displayTokenId } from '@/lib/walletNfts'
import { handleBrokenImage } from '@/lib/utils'
import useNftMetadata from '@/hooks/useNftMetadata'
import useCollectionInfo from '@/hooks/useCollectionInfo'
import PageTitle from '@/components/PageTitle'
import TokenDetailPanel from '@/components/TokenDetailPanel'
import Share from '@/components/ui/Share'
import HupMark from '@/components/ui/HupMark'
import ModelViewer from '@/components/ui/ModelViewer'
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CubeIcon,
  ImageIcon,
  ShareNetworkIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import styles from './TokenPage.module.scss'

/**
 * Token Page
 * One NFT's own page — the artwork on the left, its whole record on the right.
 *
 * The media column is this component's only real work. Everything a reader can learn or do about
 * the token belongs to TokenDetailPanel, which the collection grid's dialog and the listing page
 * also frame, so the three surfaces can never drift into telling different stories about one NFT.
 *
 * On a wide viewport the artwork sticks while the record scrolls: the record is long — offers,
 * traits, a timeline — and an NFT page where the NFT scrolls away is a catalogue entry rather
 * than a page about a picture.
 *
 * Standard is inferred rather than routed: an id is a bytes32 hex string on LSP8 and a decimal
 * number on ERC721, and the collection's own metadata settles it either way. Putting it in the
 * URL would mean every link into this page had to know it, and the tiles that link here often
 * don't.
 *
 * @param {Object} props
 * @param {string|number} props.networkId Chain the collection lives on.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.tokenId Token id in its raw form, already URL-decoded.
 */
export default function TokenPage({ networkId, collection, tokenId }) {
  const router = useRouter()

  // Collections that ship a 3D asset still lead with their artwork: the mesh is megabytes and
  // the renderer another few hundred KB, so both wait until someone asks for them.
  const [showModel, setShowModel] = useState(false)

  const chainId = Number(networkId)

  // cidex stores an LSP8 token id as bytes32 and an ERC721 one as a decimal string, and every
  // tile that links here builds the URL out of that stored form — so the id's own shape carries
  // the standard. It is the first source rather than a fallback because the collection probe
  // gets this wrong in practice: contracts that answer the LSP8 interface check unreliably come
  // back as ERC721, which would then pick the wrong ABI for a transfer or an offer.
  const looksLsp8 = /^0x[0-9a-fA-F]{64}$/.test(String(tokenId))

  // The collection's own answer still runs — it is the only source for a decimal-id collection,
  // and it carries the name, supply and creators the page needs regardless
  const collectionInfo = useCollectionInfo({ chainId, collection, isLsp8: looksLsp8 || undefined, enabled: Boolean(collection) })
  const isLsp8 = looksLsp8 || collectionInfo.isLsp8 === true

  const metadata = useNftMetadata({
    chainId,
    collection,
    tokenId,
    isLsp8,
    enabled: Boolean(collection && tokenId),
    imageWidth: 1024,
  })

  const collectionPath = `/nfts/${chainId}/collection/${String(collection).toLowerCase()}`
  const tokenPath = `${collectionPath}/${encodeURIComponent(tokenId)}`

  // The share menu wants an absolute URL, and this renders on the server first, where `window`
  // doesn't exist. The popover's links are in the DOM whether or not it is open, so reading the
  // origin straight into render would hand hydration two different hrefs to reconcile.
  //
  // useSyncExternalStore is the reconciliation: React takes the server snapshot for the server
  // pass and the first hydration render, then swaps in the client one. No mismatch, and no
  // setState in an effect — the origin never changes, so the subscribe callback has nothing to do.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  )
  const shareUrl = `${origin}${tokenPath}`

  const label = displayTokenId(tokenId)
  const collectionLabel = metadata.collectionName || collectionInfo.name || null
  const name = metadata.name || (collectionLabel ? `${collectionLabel} #${label}` : `#${label}`)
  // {url, fileType, isRenderable}, for the collections whose metadata carries a 3D file next to
  // the artwork
  const model = metadata.model

  if (!/^0x[0-9a-fA-F]{40}$/.test(String(collection)) || !Number.isFinite(chainId)) {
    return (
      <div className={styles.token__missing}>
        <PageTitle name="NFT" spacer={false} />
        <WarningIcon size={32} />
        <p>That isn&apos;t a collection address Hup can read.</p>
      </div>
    )
  }

  return (
    <div className={`${styles.token} animate fade`}>
      {/* Fixed-header + document title carry the NFT's name; the clearance spacer already
          renders at page level, outside the container */}
      <PageTitle name={name} spacer={false} />

      <button type="button" className={styles.token__back} onClick={() => router.back()}>
        <CaretLeftIcon size={16} />
        Back
      </button>

      <div className={styles.token__layout}>
        {/* Media column — the artwork, and the handful of links that are about this page rather
            than about the token */}
        <aside className={styles.token__media}>
          <div className={styles.token__stage}>
            {showModel && model?.isRenderable ? (
              <ModelViewer src={model.url} poster={metadata.image} alt={`${name} in 3D`} />
            ) : metadata.image ? (
              <img src={metadata.image} alt={name} onError={handleBrokenImage} />
            ) : (
              <div className={styles.token__mediaFallback}>
                <HupMark size={56} />
              </div>
            )}

            {/* Only for formats that actually paint — an fbx or usdz gets the download link
                below instead of a button that would open an empty canvas */}
            {model?.isRenderable && (
              <button type="button" className={styles.token__stageToggle} onClick={() => setShowModel((visible) => !visible)}>
                {showModel ? <ImageIcon size={14} weight="bold" /> : <CubeIcon size={14} weight="bold" />}
                {showModel ? 'View image' : 'View in 3D'}
              </button>
            )}
          </div>

          <div className={styles.token__mediaActions}>
            {model && !model.isRenderable && (
              <a
                href={model.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.token__action}
                title="This collection ships a 3D file the browser can't render inline"
              >
                <CubeIcon size={14} />
                3D file (.{model.fileType})
                <ArrowSquareOutIcon size={12} />
              </a>
            )}

            <Link href={collectionPath} className={styles.token__action}>
              <ImageIcon size={16} />
              Collection
            </Link>

            {/* Same target menu a post's share action offers (copy link, X, Telegram, ...) */}
            <Share
              url={shareUrl}
              title={name}
              copyLabel="Copy NFT link"
              copiedToast="NFT link copied"
              trigger={
                <button type="button" className={clsx(styles.token__action)} aria-label="Share this NFT">
                  <ShareNetworkIcon size={16} />
                  Share
                </button>
              }
            />
          </div>
        </aside>

        {/* The record. Ownership, price and offers all resolve live inside the panel, so a row
            indexed a moment ago can never be acted on here on stale terms. */}
        <div className={styles.token__record}>
          <TokenDetailPanel
            chainId={chainId}
            collection={collection}
            tokenId={tokenId}
            isLsp8={isLsp8}
            collectionName={collectionLabel}
            as="h1"
            // The listing's own page carries the fee and referral this ask was written on, which
            // are facts about that row rather than about the token
            showListingLink
            // Already the token's own page — a link through would lead back to here
            tokenHref={null}
          />
        </div>
      </div>
    </div>
  )
}
