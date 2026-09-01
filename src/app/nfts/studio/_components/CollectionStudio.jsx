'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConnection, usePublicClient, useWriteContract } from 'wagmi'
import { isAddress, stringToHex } from 'viem'
import clsx from 'clsx'
import { CaretDownIcon, CheckCircleIcon, CheckIcon, MagnifyingGlassIcon, WarningIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import { appChains } from '@/config/contracts'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { COLLECTION_KIND, KIND_LABEL, isLuksoKind } from '@/lib/collectionProbe'
import { isLuksoChain } from '@/lib/drops'
import { encodeVerifiableURI } from '@/lib/drops'
import { useCollectionProbe } from '@/hooks/useCollectionProbe'
import { useIssuedAssets } from '@/hooks/useIssuedAssets'
import { describeWalletError } from '@/lib/walletErrors'
import { toast } from '@/components/NextToast'
import DropArtworkUpload from '@/components/DropArtworkUpload'
import NativePopover from '@/components/ui/NativePopover'
import Lsp4MetadataEditor from '@/components/Lsp4MetadataEditor'
import TokenMetadataEditor from '@/components/TokenMetadataEditor'
import { resolveCollectionMetadata } from '@/lib/collectionMetadata'
import styles from './CollectionStudio.module.scss'

const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'
const LSP8_BASE_URI_KEY = '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843'

const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

const fetcher = (url) => fetch(url).then((res) => res.json())

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
]
const setterAbi = (signature) => {
  const [fn, args] = signature.replace(')', '').split('(')
  return [{ name: fn, type: 'function', stateMutability: 'nonpayable', inputs: args.split(',').map((type) => ({ type })), outputs: [] }]
}

/**
 * Collection studio: edit the metadata of any collection the connected wallet owns.
 *
 * Paste any NFT contract and, if the connected wallet owns it, change what its tokens point at —
 * whether or not the collection was ever launched here. On LUKSO that covers essentially
 * everything, because every LSP7 and LSP8 is ERC725Y and its `setData` is owner-gated by the
 * standard itself. On ERC721 it depends on what the deployer chose to expose, which is why the
 * probe reports "immutable" as a real answer rather than offering an editor that would revert.
 */
export default function CollectionStudio() {
  const { address, chain: walletChain } = useConnection()
  /*
   * Opens on the chain the wallet is already on, and on LUKSO otherwise. The old default was
   * simply the first entry in appChains — Ethereum — where the issued-collections list cannot
   * apply at all, so the page loaded with its most useful section invisible.
   */
  const [chainId, setChainId] = useState(() => {
    const connected = appChains.find((c) => c.id === walletChain?.id)
    return connected?.id ?? appChains.find((c) => isLuksoChain(c.id))?.id ?? appChains[0]?.id ?? 1
  })
  const [input, setInput] = useState('')
  const [baseUri, setBaseUri] = useState('')

  const target = useMemo(() => (isAddress(input.trim()) ? input.trim() : null), [input])
  const publicClient = usePublicClient({ chainId })
  const [current, setCurrent] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  /*
   * Suggestions come from the collections this app has already read, which makes them a
   * convenience and never an authority — a collection missing from the cache is still perfectly
   * manageable, so the pasted-address path stays open beside them. Skipped once the box holds a
   * complete address, where there is nothing left to suggest.
   */
  /*
   * What this profile says it created, straight off its LSP12IssuedAssets[]. LUKSO only — there
   * is no equivalent on the ERC chains, where pasting an address stays the only route. Offered as
   * a shortcut rather than a source of truth: the array is self-declared, so a collection made
   * with a tool that never wrote the entry will not be here, and one whose ownership has moved
   * still shows up. The probe below decides what is actually editable either way.
   */
  const issued = useIssuedAssets({ profile: address, chainId, enabled: isLuksoChain(chainId) })
  const mine = issued.assets.filter((asset) => asset.owner && address && asset.owner.toLowerCase() === address.toLowerCase())

  const query = input.trim()
  const { data: suggestions } = useSWR(
    query.length >= 2 && !isAddress(query) ? `/api/v1/nfts/collections/search?q=${encodeURIComponent(query)}&networkId=${chainId}` : null,
    fetcher,
  )
  const matches = suggestions?.data ?? []
  const probe = useCollectionProbe({ address: target, chainId, wallet: address })
  const { writeContractAsync, isPending } = useWriteContract()

  const caps = probe.capabilities
  const chain = appChains.find((c) => c.id === chainId)
  const chainIcon = chainIconFor(chain)

  /*
   * Read the existing LSP4 document once the probe knows what it is looking at. The editor
   * rewrites the whole file on save, so opening it blank would quietly wipe every field the
   * creator had not retyped — seeding it first is what makes "edit" mean edit.
   */
  useEffect(() => {
    if (probe.status !== 'ready' || !isLuksoKind(probe.kind) || !publicClient) return undefined

    let cancelled = false
    const address = probe.address

    resolveCollectionMetadata({ publicClient, collection: address, isLsp8: probe.kind === COLLECTION_KIND.LSP8 })
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
  }, [probe.status, probe.kind, probe.address, publicClient])

  // Both sides are undefined before anything is pasted, and `undefined === undefined` is true —
  // so the identity check alone is not enough to prove there is a document to read.
  const currentDoc = current && probe.address && current.address === probe.address ? current.data : null

  const saveLsp4 = async (verifiableUri) => {
    await writeContractAsync({
      address: probe.address,
      abi: SET_DATA_ABI,
      functionName: 'setData',
      args: [LSP4_METADATA_KEY, verifiableUri],
      chainId,
    })
    toast('Collection metadata updated', 'success')
    probe.refetch()
  }

  const saveTokenMetadata = async (tokenIdBytes, verifiableUri) => {
    await writeContractAsync({
      address: probe.address,
      abi: SET_DATA_FOR_TOKEN_ABI,
      functionName: 'setDataForTokenId',
      args: [tokenIdBytes, LSP4_METADATA_KEY, verifiableUri],
      chainId,
    })
    toast('Token metadata updated', 'success')
  }

  const handleSave = async () => {
    const value = baseUri.trim()
    if (!value) return

    try {
      if (isLuksoKind(probe.kind)) {
        // LSP8 resolves baseURI + tokenId, and the key holds a VerifiableURI rather than a plain
        // string — an unencoded value here produces a collection nothing can read.
        await writeContractAsync({
          address: probe.address,
          abi: SET_DATA_ABI,
          functionName: 'setData',
          args: [probe.kind === COLLECTION_KIND.LSP8 ? LSP8_BASE_URI_KEY : LSP4_METADATA_KEY, encodeVerifiableURI(value)],
          chainId,
        })
      } else {
        const signature = caps.method
        if (!signature) return
        await writeContractAsync({
          address: probe.address,
          abi: setterAbi(signature),
          functionName: signature.split('(')[0],
          args: [value],
          chainId,
        })
      }

      toast('Metadata updated', 'success')
      probe.refetch()
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected' }), 'error')
    }
  }

  return (
    <div className={styles.studio}>
      <header className={styles.studio__head}>
        <p>
          Point any collection you own at new metadata — including ones launched somewhere else. On LUKSO this works for
          every LSP7 and LSP8, because the standard makes their metadata owner-writable.
        </p>
      </header>

      {/* Network and search share one row. A select would hide which chains exist behind a
          click, and which chain you are on is the first thing that decides whether an address
          resolves at all — so the chains stay visible beside the box they qualify. */}
      <div className={styles.studio__lookup}>
        {/* A popover rather than a native select, so each chain can show its own icon — a
            native <option> renders as plain text and cannot. Anchored and non-modal, which is
            what NativePopover is for; a menu that blocked the page behind it would be a dialog. */}
        <NativePopover
          placement="bottom-start"
          className={styles.studio__networkMenu}
          trigger={
            <button type="button" className={styles.studio__network} aria-label={`Network: ${chain?.name ?? ''}`}>
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

      {mine.length > 0 && !target && (
        <div className={styles.studio__mine}>
          <span className={styles.studio__mineHead}>
            Your collections <em>{mine.length}</em>
          </span>
          <ul>
            {mine.map((asset) => (
              <li key={asset.address}>
                <button type="button" onClick={() => setInput(asset.address)}>
                  <strong>{asset.name || 'Untitled collection'}</strong>
                  <small>
                    {asset.symbol ? `${asset.symbol} · ` : ''}
                    {asset.isLsp8 ? 'LSP8' : 'LSP7'} · {asset.address.slice(0, 6)}…{asset.address.slice(-4)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {issued.truncated && <small className={styles.studio__note}>Showing the first {mine.length} of {issued.total}.</small>}
        </div>
      )}

      {input.trim() && !target && <p className={styles.studio__note}>That is not a valid contract address.</p>}
      {probe.status === 'loading' && <p className={styles.studio__note}>Reading {chain?.name}…</p>}
      {(probe.status === 'empty' || probe.status === 'error') && (
        <p className={clsx(styles.studio__note, styles['studio__note--bad'])}>
          <WarningIcon size={14} weight="fill" /> {probe.message}
        </p>
      )}

      {probe.status === 'ready' && (
        <>
          <dl className={styles.studio__facts}>
            <div>
              <dt>Collection</dt>
              <dd>{probe.name || '—'}{probe.symbol ? ` · ${probe.symbol}` : ''}</dd>
            </div>
            <div>
              <dt>Standard</dt>
              <dd>{KIND_LABEL[probe.kind]}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{probe.owner ? `${probe.owner.slice(0, 6)}…${probe.owner.slice(-4)}` : 'none exposed'}</dd>
            </div>
            <div>
              <dt>You</dt>
              <dd>{caps.isOwner ? 'own this collection' : 'are not the owner'}</dd>
            </div>
          </dl>

          {caps.note && (
            <p className={clsx(styles.studio__note, !caps.canEditTokens && styles['studio__note--bad'])}>
              <WarningIcon size={14} /> {caps.note}
            </p>
          )}

          {caps.canEditTokens && (
            <>
              <p className={styles.studio__note}>
                <CheckCircleIcon size={14} weight="fill" /> Editable — writes go through{' '}
                <code>{caps.method}</code>.
              </p>

              {isLuksoKind(probe.kind) && (
                <>
                  <h2 className={styles.studio__section}>Collection metadata</h2>
                  {currentDoc ? (
                    <Lsp4MetadataEditor key={probe.address} current={currentDoc} name={probe.name} busy={isPending} onSave={saveLsp4} />
                  ) : (
                    <p className={styles.studio__note}>Reading the current metadata…</p>
                  )}

                  <h2 className={styles.studio__section}>Per-token artwork</h2>
                </>
              )}

              {/* The bulk uploader never knew it was talking to a Hup drop; it pins artwork and
                  metadata and hands back a CID, which is exactly what this page needs. */}
              {probe.kind === COLLECTION_KIND.LSP8 && (
                <DropArtworkUpload
                  standardId={4}
                  maxSupply={Number(probe.totalSupply ?? 0)}
                  collectionName={probe.name ?? ''}
                  disabled={isPending}
                  onPinned={({ cid }) => setBaseUri(`ipfs://${cid}/`)}
                />
              )}

              {probe.kind === COLLECTION_KIND.LSP8 && (
                <>
                  <h2 className={styles.studio__section}>One token at a time</h2>
                  <TokenMetadataEditor collection={probe.address} chainId={chainId} busy={isPending} onSave={saveTokenMetadata} />
                </>
              )}

              <h2 className={styles.studio__section}>Base URI</h2>
              <label className={styles.studio__editor}>
                <span>Every token, resolved as base + number</span>
                <input
                  type="text"
                  value={baseUri}
                  spellCheck={false}
                  placeholder="ipfs://…/"
                  onChange={(e) => setBaseUri(e.target.value)}
                />
                <small>
                  Token 1 will resolve to <code>{`${baseUri || 'ipfs://…/'}1`}</code>
                  {isLuksoKind(probe.kind)
                    ? ' — LSP8 appends the number and nothing else, so no file extension.'
                    : ' plus whatever suffix this contract appends.'}
                </small>
              </label>

              <button type="button" className={styles.studio__save} onClick={handleSave} disabled={isPending || !baseUri.trim()}>
                {isPending ? 'Saving…' : 'Save onchain'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
