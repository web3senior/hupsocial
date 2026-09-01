'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { isAddress, toHex } from 'viem'
import clsx from 'clsx'
import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { LSP4_METADATA_KEY, decodeVerifiableUri, fetchMetadataJson } from '@/lib/lsp4'
import { resolveNftMetadata } from '@/lib/nftMetadata'
import { loadNftMetadata } from '@/lib/nftMetadataBatch'
import { mapWithConcurrency } from '@/lib/concurrency'
import { resolveNftImageUrl } from '@/hooks/useNftMetadata'
import { handleBrokenImage } from '@/lib/utils'
import { toast } from '@/components/NextToast'
import Lsp4MetadataEditor from './Lsp4MetadataEditor'
import styles from './TokenMetadataEditor.module.scss'

const PAGE_SIZE = 60

/* Artwork is asked for one grid row at a time, two rows in flight: a whole page in one request
   would paint nothing until its slowest token answered, and more rows at once would multiply the
   RPC budget the batch route keeps per request. */
const THUMB_CHUNK = 12
const THUMB_CHUNKS_IN_FLIGHT = 2
const THUMB_WIDTH = 192
const countFormat = new Intl.NumberFormat('en')

const TOKEN_ABI = [
  { name: 'getDataForTokenId', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'tokenOwnerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

/** LSP8 ids are numbers cast to bytes32, left-padded — the same convention the drops engine mints. */
const tokenIdToBytes32 = (n) => toHex(BigInt(n), { size: 32 })

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

  // One batched call for the visible page: which tokens already carry their own document.
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
   * Artwork for the visible page, through the same read-through cache every NFT card uses. A
   * token the indexer already holds costs a row lookup; one it has never seen is resolved from
   * chain on the server — its own override first, then the collection's base URI plus its
   * number — and stored, so the next visitor and the collection page both inherit the answer.
   * The batch endpoint going away (the database with it) drops each token back to the same
   * browser-side RPC read the cards fall back to.
   */
  const [thumbs, setThumbs] = useState({})
  const [pending, setPending] = useState(() => new Set())
  const askedRef = useRef(new Set())

  useEffect(() => {
    if (!collection || !pageIds.length) return undefined

    const asked = askedRef.current
    const wanted = pageIds.filter((id) => !asked.has(id))
    if (!wanted.length) return undefined
    wanted.forEach((id) => asked.add(id))
    setPending((prev) => new Set([...prev, ...wanted]))

    let cancelled = false
    const done = new Set()
    const chunks = []
    for (let i = 0; i < wanted.length; i += THUMB_CHUNK) chunks.push(wanted.slice(i, i + THUMB_CHUNK))

    const resolveOne = async (id) => {
      const tokenId = tokenIdToBytes32(id)
      try {
        return await loadNftMetadata({ chainId: Number(chainId), collection, tokenId, isLsp8: true })
      } catch {
        if (!publicClient) return null
        const metadata = await resolveNftMetadata({ publicClient, collection, tokenId, isLsp8: true }).catch(() => null)
        return metadata ? { ...metadata, imageIsProxied: false } : null
      }
    }

    mapWithConcurrency(chunks, THUMB_CHUNKS_IN_FLIGHT, async (chunk) => {
      if (cancelled) return
      // Issued in one tick, so the coalescer folds the row into a single request
      const results = await Promise.all(chunk.map(resolveOne))
      if (cancelled) return
      chunk.forEach((id) => done.add(id))
      setThumbs((prev) => {
        const next = { ...prev }
        chunk.forEach((id, index) => {
          next[id] = results[index]
        })
        return next
      })
      setPending((prev) => {
        const next = new Set(prev)
        chunk.forEach((id) => next.delete(id))
        return next
      })
    })

    return () => {
      cancelled = true
      // Whatever this run did not finish is asked again next time it is on screen, instead of
      // staying a number for the rest of the session
      const unfinished = wanted.filter((id) => !done.has(id))
      unfinished.forEach((id) => asked.delete(id))
      setPending((prev) => {
        const next = new Set(prev)
        unfinished.forEach((id) => next.delete(id))
        return next
      })
    }
  }, [pageIds, collection, chainId, publicClient])

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
        const uri = decodeVerifiableUri(stored)
        const json = uri ? await fetchMetadataJson(uri).catch(() => null) : null
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
              const thumb = thumbs[id]
              const image = resolveNftImageUrl(thumb, { width: THUMB_WIDTH, still: true })
              const isPending = pending.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={clsx(
                    styles.token__cell,
                    overridden && styles['token__cell--overridden'],
                    isPending && !image && styles['token__cell--pending'],
                  )}
                  disabled={busy || loading}
                  aria-busy={isPending || undefined}
                  onClick={() => open(id)}
                  title={`${thumb?.name || `Token #${id}`}${overridden ? ' — has its own metadata' : ''}`}
                >
                  <span className={styles.token__art}>
                    {image ? <img src={image} alt="" loading="lazy" onError={handleBrokenImage} /> : <em>#{id}</em>}
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
