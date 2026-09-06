'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { isAddress, toHex } from 'viem'
import clsx from 'clsx'
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FolderSimpleIcon,
  InfoIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  StackIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'
import useSWR from 'swr'
import { appChains } from '@/config/contracts'
import { resolveStorageImageUrl, resolveStorageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { COLLECTION_KIND, KIND_LABEL, isLuksoKind, splitTokenOneUri } from '@/lib/collectionProbe'
import {
  DROP_STANDARDS,
  INTERFACEID_LSP0,
  LSP4_DATA_KEYS,
  MAX_DROP_CREATORS,
  buildLsp4MetadataJson,
  creatorsElementKeyAt,
  dropStandardLabel,
  encodeCreatorsWrites,
  encodeVerifiableURI,
  isLuksoChain,
  sharesOneTokenDocument,
} from '@/lib/drops'
import {
  LSP4_METADATA_KEY,
  LSP8_TOKEN_METADATA_BASE_URI_KEY,
  decodeVerifiableUri,
  erc725yGetDataAbi,
  fetchLsp4Document,
  fetchMetadataJson,
  pickImageUrl,
} from '@/lib/lsp4'
import { useCollectionProbe } from '@/hooks/useCollectionProbe'
import useContractChains from '@/hooks/useContractChains'
import { useIssuedAssets } from '@/hooks/useIssuedAssets'
import useCollectionMetadataRefresh, { describeCollectionRefresh } from '@/hooks/useCollectionMetadataRefresh'
import { metadataFetcher } from '@/hooks/useDropCollection'
import HupMark from '@/components/ui/HupMark'
import { describeWalletError } from '@/lib/walletErrors'
import { networkColorStyle } from '@/lib/networkColors'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import DropArtworkUpload from '@/components/DropArtworkUpload'
import Profile from '@/components/Profile'
import NftDetailModal from '@/components/NftDetailModal'
import NativePopover from '@/components/ui/NativePopover'
import CopyButton from '@/components/ui/CopyButton'
import Tooltip from '@/components/ui/Tooltip'
import Lsp4MetadataEditor from '@/components/Lsp4MetadataEditor'
import ContractUriEditor from '@/components/ContractUriEditor'
import TokenMetadataEditor from '@/components/TokenMetadataEditor'
import StudioSplash from './StudioSplash'
import styles from './CollectionStudio.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())
const countFormat = new Intl.NumberFormat('en')

const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

// An untitled link still needs a label the reader can use — the host is the honest one
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * The shapes of link the collection can actually read, shown beside the field that takes one —
 * a wrong shape here is a collection that resolves to nothing, discovered by a collector.
 * `document` is one file (the collection card); `folder` is a directory the token number is
 * appended to. Only schemes the app's own resolver serves are listed: ipfs://, https:// and a
 * data: URI carrying the JSON itself.
 * @param {{ kind: 'document'|'folder', suffix?: string }} props `suffix` is what this standard
 *   appends after the number, or null when the contract decides and the studio cannot know.
 */
function LinkExamples({ kind, suffix = '' }) {
  const ending = suffix === null ? '…' : suffix
  const rows =
    kind === 'folder'
      ? [
          { ok: true, label: 'IPFS folder', url: 'ipfs://bafybeig…/', note: `A pinned folder. Token 1 loads from ipfs://bafybeig…/1${ending}.` },
          { ok: true, label: 'Your own server', url: 'https://yourdomain.com/metadata/', note: `Over HTTPS. It must answer …/1${ending}, …/2${ending} and so on.` },
          { ok: false, label: 'A single file', url: 'ipfs://bafybeig…/1.json', note: 'Points at one file, so every token would load the same document.' },
          { ok: false, label: 'Gateway address', url: 'https://ipfs.io/ipfs/bafybeig…/', note: 'Ties the collection to that one gateway. Use ipfs:// instead.' },
        ]
      : [
          { ok: true, label: 'IPFS', url: 'ipfs://bafybeig…/metadata.json', note: 'Pinned on IPFS — Pinata, Filebase, web3.storage or your own node.' },
          { ok: true, label: 'Your own server', url: 'https://yourdomain.com/collection.json', note: 'Over HTTPS, on a site you keep running.' },
          {
            ok: true,
            label: 'Fully onchain',
            url: 'data:application/json;base64,eyJ…',
            note: 'The whole document lives inside the link, on the blockchain: nothing to host, nothing to lose, the top storage score. Every byte costs gas, so keep it short and link to the artwork.',
          },
          { ok: false, label: 'Gateway address', url: 'https://gateway.pinata.cloud/ipfs/bafybeig…', note: 'Ties the collection to that one gateway. Use ipfs:// instead.' },
        ]

  // One pill per shape; the example link and the reason ride in the tooltip, so the row stays a row
  return (
    <div className={styles.studio__examples} aria-label="Links that work">
      <span className={styles.studio__examplesLabel}>Links that work</span>
      {rows.map((row) => (
        <Tooltip
          key={row.label}
          content={
            <span className={styles.studio__exampleTip}>
              <code>{row.url}</code>
              {row.note}
            </span>
          }
        >
          <span className={clsx(styles.studio__example, !row.ok && styles['studio__example--avoid'])} tabIndex={0}>
            {row.ok ? <CheckCircleIcon size={13} weight="fill" aria-hidden="true" /> : <XIcon size={11} weight="bold" aria-hidden="true" />}
            {row.label}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * A pointer the collection currently holds, as something a person can click: an ipfs:// or
 * https:// link opens through the app's gateway resolution; a data: link is the document itself
 * and has nowhere to open, so it is named for what it is.
 * @param {{ uri: string }} props
 */
function CurrentLink({ uri }) {
  if (!uri) return <em>nothing yet</em>
  // The full pointer goes to the clipboard, never the shortened print
  const copy = <CopyButton value={uri} title="Copy the link" size={13} />
  if (uri.startsWith('data:')) {
    return (
      <>
        <code title={uri.slice(0, 200)} className={styles.studio__currentInline}>
          data:… — the document is inside the link, fully onchain
        </code>
        {copy}
      </>
    )
  }
  const href = resolveStorageUrl(uri)
  const text = uri.length > 72 ? `${uri.slice(0, 44)}…${uri.slice(-20)}` : uri
  return (
    <>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={uri} className={styles.studio__currentLink}>
          <code>{text}</code>
          <ArrowSquareOutIcon size={11} aria-hidden="true" />
        </a>
      ) : (
        <code title={uri}>{text}</code>
      )}
      {copy}
    </>
  )
}

// LSP12IssuedAssets is a LUKSO mainnet answer; the drops index already covers every chain
const LUKSO_MAINNET_ID = 42

/**
 * A collection document to start from, in the shape this collection's standard reads — filled
 * with the collection's own name and placeholder links where the pictures go.
 */
const sampleCollectionDocument = ({ isLukso, name }) => {
  const label = name || 'My Collection'
  const description = 'A few words about the collection — what it is and why it exists.'
  if (isLukso) {
    return buildLsp4MetadataJson({
      name: label,
      description,
      iconUrl: 'ipfs://bafybeig…/icon.png',
      imageUrl: 'ipfs://bafybeig…/collection.png',
      backgroundImageUrl: 'ipfs://bafybeig…/banner.png',
      links: [
        { title: 'Website', url: 'https://yourdomain.com' },
        { title: 'X', url: 'https://x.com/yourname' },
      ],
    })
  }
  return {
    name: label,
    description,
    image: 'ipfs://bafybeig…/collection.png',
    banner_image: 'ipfs://bafybeig…/banner.png',
    external_link: 'https://yourdomain.com',
  }
}

/** Hands the browser a JSON file to save, with no server round trip. */
const downloadJson = (filename, object) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Sample files to start from, beside the preview: the collection document in this standard's
 * shape, and — for numbered collections — the token files the uploader would write.
 * @param {{ isLukso: boolean, isNumbered: boolean, standardId: number, name: string }} props
 */
function DownloadsBox({ isLukso, isNumbered, standardId, name }) {
  const sample = useMemo(() => sampleCollectionDocument({ isLukso, name }), [isLukso, name])
  const sampleText = JSON.stringify(sample, null, 2)

  return (
    <section className={styles.studio__column} aria-labelledby="studio-downloads-title">
      <div className={styles.studio__columnHead}>
        <h2 id="studio-downloads-title">Downloads</h2>
        <p>Sample files to copy from — the same shapes the editors write.</p>
      </div>
      <ul className={styles.studio__downloads}>
        <li>
          <FileTextIcon size={18} aria-hidden="true" />
          <span>
            <strong>Collection document</strong>
            <small>{isLukso ? 'LSP4Metadata JSON' : 'ERC-7572 contract JSON'} — name, description, images, links</small>
          </span>
          <span className={styles.studio__downloadActions}>
            <CopyButton value={sampleText} title="Copy the sample" size={13} />
            <button type="button" onClick={() => downloadJson('collection-metadata.json', sample)}>
              <DownloadSimpleIcon size={13} weight="bold" aria-hidden="true" />
              JSON
            </button>
          </span>
        </li>
        {isNumbered && (
          <li>
            <FolderSimpleIcon size={18} aria-hidden="true" />
            <span>
              <strong>Token files</strong>
              <small>Three numbered example images with their traits file, plus a README — uploads as it is</small>
            </span>
            <span className={styles.studio__downloadActions}>
              <a href={`/api/v1/drops/sample?standard=${standardId}&name=${encodeURIComponent(name || "")}`} download>
                <DownloadSimpleIcon size={13} weight="bold" aria-hidden="true" />
                ZIP
              </a>
            </span>
          </li>
        )}
      </ul>
    </section>
  )
}

/**
 * One collection the wallet can manage, as a tile: square art from its metadata, the chain riding
 * over the corner in its own colour, the name and standard underneath. A Hup drop also carries the
 * way to its drop page, where the mint controls still live.
 * @param {{ asset: Object, onOpen: Function }} props
 */
function CollectionTile({ asset, onOpen }) {
  const chainInfo = appChains.find((c) => c.id === asset.networkId)
  // LUKSO metadata nests under LSP4Metadata; contractURI JSON is flat
  const { data: metadata } = useSWR(asset.metadataUri || null, metadataFetcher, { revalidateOnFocus: false })
  const body = metadata?.LSP4Metadata ?? metadata
  const artwork = pickImageUrl(body?.images) || pickImageUrl(body?.image) || pickImageUrl(body?.icon) || ''
  const name = asset.name || body?.name || 'Untitled collection'
  const icon = chainIconFor(chainInfo)
  const supply =
    asset.maxSupply === undefined
      ? null
      : asset.closed
        ? 'Closed'
        : asset.maxSupply === 0
          ? `${countFormat.format(asset.minted)} minted · open edition`
          : `${countFormat.format(asset.minted)} / ${countFormat.format(asset.maxSupply)} minted`

  return (
    // Colours come from the collection's chain, not the connected wallet's
    <li className={styles.studio__tile} style={networkColorStyle(chainInfo)}>
      <button type="button" className={styles.studio__tileOpen} onClick={() => onOpen(asset)} title={`Open ${name} in the studio`}>
        <span className={styles.studio__tileArt}>
          {artwork ? <img src={resolveStorageImageUrl(artwork, { width: 384, still: true })} alt="" loading="lazy" onError={handleBrokenImage} /> : <HupMark size={26} />}
        </span>
        <span className={styles.studio__tileBody}>
          <strong>{name}</strong>
          <small>
            {asset.symbol ? `${asset.symbol} · ` : ''}
            {asset.kind}
            {asset.dropId ? ` · Drop #${asset.dropId}` : ''}
          </small>
          {supply && <small>{supply}</small>}
        </span>
      </button>
      <span className={styles.studio__tileChain} aria-hidden="true">
        {icon ? <img src={icon} alt="" /> : null}
        {chainInfo?.name}
      </span>
      {asset.dropId && (
        <Link href={`/drops/${asset.networkId}/${asset.dropId}`} className={styles.studio__tileManage} title="Phases, payout and closing live on the drop page">
          Manage drop
        </Link>
      )}
    </li>
  )
}

/* LSP8 gives every token its own ERC725Y store, and a value there wins over the collection's
   base URI for that token alone. Owner-gated by the standard, like setData. */
const SET_DATA_FOR_TOKEN_ABI = [
  {
    name: 'setDataForTokenId',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes' }],
    outputs: [],
  },
]

const SET_DATA_ABI = [
  { name: 'setData', type: 'function', stateMutability: 'payable', inputs: [{ type: 'bytes32' }, { type: 'bytes' }], outputs: [] },
  { name: 'setDataBatch', type: 'function', stateMutability: 'payable', inputs: [{ type: 'bytes32[]' }, { type: 'bytes[]' }], outputs: [] },
]

const SUPPORTS_INTERFACE_ABI = [
  { name: 'supportsInterface', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
]

const setterAbi = (signature) => {
  const [fn, args] = signature.replace(')', '').split('(')
  return [{ name: fn, type: 'function', stateMutability: 'nonpayable', inputs: args.split(',').map((type) => ({ type })), outputs: [] }]
}

// Hup's ERC721 drop collection sets base and suffix together; every other setter takes one string
const BASE_AND_SUFFIX_SETTER = 'setBaseURI(string,string)'

// Everything typed for one collection, tagged with its address so pasting another starts clean
const EMPTY_DRAFT = { address: null, base: '', suffix: '', contractUri: '', creator: '' }

/**
 * Collection studio: the one place a collection's metadata is managed.
 *
 * Paste any NFT contract and, if the connected wallet owns it, change what its tokens point at —
 * whether or not the collection was ever launched here. On LUKSO that covers essentially
 * everything, because every LSP7 and LSP8 is ERC725Y and its `setData` is owner-gated by the
 * standard itself. On ERC721 it depends on what the deployer chose to expose, which is why the
 * probe reports "immutable" as a real answer rather than offering an editor that would revert.
 *
 * It opens on the collection as the world sees it — banner, icon, story, links, the token grid —
 * so a creator can look before touching anything, and so anyone can browse a collection here
 * even when the editors stay shut for them.
 */
export default function CollectionStudio() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address, chain: walletChain } = useConnection()

  // A linked collection (`?network=42&address=0x…`) opens directly, ahead of the wallet's own chain
  const paramChain = Number(searchParams.get('network'))
  const paramAddress = searchParams.get('address') || ''
  /*
   * Otherwise opens on the chain the wallet is already on, and on LUKSO failing that. The old
   * default was simply the first entry in appChains — Ethereum — where the issued-collections
   * list cannot apply at all, so the page loaded with its most useful section invisible.
   */
  const [chainId, setChainId] = useState(() => {
    if (appChains.some((c) => c.id === paramChain)) return paramChain
    const connected = appChains.find((c) => c.id === walletChain?.id)
    return connected?.id ?? appChains.find((c) => isLuksoChain(c.id))?.id ?? appChains[0]?.id ?? 1
  })
  const [input, setInput] = useState(() => (isAddress(paramAddress) ? paramAddress : ''))

  const target = useMemo(() => (isAddress(input.trim()) ? input.trim() : null), [input])

  // Keep the URL in step with what is on screen, quietly — no history entry per keystroke
  useEffect(() => {
    const query = new URLSearchParams()
    if (target) {
      query.set('network', String(chainId))
      query.set('address', target)
    }
    const next = query.toString()
    if (next !== searchParams.toString()) router.replace(next ? `/nfts/studio?${next}` : '/nfts/studio', { scroll: false })
  }, [chainId, target, router, searchParams])
  const publicClient = usePublicClient({ chainId })
  const [current, setCurrent] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  /*
   * Two sources, neither authoritative. LSP12IssuedAssets[] is what a Universal Profile says it
   * created — LUKSO only, and self-declared, so a tool that never wrote the entry leaves no trace.
   * The drops index is what this wallet launched through HupDrops on any chain; the engine
   * deploys the collection itself and never touches the creator's profile, so every Hup drop is
   * missing from the first list, which is why the second exists. Ownership can move without
   * either source noticing; the probe below decides what is actually editable.
   */
  // Every chain at once — the network picker scopes the search box, never this list
  const issued = useIssuedAssets({ profile: address, chainId: LUKSO_MAINNET_ID, enabled: Boolean(address) })
  const { data: dropsRes } = useSWR(address ? `/api/v1/drops?creator=${address.toLowerCase()}&limit=60` : null, fetcher)
  const mine = useMemo(() => {
    const rows = []
    const seen = new Set()
    const push = (row) => {
      const key = `${row.networkId}:${row.address.toLowerCase()}`
      if (seen.has(key)) return
      seen.add(key)
      rows.push(row)
    }
    for (const drop of dropsRes?.data ?? []) {
      push({
        networkId: Number(drop.network_id),
        address: drop.collection,
        name: drop.name,
        symbol: drop.symbol,
        kind: dropStandardLabel(drop.standard_id),
        dropId: drop.drop_id,
        metadataUri: drop.metadata_uri,
        minted: Number(drop.minted ?? 0),
        maxSupply: Number(drop.max_supply ?? 0),
        closed: Boolean(Number(drop.closed)),
      })
    }
    for (const asset of issued.assets) {
      if (asset.owner && address && asset.owner.toLowerCase() === address.toLowerCase()) {
        push({ networkId: LUKSO_MAINNET_ID, address: asset.address, name: asset.name, symbol: asset.symbol, kind: asset.isLsp8 ? 'LSP8' : 'LSP7' })
      }
    }
    return rows
  }, [dropsRes, issued.assets, address])

  const listPending = Boolean(address) && (!dropsRes || issued.status === 'loading')

  // A tile opens its collection here: the network follows the tile, not the picker
  const pickCollection = (asset) => {
    setChainId(asset.networkId)
    setInput(asset.address)
  }

  const query = input.trim()
  const { data: suggestions } = useSWR(
    query.length >= 2 && !isAddress(query) ? `/api/v1/nfts/collections/search?q=${encodeURIComponent(query)}&networkId=${chainId}` : null,
    fetcher,
  )
  const matches = suggestions?.data ?? []
  const probe = useCollectionProbe({ address: target, chainId, wallet: address })
  // Only once the probe has said nothing lives here: the address is usually right and the network wrong
  const presence = useContractChains({ address: target, chainId, enabled: probe.status === 'empty' })
  const foundElsewhere = presence.elsewhere.map((id) => appChains.find((c) => c.id === id)).filter(Boolean)
  const { writeContractAsync, isPending } = useWriteContract()
  const collectionRefresh = useCollectionMetadataRefresh({ chainId, collection: probe.address })

  // Defaulted because the probe has no capabilities until it is ready, and several eagerly
  // evaluated consts below read from it on the very first render
  const caps = probe.capabilities ?? {}
  const chain = appChains.find((c) => c.id === chainId)
  const chainIcon = chainIconFor(chain)
  const ready = probe.status === 'ready'
  const isLsp8 = probe.kind === COLLECTION_KIND.LSP8
  const isLsp7 = probe.kind === COLLECTION_KIND.LSP7
  const isLukso = isLuksoKind(probe.kind)
  // Numbered kinds resolve base + id and have a grid worth walking; editions share one document
  const isNumbered = isLsp8 || probe.kind === COLLECTION_KIND.ERC721
  const isEditions = isLsp7 || probe.kind === COLLECTION_KIND.ERC1155

  /*
   * Read the existing document once the probe knows what it is looking at — LSP4Metadata for the
   * LUKSO kinds, the contractURI card for ERC. The editors rewrite the whole file on save, so
   * opening them blank would quietly wipe every field the creator had not retyped — seeding
   * first is what makes "edit" mean edit. The preview up top reads the same document.
   */
  useEffect(() => {
    if (probe.status !== 'ready' || !publicClient) return undefined

    let cancelled = false
    const address = probe.address

    /* The document itself, not the display resolvers' reading of it. resolveCollectionMetadata
       answers what a header should paint — it drops a banner that turns out to be the icon
       again, and flattens what it keeps — and an editor seeded from that saved a document with
       the collection's artwork missing. */
    const load = isLuksoKind(probe.kind)
      ? fetchLsp4Document({ publicClient, collection: address })
      : fetchMetadataJson(probe.contractUri)

    load
      // Tagged with the address it describes rather than clearing state first, so a document
      // that arrives after the user has pasted a different contract is ignored instead of
      // briefly rendering under the wrong collection.
      .then((data) => !cancelled && setCurrent({ address, data: data ?? {} }))
      // An unreachable document is not a reason to block the editor — it opens on the onchain
      // name instead, which is the honest starting point when the pointer resolves to nothing.
      .catch(() => !cancelled && setCurrent({ address, data: {} }))

    return () => {
      cancelled = true
    }
  }, [probe.status, probe.kind, probe.address, probe.contractUri, publicClient])

  // Both sides are undefined before anything is pasted, and `undefined === undefined` is true —
  // so the identity check alone is not enough to prove there is a document to read.
  const currentDoc = current && probe.address && current.address === probe.address ? current.data : null

  // LSP4Creators[] — who made this, as the collection itself declares it. Read for everyone,
  // since the preview shows it; written only by the owner, further down.
  const creatorsEnabled = ready && isLukso
  const { data: creatorsCountRaw, refetch: refetchCreatorsCount } = useReadContract({
    address: probe.address,
    abi: erc725yGetDataAbi,
    functionName: 'getData',
    args: [LSP4_DATA_KEYS.creators],
    chainId,
    query: { enabled: creatorsEnabled },
  })
  const creatorsCount = creatorsCountRaw && creatorsCountRaw !== '0x' ? Number(BigInt(creatorsCountRaw)) : 0
  const { data: creatorEntries, refetch: refetchCreatorEntries } = useReadContracts({
    contracts: Array.from({ length: Math.min(creatorsCount, MAX_DROP_CREATORS) }, (_, index) => ({
      address: probe.address,
      abi: erc725yGetDataAbi,
      functionName: 'getData',
      args: [creatorsElementKeyAt(index)],
      chainId,
    })),
    query: { enabled: creatorsEnabled && creatorsCount > 0 },
  })
  // getData returns raw bytes; a creator entry is a bare 20-byte address
  const creators = (creatorEntries ?? []).map((entry) => entry?.result).filter((value) => typeof value === 'string' && value.length === 42)

  const [draftState, setDraftState] = useState(EMPTY_DRAFT)
  const draft = draftState.address === probe.address ? draftState : EMPTY_DRAFT
  const patchDraft = (patch) =>
    setDraftState((prev) => ({ ...(prev.address === probe.address ? prev : EMPTY_DRAFT), ...patch, address: probe.address }))

  const [isSavingCreators, setIsSavingCreators] = useState(false)
  // The link a creator chose to save despite the folder check failing on it — a second press means it
  const shortFolderAcceptedRef = useRef(null)
  // The token opened from a read-only grid, shown the way a collector sees it
  const [previewToken, setPreviewToken] = useState(null)

  /*
   * What the collection looks like from outside, read off the same document the editors rewrite.
   * Each picture keeps its own slot — the wide banner, the main artwork, the small icon — so a
   * creator sees exactly what is set and what is missing. The wide slot never borrows the square
   * artwork the way the market header does: cropped into a strip it would show nothing anyway.
   */
  const preview = useMemo(() => {
    const doc = currentDoc ?? {}
    const artwork = pickImageUrl(doc.images) || pickImageUrl(doc.image) || pickImageUrl(doc.image_url)
    const links = Array.isArray(doc.links)
      ? doc.links.filter((link) => link && typeof link.url === 'string' && link.url.trim())
      : doc.external_link
        ? [{ title: '', url: String(doc.external_link) }]
        : []
    return {
      name: (typeof doc.name === 'string' && doc.name.trim()) || probe.name || '',
      description: typeof doc.description === 'string' ? doc.description.trim() : '',
      // Wallets fall back to the artwork where no icon is set, so the preview does the same
      icon: pickImageUrl(doc.icon) || artwork,
      artwork,
      banner: pickImageUrl(doc.backgroundImage) || pickImageUrl(doc.banner_image) || pickImageUrl(doc.banner_image_url),
      links: links.slice(0, 6),
    }
  }, [currentDoc, probe.name])

  // The document as the file holds it: LSP4 wraps its fields, so the wrapper goes back on before
  // anyone copies it as a starting point for their own
  const documentText = useMemo(() => {
    if (!currentDoc || Object.keys(currentDoc).length === 0) return null
    return JSON.stringify(isLukso ? { LSP4Metadata: currentDoc } : currentDoc, null, 2)
  }, [currentDoc, isLukso])

  const minted = probe.totalMinted ?? probe.totalSupply
  const supplyLabel =
    minted === null || minted === undefined
      ? null
      : probe.supplyCap
        ? `${countFormat.format(Number(minted))} of ${countFormat.format(probe.supplyCap)} minted`
        : `${countFormat.format(Number(minted))} minted`

  /** A wallet's refusal, said the way the rest of the app says it, for the editors' own toasts. */
  const write = async (request) => {
    try {
      return await writeContractAsync(request)
    } catch (err) {
      throw new Error(describeWalletError(err, { fallback: 'Transaction rejected' }))
    }
  }

  /*
   * The collection page reads its card from a cache that is allowed to be a day old, so a save
   * here would not show there until tomorrow. Asked to re-read once the block has had time to
   * land — a request too early would cache the old document all over again.
   */
  const refreshMarketCard = (address) => {
    setTimeout(() => fetch(`/api/v1/nfts/collections/${chainId}/${address.toLowerCase()}`, { method: 'POST' }).catch(() => {}), 8000)
  }

  const saveLsp4 = async (verifiableUri) => {
    await write({ address: probe.address, abi: SET_DATA_ABI, functionName: 'setData', args: [LSP4_METADATA_KEY, verifiableUri], chainId })
    toast('Collection updated', 'success')
    refreshMarketCard(probe.address)
    probe.refetch()
  }

  /**
   * A hosted link is only saved once the file behind it has the shape of a collection card. The
   * mistake this catches is real: a token manifest — a list — pasted as the card, which the chain
   * accepts and every page then shows as nothing. A second press saves it anyway.
   */
  const documentLooksLikeCard = async (value) => {
    if (value.startsWith('data:') || shortFolderAcceptedRef.current === value) return true
    const checking = toast('Reading the file…', 'loading')
    const json = await fetchMetadataJson(value).catch(() => null)
    checking.dismiss()

    const body = json?.LSP4Metadata ?? json
    const isList = Array.isArray(json) || Array.isArray(body)
    const looksLikeCard = body && typeof body === 'object' && !isList && (typeof body.name === 'string' || body.image || body.images || body.icon || body.description)
    if (looksLikeCard) return true

    shortFolderAcceptedRef.current = value
    toast(
      isList
        ? 'That file is a list of tokens, not a collection document. The collection is described by one document with a name, description and image; token files belong under Token files. Save again to point the collection there anyway.'
        : json
          ? 'That file has none of a collection document’s fields — name, description, image. Save again to point the collection there anyway.'
          : `Nothing readable answers at that link yet — check it. Save again to point the collection there anyway.`,
      'error',
    )
    return false
  }

  const saveTokenMetadata = async (tokenIdBytes, verifiableUri) => {
    const hash = await write({
      address: probe.address,
      abi: SET_DATA_FOR_TOKEN_ABI,
      functionName: 'setDataForTokenId',
      args: [tokenIdBytes, LSP4_METADATA_KEY, verifiableUri],
      chainId,
    })
    toast('Token metadata updated', 'success')
    // Handed back so the editor can wait for the block before asking the cache to re-read this token
    return hash
  }

  // ERC collection card: the setter signature is whatever the probe found in the bytecode
  const saveContractUri = async (uri) => {
    const signature = caps.collectionMethod
    if (!signature) return
    await write({ address: probe.address, abi: setterAbi(signature), functionName: signature.split('(')[0], args: [uri], chainId })
    toast('Collection updated', 'success')
    refreshMarketCard(probe.address)
    probe.refetch()
  }

  /** Publishes a new LSP4Creators[] list on the collection. */
  const saveCreators = async (nextAddresses) => {
    if (!publicClient) return
    setIsSavingCreators(true)
    try {
      // A Universal Profile and an EOA get different map entries, so each address is probed for LSP0
      const withInterfaces = await Promise.all(
        nextAddresses.map(async (entry) => {
          const supported = await publicClient
            .readContract({ address: entry, abi: SUPPORTS_INTERFACE_ABI, functionName: 'supportsInterface', args: [INTERFACEID_LSP0] })
            .catch(() => false)
          return { address: entry, interfaceId: supported ? INTERFACEID_LSP0 : '0x00000000' }
        }),
      )
      const { keys, values } = encodeCreatorsWrites(withInterfaces, creators)
      // LSP4Creators[] is a whole-array rewrite in one setDataBatch
      await writeContractAsync({ address: probe.address, abi: SET_DATA_ABI, functionName: 'setDataBatch', args: [keys, values], chainId })
      toast('Creators updated', 'success')
      patchDraft({ creator: '' })
      // Once now, once after the block lands — the first read usually beats the chain
      const refetch = () => {
        refetchCreatorsCount()
        refetchCreatorEntries()
      }
      refetch()
      setTimeout(refetch, 6000)
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Updating the creators failed' }), 'error')
    } finally {
      setIsSavingCreators(false)
    }
  }

  /**
   * Asks the folder for its first and last file before the link goes onchain. A set that
   * answers for token 1 but not for the last number is exactly how a collection ends up with
   * the collection's image standing in for most of its tokens — and nobody notices until a
   * collector does. The shared-document placeholder is the one shape where a single file is right.
   */
  const folderCoversTheSet = async (value) => {
    if (!isNumbered || sharesOneTokenDocument(value) || shortFolderAcceptedRef.current === value) return true
    const lastId = Number(probe.supplyCap || probe.totalMinted || probe.totalSupply || 0)
    if (lastId < 1) return true

    const suffix = takesSuffix ? draft.suffix.trim() : ''
    const checking = toast('Checking the folder…', 'loading')
    const [first, last] = await Promise.all([
      fetchMetadataJson(`${value}1${suffix}`).catch(() => null),
      fetchMetadataJson(`${value}${lastId}${suffix}`).catch(() => null),
    ])
    checking.dismiss()
    if (first && (last || lastId === 1)) return true

    shortFolderAcceptedRef.current = value
    toast(
      first
        ? `That link has a file for token #1 but none for #${lastId} — the set looks short or misnamed. Save again to point the tokens there anyway.`
        : `Nothing answers at ${value}1${suffix} yet — check the link. Save again to point the tokens there anyway.`,
      'error',
    )
    return false
  }

  // Nothing onchain tells the app's metadata cache that the tokens changed; the owner who just
  // re-pointed them is the only signal there is, so the sweep runs here instead of waiting out the TTL.
  const sweepTokenCache = async () => {
    const handle = toast('Saved onchain — re-reading the tokens…', 'loading')
    const show = (message, type) => {
      if (!handle.update(message, type)) toast(message, type)
    }
    try {
      const result = await collectionRefresh.refresh()
      if (!result) return show('Saved onchain', 'success')
      if (result.total > 0 && result.done === 0) {
        return show('Saved onchain. The cached tokens were read moments ago — refresh them from the collection page in a few minutes', 'info')
      }
      const [message, type] = describeCollectionRefresh(result)
      show(`Saved onchain. ${message}`, type)
    } catch (err) {
      show(`Saved onchain, but the cached tokens could not be refreshed: ${err.message || 'try again from the collection page'}`, 'error')
    }
  }

  const handleSave = async () => {
    const value = draft.base.trim()
    if (!value) return
    // Editions point at one document, so it is checked as a card; numbered kinds point at a folder
    if (isEditions ? !(await documentLooksLikeCard(value)) : !(await folderCoversTheSet(value))) return

    try {
      if (isLukso) {
        // LSP8 resolves baseURI + tokenId, and the key holds a VerifiableURI rather than a plain
        // string — an unencoded value here produces a collection nothing can read.
        await writeContractAsync({
          address: probe.address,
          abi: SET_DATA_ABI,
          functionName: 'setData',
          args: [isLsp8 ? LSP8_TOKEN_METADATA_BASE_URI_KEY : LSP4_METADATA_KEY, encodeVerifiableURI(value)],
          chainId,
        })
      } else {
        const signature = caps.method
        if (!signature) return
        await writeContractAsync({
          address: probe.address,
          abi: setterAbi(signature),
          functionName: signature.split('(')[0],
          args: signature === BASE_AND_SUFFIX_SETTER ? [value, draft.suffix.trim()] : [value],
          chainId,
        })
      }

      patchDraft({ base: '', suffix: '' })
      probe.refetch()
      sweepTokenCache()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected' }), 'error')
    }
  }

  const handleContractUriSave = async () => {
    const value = draft.contractUri.trim()
    if (!value) return
    if (!(await documentLooksLikeCard(value))) return
    try {
      await saveContractUri(value)
      patchDraft({ contractUri: '' })
    } catch (err) {
      toast(err.message || 'Transaction rejected', 'error')
    }
  }

  const takesSuffix = caps.method === BASE_AND_SUFFIX_SETTER

  /*
   * Which tabs have anything in them. The collection tab needs a document to edit — or, on
   * LUKSO, creators to manage, which stay open even after a freeze. The tokens tab shows the set
   * whenever there is one to look at; whether it can be edited is a second question, answered
   * inside it.
   */
  const canEditCreators = ready && isLukso && Boolean(caps.isOwner)
  const hasCollectionTab = ready && (Boolean(caps.canEditCollection) || canEditCreators)
  const hasTokensTab = ready && (isNumbered || Boolean(caps.canEditTokens))

  /* Offered where the pinned set is guaranteed to resolve: LSP8 appends nothing, and Hup's
     ERC721 lets the suffix be set alongside the base. A foreign ERC721 appends whatever it
     was deployed with, which the uploader's .json files may not match. */
  const hasUploader = Boolean(caps.canEditTokens) && (isLsp8 || takesSuffix)

  // Where token 1 resolves today: the LSP8 base key, or the ERC721 sample the probe read
  const currentPointer = isLsp8 ? decodeVerifiableUri(probe.baseUri) || '' : probe.kind === COLLECTION_KIND.ERC721 ? probe.baseUri || '' : ''
  // The file token 1 actually loads: LSP8 appends the bare number to its base, unless the base is
  // the shared-document placeholder; the ERC721 sample is already the whole address
  const tokenOneUri = isLsp8 && currentPointer && !sharesOneTokenDocument(currentPointer) ? `${currentPointer}1` : currentPointer
  // The collection's own document, as the chain holds the pointer today
  const currentDocumentUri = isLukso ? decodeVerifiableUri(probe.lsp4Metadata) || '' : probe.contractUri || ''
  const erc721Folder = probe.kind === COLLECTION_KIND.ERC721 ? splitTokenOneUri(probe.baseUri) : { base: '', suffix: '' }
  const busy = isPending || isSavingCreators

  // The raw pointer. For LSP8 and ERC721 it is the tokens' base; for LSP7 and ERC1155 it is the
  // one document every copy shares. Headings come from its consumers.
  const uriEditor = (
    <>
      <label className={styles.studio__editor}>
        <span>
          {isEditions
            ? 'The link every copy loads its details from'
            : hasUploader
              ? 'The folder link — filled in by an upload above, or paste one you host, ending in /'
              : 'A folder link every token loads from, ending in /'}
        </span>
        <input
          type="text"
          value={draft.base}
          spellCheck={false}
          placeholder={isEditions ? 'ipfs://…' : 'ipfs://…/'}
          onChange={(e) => patchDraft({ base: e.target.value })}
        />
        <small>
          {isLsp7 ? (
            <>
              Replaces whatever the editor above saved. (Stored on <code>LSP4Metadata</code> as a VerifiableURI.)
            </>
          ) : isEditions ? (
            <>Every copy shows this one file.</>
          ) : (
            <>
              Token 1 will load from <code>{`${draft.base || 'ipfs://…/'}1${takesSuffix ? draft.suffix : ''}`}</code>
              {isLukso
                ? ' — LSP8 adds the number and nothing else, so no file extension.'
                : takesSuffix
                  ? ' — the number, then the ending below.'
                  : ' plus whatever ending this contract adds.'}
            </>
          )}
        </small>
      </label>

      {takesSuffix && (
        <label className={styles.studio__editor}>
          <span>File ending</span>
          <input type="text" value={draft.suffix} spellCheck={false} placeholder=".json" onChange={(e) => patchDraft({ suffix: e.target.value })} />
          <small>
            Added after the number. The upload above writes its files as <code>1.json</code>, <code>2.json</code>, … so keep .json unless you host a folder of
            your own.
          </small>
        </label>
      )}

      <button type="button" className={styles.studio__save} onClick={handleSave} disabled={busy || !draft.base.trim()}>
        {isPending ? 'Saving…' : 'Save'}
      </button>
    </>
  )

  // The raw pointer for the ERC card, mirroring uriEditor: paste a document you already host
  // instead of pinning one through the editor above.
  const contractUriEditorRaw = (
    <>
      <label className={styles.studio__editor}>
        <span>Already host a metadata file? Paste its link and the collection uses it as-is</span>
        <input
          type="text"
          value={draft.contractUri}
          spellCheck={false}
          placeholder={probe.contractUri || 'ipfs://…'}
          onChange={(e) => patchDraft({ contractUri: e.target.value })}
        />
        <small>
          Replaces whatever the editor above saved. (Written onchain via <code>{caps.collectionMethod}</code>.)
        </small>
      </label>

      <button type="button" className={styles.studio__save} onClick={handleContractUriSave} disabled={busy || !draft.contractUri.trim()}>
        {isPending ? 'Saving…' : 'Save'}
      </button>
    </>
  )

  const creatorsPanel = canEditCreators && (
    <section className={styles.studio__card}>
      <div className={styles.studio__cardHead}>
        <h2>Creators</h2>
        <p>Credited on the collection itself, and shown wherever it appears.</p>
      </div>
      {creators.length > 0 && (
        <ul className={styles.studio__creatorList}>
          {creators.map((entry) => (
            <li key={entry}>
              <Profile creator={entry} networkId={chainId} variant="compact" size={28} />
              <button
                type="button"
                onClick={() => saveCreators(creators.filter((value) => value !== entry))}
                disabled={busy}
                aria-label={`Remove ${entry} from the creators`}
              >
                <XIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {creators.length < MAX_DROP_CREATORS && (
        <div className={styles.studio__creatorAdd}>
          <input
            type="text"
            value={draft.creator}
            placeholder="0x… collaborator"
            onChange={(e) => patchDraft({ creator: e.target.value.trim() })}
            disabled={busy}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => saveCreators([...creators, draft.creator])}
            disabled={busy || !isAddress(draft.creator) || creators.some((entry) => entry.toLowerCase() === draft.creator.toLowerCase())}
          >
            {isSavingCreators ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}
      <small className={styles.studio__note}>
        Written to the collection as <code>LSP4Creators[]</code>, which wallets and marketplaces read as who made this. Stays
        editable after a freeze.
      </small>
    </section>
  )

  const collectionPanel = hasCollectionTab && (
    <>
      <p className={styles.studio__note}>
        <InfoIcon size={14} /> The collection’s card — its name, story and cover images, as the collection page and marketplaces
        show them. Changing it never changes what any token looks like; that is the Token files tab.
      </p>
      {!caps.canEditCollection ? (
        <p className={clsx(styles.studio__note, styles['studio__note--bad'])}>
          <LockSimpleIcon size={14} weight="fill" /> This collection’s document is frozen — what the preview shows is final.
        </p>
      ) : currentDoc ? (
        isLukso ? (
          <Lsp4MetadataEditor key={probe.address} current={currentDoc} name={probe.name} busy={busy} onSave={saveLsp4} />
        ) : (
          <ContractUriEditor key={probe.address} current={currentDoc} name={probe.name} busy={busy} onSave={saveContractUri} />
        )
      ) : (
        <p className={styles.studio__note}>Reading the current metadata…</p>
      )}
      {creatorsPanel}
      {caps.canEditCollection && (isLsp7 || !isLukso) && (
        <details className={styles.studio__advanced}>
          <summary>Advanced — point the collection at a file you host yourself</summary>
          <div>
            <p className={styles.studio__current}>
              Currently pointing at <CurrentLink uri={currentDocumentUri} />
            </p>
            <LinkExamples kind="document" />
            {isLsp7 ? uriEditor : contractUriEditorRaw}
          </div>
        </details>
      )}
    </>
  )

  // The set first, then how to change it — each in its own card, so looking and doing never
  // run into each other on the page
  const tokensPanel = hasTokensTab && (
    <>
      {isNumbered && (
        <section className={styles.studio__card}>
          <div className={styles.studio__cardHead}>
            <h2>Tokens</h2>
            <p>
              {caps.canEditTokens
                ? isLsp8
                  ? 'What the tokens themselves show. Open one to give it metadata of its own; the whole set changes below.'
                  : 'What the tokens themselves show. On this standard a token cannot be edited on its own — every token follows the folder link below.'
                : 'What the tokens themselves show. Open one to see it the way collectors do.'}
            </p>
          </div>

          {/* Keyed per collection so its thumbnail and page state never carry over to the next */}
          <TokenMetadataEditor
            key={`${chainId}:${probe.address}`}
            collection={probe.address}
            chainId={chainId}
            cap={probe.supplyCap}
            mintedCount={probe.totalMinted === null ? undefined : Number(probe.totalMinted)}
            baseUri={isLsp8 ? currentPointer : erc721Folder.base}
            uriSuffix={isLsp8 ? '' : erc721Folder.suffix}
            isLsp8={isLsp8}
            editable={isLsp8 && Boolean(caps.canEditTokens)}
            busy={busy}
            onSave={saveTokenMetadata}
            onPreview={setPreviewToken}
          />
        </section>
      )}

      {caps.canEditTokens && (
        <section className={styles.studio__card}>
          <div className={styles.studio__cardHead}>
            <h2>{isEditions ? 'Shared metadata link' : 'Where the tokens point'}</h2>
            {isNumbered && (
              <p>
                {currentPointer ? (
                  <>
                    Token #1 currently loads from <CurrentLink uri={tokenOneUri} />.{' '}
                    {sharesOneTokenDocument(currentPointer)
                      ? 'That’s the single-artwork placeholder — every token shares it until you point them at a set of their own.'
                      : 'Each token resolves to its own file.'}
                  </>
                ) : (
                  'Nothing is set yet — the tokens resolve to nothing until you point them somewhere.'
                )}
              </p>
            )}
          </div>

          {/* Said before anything is uploaded: what a new link does, and what it leaves alone */}
          {isNumbered && (
            <p className={styles.studio__alert}>
              <WarningIcon size={14} weight="fill" aria-hidden="true" />
              <span>
                Saving a new link here moves <strong>every token that has no metadata of its own</strong> at once.
                {isLsp8
                  ? ' Tokens you have edited one by one keep their own metadata and are not affected — and editing one token never touches the rest.'
                  : ''}
              </span>
            </p>
          )}

          {hasUploader && (
            // The bulk uploader never knew it was talking to a Hup drop; it pins artwork or finished
            // files and hands back a CID, which is exactly what this card needs
            <DropArtworkUpload
              standardId={isLsp8 ? DROP_STANDARDS.LSP8 : DROP_STANDARDS.ERC721}
              // The declared ceiling is what a folder has to cover — counting what has been minted
              // so far called a complete set short on every collection still mid-mint
              maxSupply={probe.supplyCap || Number(probe.totalSupply ?? 0)}
              collectionName={probe.name ?? ''}
              disabled={busy}
              onPinned={({ cid, suffix }) => patchDraft({ base: `ipfs://${cid}/`, suffix: suffix ?? '' })}
            />
          )}

          {uriEditor}

          {isNumbered && (
            <details className={styles.studio__advanced}>
              <summary>Which links work here?</summary>
              <div>
                {/* A foreign ERC721 appends whatever it was deployed with, which the studio cannot read */}
                <LinkExamples kind="folder" suffix={isLsp8 ? '' : takesSuffix ? draft.suffix.trim() || '.json' : null} />
              </div>
            </details>
          )}
        </section>
      )}
    </>
  )

  return (
    <div className={styles.studio} style={networkColorStyle(chain)}>
      {/* The opening band is dropped the moment an address is being read — a pitch above a
          spinner is noise to someone who already arrived with a collection */}
      {!target && <StudioSplash />}

      {/* The bar: the network scopes the search box only. Everything this wallet owns is listed
          below across every chain, and a pasted address is looked for on the others when it is
          not on this one. */}
      <div className={styles.studio__bar}>
        <div className={styles.studio__lookup}>
          <NativePopover
            placement="bottom-start"
            className={styles.studio__networkMenu}
            trigger={
              <button type="button" className={styles.studio__network} aria-label={`Search on: ${chain?.name ?? ''}`} title="Which network the search box and a pasted address are read on">
                {chainIcon ? <img src={chainIcon} alt="" /> : null}
                <span>{chain?.name ?? 'Network'}</span>
                <CaretDownIcon size={13} weight="bold" aria-hidden="true" />
              </button>
            }
          >
            {({ close }) => (
              <ul>
                {appChains.map((c) => {
                  const icon = chainIconFor(c)
                  const isActive = c.id === chainId
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={clsx(isActive && styles['studio__networkOption--active'])}
                        onClick={() => {
                          setChainId(c.id)
                          close()
                        }}
                      >
                        {icon ? <img src={icon} alt="" /> : <span aria-hidden="true">{c.name.slice(0, 1)}</span>}
                        <span>{c.name}</span>
                        {isActive && <CheckIcon size={13} weight="bold" aria-hidden="true" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </NativePopover>

          <div className={styles.studio__search}>
            <span className={styles.studio__field}>
              <MagnifyingGlassIcon size={15} />
              <input
                type="text"
                value={input}
                spellCheck={false}
                placeholder="Search a collection, or paste a contract address"
                onChange={(e) => {
                  setInput(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                // Delayed so a click on a suggestion lands before the list unmounts
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />
            </span>

            {showSuggestions && matches.length > 0 && (
              <ul className={styles.studio__suggestions}>
                {matches.map((row) => (
                  <li key={`${row.network_id}:${row.collection}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setChainId(row.network_id)
                        setInput(row.collection)
                        setShowSuggestions(false)
                      }}
                    >
                      {row.icon_uri ? (
                        <img src={resolveStorageImageUrl(row.icon_uri)} alt="" onError={handleBrokenImage} />
                      ) : (
                        <span className={styles.studio__suggestionMark} aria-hidden="true">
                          {(row.name || '?').slice(0, 1)}
                        </span>
                      )}
                      <span>
                        <strong>{row.name || 'Untitled collection'}</strong>
                        <small>
                          {row.symbol ? `${row.symbol} · ` : ''}
                          {row.is_lsp8 ? 'LSP8' : 'LSP7'} · {row.collection.slice(0, 6)}…{row.collection.slice(-4)}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Everything the wallet can manage, on every chain, as the tiles the drops page used to
          keep for them — one place, the way the rest of the studio is one place */}
      {!target && mine.length > 0 && (
        <section className={styles.studio__section}>
          <div className={styles.studio__cardHead}>
            <h2>Your collections</h2>
            <p>
              Every collection this wallet launched on Hup, on any network, plus what its Universal Profile issued on LUKSO. Open one
              to manage its metadata; a Hup drop keeps its mint controls on the drop page.
            </p>
          </div>
          <ul className={styles.studio__tiles}>
            {mine.map((asset) => (
              <CollectionTile key={`${asset.networkId}:${asset.address}`} asset={asset} onOpen={pickCollection} />
            ))}
          </ul>
          {issued.truncated && (
            <small className={styles.studio__note}>Showing the first {issued.assets.length} issued assets of {issued.total}.</small>
          )}
        </section>
      )}

      {!target && probe.status === 'idle' && mine.length === 0 && (
        <div className={styles.studio__idle}>
          <StackIcon size={28} aria-hidden="true" />
          {!address ? (
            <p>Connect your wallet to see the collections you can edit — or search above, or paste any contract address.</p>
          ) : listPending ? (
            <p>Looking for collections you own…</p>
          ) : (
            <p>Nothing of yours found on any network yet. Search by name above, or paste a contract address.</p>
          )}
        </div>
      )}

      {input.trim() && !target && <p className={styles.studio__note}>That is not a valid contract address.</p>}
      {probe.status === 'loading' && (
        <div className={styles.studio__loading} aria-live="polite" aria-busy="true">
          <Spinner size="38px" strokeColor="var(--text-muted, #888)" color="var(--text)" />
          <p>Reading {chain?.name}…</p>
        </div>
      )}
      {(probe.status === 'empty' || probe.status === 'error') && (
        <p className={clsx(styles.studio__note, styles['studio__note--bad'])}>
          <WarningIcon size={14} weight="fill" /> {probe.message}
        </p>
      )}
      {probe.status === 'empty' && (presence.isSearching || foundElsewhere.length > 0) && (
        <div className={styles.studio__elsewhere} role="status">
          {presence.isSearching ? (
            <span>Looking for it on the other networks…</span>
          ) : (
            <>
              <span>It does exist on {foundElsewhere.length === 1 ? 'another network' : 'other networks'}:</span>
              {foundElsewhere.map((candidate) => {
                const icon = chainIconFor(candidate)
                return (
                  <button key={candidate.id} type="button" onClick={() => setChainId(candidate.id)}>
                    {icon ? <img src={icon} alt="" /> : null}
                    Switch to {candidate.name}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {ready && (
        <>
          {caps.note && (
            <p className={clsx(styles.studio__note, !caps.canEditTokens && !caps.canEditCollection && styles['studio__note--bad'])}>
              <WarningIcon size={14} /> {caps.note}
            </p>
          )}

          {/* Three containers, one per thing: the card, the token files, and the card as the world
              sees it. A collection is two documents, and this is the page saying so. */}
          <div className={clsx(styles.studio__columns, !hasCollectionTab && styles['studio__columns--noCard'], !hasTokensTab && styles['studio__columns--noTokens'])}>
            {hasCollectionTab && (
              <section className={clsx(styles.studio__column, styles['studio__column--card'])} aria-labelledby="studio-card-title">
                <div className={styles.studio__columnHead}>
                  <h2 id="studio-card-title">1 · Collection</h2>
                  <p>
                    One document — the name, story and cover images. It is what the collection page and marketplaces show, and it never
                    changes what a token looks like.
                  </p>
                  <small>
                    Now: <CurrentLink uri={currentDocumentUri} />
                  </small>
                  {/* The document behind the link, as the chain serves it — to read, and to copy as a starting point */}
                  {documentText && (
                    <details className={styles.studio__document}>
                      <summary>Show the document</summary>
                      <div>
                        <span className={styles.studio__documentBar}>
                          <CopyButton value={documentText} title="Copy the document" copiedTitle="Copied" label="Copy" variant="chip" size={13} />
                        </span>
                        <pre>{documentText}</pre>
                      </div>
                    </details>
                  )}
                </div>
                {collectionPanel}
              </section>
            )}

            {hasTokensTab && (
              <section className={clsx(styles.studio__column, styles['studio__column--tokens'])} aria-labelledby="studio-tokens-title">
                <div className={styles.studio__columnHead}>
                  <h2 id="studio-tokens-title">2 · Token files</h2>
                  <p>
                    {isEditions
                      ? 'One file that every copy shares. It is what a collector sees when they open an NFT.'
                      : 'One file per token, found from a folder link plus the token’s number. It is what a collector sees when they open an NFT.'}
                  </p>
                  <small>
                    Now: <CurrentLink uri={isNumbered ? tokenOneUri : currentPointer} />
                  </small>
                </div>
                {tokensPanel}
              </section>
            )}

            <aside className={styles.studio__side}>
              <section className={styles.studio__column} aria-labelledby="studio-preview-title">
              <div className={styles.studio__columnHead}>
                <h2 id="studio-preview-title">Preview</h2>
                <p>The collection as its page shows it — read from what the chain holds right now.</p>
              </div>
              <section className={styles.studio__preview} aria-label="Collection preview">
                <div className={clsx(styles.studio__previewBanner, !preview.banner && styles['studio__previewBanner--empty'])}>
                  {preview.banner && <img src={resolveStorageImageUrl(preview.banner, { width: 1600 })} alt="" onError={handleBrokenImage} />}
                </div>
                <div className={styles.studio__previewBody}>
                  <span className={styles.studio__previewIcon}>
                    {preview.icon ? (
                      <img src={resolveStorageImageUrl(preview.icon, { width: 192, still: true })} alt="" onError={handleBrokenImage} />
                    ) : (
                      <em aria-hidden="true">{(preview.name || '?').slice(0, 1)}</em>
                    )}
                  </span>
                  <div className={styles.studio__previewText}>
                    <h3 className={styles.studio__previewName}>
                      {preview.name || 'Untitled collection'}
                      {probe.symbol && <small>{probe.symbol}</small>}
                    </h3>
                    <ul className={styles.studio__previewChips}>
                      <li>{KIND_LABEL[probe.kind]}</li>
                      <li>
                        {chainIcon ? <img src={chainIcon} alt="" /> : null}
                        {chain?.name}
                      </li>
                      {supplyLabel && <li>{supplyLabel}</li>}
                      {caps.metadataFrozen && (
                        <li className={styles['studio__previewChip--frozen']}>
                          <LockSimpleIcon size={11} weight="fill" aria-hidden="true" /> Frozen
                        </li>
                      )}
                      <li className={clsx(caps.isOwner && styles['studio__previewChip--yours'])}>
                        {caps.isOwner ? 'Yours' : probe.owner ? `Owned by ${shortAddress(probe.owner)}` : 'No owner exposed'}
                      </li>
                    </ul>
                    {creators.length > 0 && (
                      <div className={styles.studio__previewCreators}>
                        {creators.map((entry) => (
                          <Profile key={entry} creator={entry} networkId={chainId} variant="compact" size={22} />
                        ))}
                      </div>
                    )}
                    {currentDoc === null ? (
                      <p className={clsx(styles.studio__previewDescription, styles['studio__previewDescription--empty'])}>Reading the current metadata…</p>
                    ) : preview.description ? (
                      <p className={styles.studio__previewDescription}>{preview.description}</p>
                    ) : (
                      <p className={clsx(styles.studio__previewDescription, styles['studio__previewDescription--empty'])}>No description yet.</p>
                    )}
                    {preview.links.length > 0 && (
                      <ul className={styles.studio__previewLinks}>
                        {preview.links.map((link) => (
                          <li key={link.url}>
                            <a href={link.url} target="_blank" rel="noopener noreferrer">
                              {link.title || hostOf(link.url)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* The collection image — LSP4’s `images` — at a size that reads as the picture rather than a swatch */}
                  {preview.artwork && preview.artwork !== preview.icon && (
                    <figure className={styles.studio__previewArt}>
                      <img src={resolveStorageImageUrl(preview.artwork, { width: 384, still: true })} alt="" onError={handleBrokenImage} />
                      <figcaption>Collection</figcaption>
                    </figure>
                  )}
                </div>
                <div className={styles.studio__previewActions}>
                  {isNumbered && (
                    <Link href={`/nfts/${chainId}/collection/${probe.address}`} className={styles.studio__previewAction}>
                      <ArrowSquareOutIcon size={13} aria-hidden="true" /> View collection page
                    </Link>
                  )}
                  <code title={probe.address}>{shortAddress(probe.address)}</code>
                </div>
              </section>
              </section>

              <DownloadsBox isLukso={isLukso} isNumbered={isNumbered} standardId={isLsp8 ? DROP_STANDARDS.LSP8 : DROP_STANDARDS.ERC721} name={preview.name} />
            </aside>
          </div>
        </>
      )}

      {previewToken !== null && ready && (
        <NftDetailModal
          chainId={chainId}
          collection={probe.address}
          tokenId={isLsp8 ? toHex(BigInt(previewToken), { size: 32 }) : String(previewToken)}
          isLsp8={isLsp8}
          collectionName={preview.name}
          // A creator checking their metadata is not hanging it on a wall — that is the market's
          showFrameMode={false}
          onClose={() => setPreviewToken(null)}
        />
      )}
    </div>
  )
}
