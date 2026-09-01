'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { isAddress, toHex } from 'viem'
import clsx from 'clsx'
import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import { decodeVerifiableURI } from '@/lib/drops'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { getIPFS } from '@/lib/ipfs'
import { toast } from '@/components/NextToast'
import Lsp4MetadataEditor from './Lsp4MetadataEditor'
import styles from './TokenMetadataEditor.module.scss'

const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'
const PAGE_SIZE = 60

/* How many uncached tokens are worth resolving from chain in one go. Each costs a gateway fetch,
   so a fully unindexed page of sixty is left as numbers rather than firing sixty requests. */
const ONCHAIN_THUMB_LIMIT = 24
const countFormat = new Intl.NumberFormat('en')

const TOKEN_ABI = [
  { name: 'getDataForTokenId', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'tokenOwnerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
]

const LSP8_BASE_URI_KEY = '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843'

/** LSP8 ids are numbers cast to bytes32, left-padded — the same convention the drops engine mints. */
const tokenIdToBytes32 = (n) => toHex(BigInt(n), { size: 32 })

/*
 * The gateway readers take a bare path — "Qm…/1", never "ipfs://Qm…/1" — because the gateway
 * base already ends in /ipfs/. Passing the scheme through produces
 * "https://host/ipfs/ipfs://Qm…", which 404s on every gateway in the list and looks exactly like
 * content that is not pinned.
 */
const toIpfsPath = (uri) => String(uri ?? '').replace(/^ipfs:\/\//, '')

/**
 * Token Metadata Editor
 * Overrides one token's metadata, leaving the rest of the collection alone.
 *
 * LSP8 gives every token its own ERC725Y store, and a value written there wins over whatever the
 * collection's base URI would have resolved to. That is what makes a one-of-one inside a
 * numbered collection possible — a single revealed piece, a corrected trait, a redeemed token
 * that should now look redeemed — without touching the other thousand.
 *
 * It is deliberately one token at a time. `setDataBatchForTokenIds` exists, but a batch of
 * hand-edited documents is a batch of chances to write the wrong file to the wrong id, and the
 * bulk path already covers the case where every token changes at once.
 *
 * @param {Object} props
 * @param {string} props.collection The LSP8 contract.
 * @param {number} props.chainId
 * @param {boolean} [props.busy]
 * @param {Function} props.onSave Called with `(tokenIdBytes32, verifiableUri)` to write onchain.
 */
export default function TokenMetadataEditor({ collection, chainId, busy = false, onSave }) {
  const publicClient = usePublicClient({ chainId })
  const [tokenInput, setTokenInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(null)
  const [page, setPage] = useState(0)

  const { data: supply } = useReadContract({
    address: collection,
    abi: TOKEN_ABI,
    functionName: 'totalSupply',
    chainId,
    query: { enabled: Boolean(collection) },
  })

  /*
   * Ids are 1..N. That holds because the collection declares LSP8TokenIdFormat NUMBER and the
   * engine mints sequentially — it is the same assumption the base URI itself relies on, so a
   * collection where it fails would already be resolving nothing.
   *
   * Burned tokens leave gaps: totalSupply falls while the numbers already handed out do not, so
   * the last page can show ids that no longer exist. Opening one says "not minted" rather than
   * pretending otherwise, which is the honest failure for a list that cannot know.
   */
  const total = Number(supply ?? 0)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageIds = useMemo(
    () => Array.from({ length: Math.min(PAGE_SIZE, Math.max(0, total - page * PAGE_SIZE)) }, (_, i) => page * PAGE_SIZE + i + 1),
    [total, page],
  )

  // One batched call for the visible page — cheap enough to be worth showing, unlike resolving
  // every token's artwork, which would be a hundred gateway fetches per page.
  const { data: overrides } = useReadContracts({
    contracts: pageIds.map((id) => ({
      address: collection,
      abi: TOKEN_ABI,
      functionName: 'getDataForTokenId',
      args: [tokenIdToBytes32(id), LSP4_METADATA_KEY],
      chainId,
    })),
    query: { enabled: pageIds.length > 0 },
  })

  /*
   * Thumbnails for the visible page in one request. Deliberately from the indexer's cache rather
   * than from chain: resolving each token's document and fetching its image would be sixty round
   * trips to draw one screen. A token the indexer has not reached simply has no row, and its cell
   * falls back to the number — the picker never waits on this.
   */
  const { data: thumbs } = useSWR(
    pageIds.length ? `/api/v1/nfts/collections/${chainId}/${collection}/thumbnails?ids=${pageIds.join(',')}` : null,
    (url) => fetch(url).then((res) => res.json()),
  )
  const thumbById = useMemo(() => {
    const map = new Map()
    for (const row of thumbs?.data ?? []) map.set(String(row.token_id), row)
    return map
  }, [thumbs])

  /*
   * The cache is empty for a collection the indexer has not reached yet — which is every
   * collection on the day it launches, and exactly when its creator is most likely to be in here
   * editing it. So resolve the stragglers from chain: a token's own override if it has one,
   * otherwise the collection's base URI plus its number, then fetch that document for its image.
   *
   * Capped, and only for the visible page. Sixty gateway fetches to draw one screen is the cost
   * this whole component was built to avoid, so a page that is entirely unindexed stays as
   * numbers rather than quietly becoming slow.
   */
  const [resolved, setResolved] = useState({})
  const resolvedRef = useRef(new Set())

  const { data: baseUriRaw } = useReadContract({
    address: collection,
    abi: TOKEN_ABI,
    functionName: 'getData',
    args: [LSP8_BASE_URI_KEY],
    chainId,
    query: { enabled: Boolean(collection) },
  })

  useEffect(() => {
    /*
     * Wait for BOTH reads to settle. The base URI and the per-token overrides arrive
     * independently, and starting before the base URI is known means every token resolves to
     * nothing — while still being marked as attempted below, which is how a token could be
     * skipped permanently by a race that resolves a few hundred milliseconds later.
     */
    if (!thumbs || baseUriRaw === undefined || overrides === undefined) return undefined

    const missing = pageIds.filter((id) => !thumbById.has(String(id)) && !resolvedRef.current.has(id))
    if (!missing.length || missing.length > ONCHAIN_THUMB_LIMIT) return undefined

    let cancelled = false
    const base = baseUriRaw && baseUriRaw !== '0x' ? decodeVerifiableURI(baseUriRaw) : null

    const run = async () => {
      await Promise.all(
        missing.map(async (id) => {
          // A per-token override wins, exactly as it does when a wallet resolves the token
          const own = overrides?.[pageIds.indexOf(id)]?.result
          const uri = own && own !== '0x' ? decodeVerifiableURI(own) : base ? `${base}${id}` : null

          // Marked only once there is something to fetch, so a token is never written off for a
          // document we never actually asked for
          if (!uri) return
          resolvedRef.current.add(id)

          // getIPFS answers { result: false } rather than throwing, so a failure lands here as a
          // document with no image — which is the same outcome as a document that has none.
          const json = await getIPFS(toIpfsPath(uri)).catch(() => null)
          const lsp4 = json?.LSP4Metadata ?? json
          const image = lsp4?.images?.[0]?.[0]?.url ?? lsp4?.image ?? ''
          if (!cancelled && image) {
            setResolved((prev) => ({ ...prev, [id]: { name: lsp4?.name ?? '', image_uri: image } }))
          }
        }),
      )
    }
    run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, pageIds, baseUriRaw, overrides])

  const load = () => {
    const id = parseInt(tokenInput, 10)
    if (!Number.isFinite(id) || id < 1) return toast('Token ids start at 1', 'error')
    return open(id)
  }

  const open = async (id) => {
    if (!publicClient || !isAddress(collection)) return

    setLoading(true)
    setToken(null)
    try {
      const idBytes = tokenIdToBytes32(id)

      // A token that was never minted has no owner, and writing metadata for it would be
      // writing into a slot nothing resolves — say so rather than opening an editor over it.
      const owner = await publicClient
        .readContract({ address: collection, abi: TOKEN_ABI, functionName: 'tokenOwnerOf', args: [idBytes] })
        .catch(() => null)
      if (!owner) {
        toast(`Token ${id} has not been minted`, 'error')
        return
      }

      /*
       * Its own override, if it has one. An empty value is the normal case and not a failure: it
       * means the token still resolves through the collection's base URI, and the editor should
       * open blank rather than pretending the base document is this token's own.
       */
      const stored = await publicClient
        .readContract({ address: collection, abi: TOKEN_ABI, functionName: 'getDataForTokenId', args: [idBytes, LSP4_METADATA_KEY] })
        .catch(() => null)

      let current = {}
      let hasOverride = false
      if (stored && stored !== '0x') {
        hasOverride = true
        const uri = decodeVerifiableURI(stored)
        const json = uri ? await getIPFS(toIpfsPath(uri)).catch(() => null) : null
        const lsp4 = json?.LSP4Metadata ?? json
        if (lsp4) {
          current = {
            name: lsp4.name ?? '',
            description: lsp4.description ?? '',
            icon: lsp4.icon?.[0]?.[0]?.url ?? '',
            banner: { url: lsp4.images?.[0]?.[0]?.url ?? '' },
            links: lsp4.links ?? [],
            attributes: lsp4.attributes ?? [],
          }
        }
      }

      setToken({ id, idBytes, owner, hasOverride, current })
    } catch (err) {
      toast(err.message || 'Could not read that token', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (token) {
    return (
      <div className={styles.token}>
        <div className={styles.token__head}>
          <button type="button" className={styles.token__back} onClick={() => setToken(null)} disabled={busy}>
            <ArrowLeftIcon size={14} /> All tokens
          </button>
          <span>
            <strong>Token #{token.id}</strong>
            <small>
              held by {token.owner.slice(0, 6)}…{token.owner.slice(-4)} ·{' '}
              {token.hasOverride ? 'has its own metadata' : 'currently follows the collection'}
            </small>
          </span>
        </div>

        {/* Keyed on the id so moving between tokens remounts the form rather than carrying one
            token's edits into the next. */}
        <Lsp4MetadataEditor
          key={token.idBytes}
          current={token.current}
          name={`#${token.id}`}
          busy={busy}
          onSave={(uri) => onSave?.(token.idBytes, uri)}
        />
      </div>
    )
  }

  return (
    <div className={styles.token}>
      {total > 0 && (
        <>
          <div className={styles.token__grid}>
            {pageIds.map((id, index) => {
              // A token that already carries its own document is the one a creator is usually
              // looking for — either to change it again, or to avoid overwriting it by accident.
              const overridden = overrides?.[index]?.result && overrides[index].result !== '0x'
              const thumb = thumbById.get(String(id)) ?? resolved[id]
              return (
                <button
                  key={id}
                  type="button"
                  className={clsx(styles.token__cell, overridden && styles['token__cell--overridden'])}
                  disabled={busy || loading}
                  onClick={() => open(id)}
                  title={`${thumb?.name || `Token #${id}`}${overridden ? ' — has its own metadata' : ''}`}
                >
                  <span className={styles.token__art}>
                    {thumb?.image_uri ? (
                      <img src={resolveStorageImageUrl(thumb.image_uri)} alt="" loading="lazy" onError={handleBrokenImage} />
                    ) : (
                      <em>#{id}</em>
                    )}
                  </span>
                  <span className={styles.token__cellLabel}>#{id}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.token__pager}>
            <button type="button" onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0}>
              <CaretLeftIcon size={13} /> Previous
            </button>
            <span>
              {countFormat.format(pageIds[0] ?? 0)}–{countFormat.format(pageIds[pageIds.length - 1] ?? 0)} of{' '}
              {countFormat.format(total)}
            </span>
            <button type="button" onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))} disabled={page >= pageCount - 1}>
              Next <CaretRightIcon size={13} />
            </button>
          </div>

          <small className={styles.token__note}>
            A highlighted number already carries its own metadata. The rest follow the collection.
          </small>
        </>
      )}

      <div className={styles.token__lookup}>
        <span className={styles.token__field}>
          <MagnifyingGlassIcon size={15} />
          <input
            type="number"
            min="1"
            value={tokenInput}
            placeholder="Token number"
            disabled={busy || loading}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), load())}
          />
        </span>
        <button type="button" className={clsx(styles.token__go)} onClick={load} disabled={busy || loading || !tokenInput.trim()}>
          {loading ? 'Reading…' : 'Open'}
        </button>
      </div>

      <small className={styles.token__note}>
        Give one token its own name, artwork and traits. What you write here wins over the collection&rsquo;s base URI for
        that token alone — every other token carries on resolving as it did.
      </small>
    </div>
  )
}
