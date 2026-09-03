'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { isAddress, toHex } from 'viem'
import clsx from 'clsx'
import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { LSP4_METADATA_KEY, pickImageUrl } from '@/lib/lsp4'
import { resolveLsp8TokenDocument, resolveNftMetadata } from '@/lib/nftMetadata'
import { loadNftMetadata } from '@/lib/nftMetadataBatch'
import { mapWithConcurrency } from '@/lib/concurrency'
import { resolveNftImageUrl } from '@/hooks/useNftMetadata'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { toast } from '@/components/NextToast'
import Lsp4MetadataEditor from './Lsp4MetadataEditor'
import styles from './TokenMetadataEditor.module.scss'

const PAGE_SIZE = 60

/* The page's artwork goes out as one request — the coalescer folds a tick's worth of tokens
   into a single POST, and asking a row at a time paid the round trip and the batch route's
   own worker pool once per row for the same work. Only the fallback below needs a bound: it
   is browser-side RPC, one unbatched conversation per token. */
const THUMB_FALLBACK_CONCURRENCY = 6
const THUMB_WIDTH = 192
// The one token being edited, at the size its slot in the header actually paints
const HEAD_WIDTH = 96
const countFormat = new Intl.NumberFormat('en')

const TOKEN_ABI = [
  { name: 'getDataForTokenId', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'tokenOwnerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

/** LSP8 ids are numbers cast to bytes32, left-padded — the same convention the drops engine mints. */
const tokenIdToBytes32 = (n) => toHex(BigInt(n), { size: 32 })

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * What the form underneath actually holds, said plainly. Editing a document the token already
 * owns and starting one from what it inherits look identical on screen and are not the same
 * act — the second one gives the token a copy of the collection's document, forever.
 * @param {Object} token The open token's state.
 * @returns {string}
 */
const describeToken = (token) => {
  if (token.loading) return 'Reading its metadata…'
  if (token.missing) return 'Never minted'

  const held = `held by ${shortAddress(token.owner)}`
  if (token.hasOverride) {
    return token.tier === 'override' ? `${held} · has its own metadata` : `${held} · has its own metadata, but it could not be read`
  }
  if (token.tier === 'baseUri') return `${held} · follows the collection — saving gives it its own copy`
  if (token.tier === 'collection') return `${held} · no token document yet, so these fields describe the collection`
  return `${held} · nothing resolves for it yet`
}

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

    // `null` is an answer — the token resolves to nothing and the cell keeps its number.
    const paint = (entries) => {
      if (cancelled || entries.length === 0) return
      entries.forEach(([id]) => done.add(id))
      setThumbs((prev) => {
        const next = { ...prev }
        entries.forEach(([id, metadata]) => {
          next[id] = metadata
        })
        return next
      })
      setPending((prev) => {
        const next = new Set(prev)
        entries.forEach(([id]) => next.delete(id))
        return next
      })
    }

    const run = async () => {
      // Issued in one tick, so the coalescer folds the whole page into a single request
      const answers = await Promise.all(
        wanted.map((id) =>
          loadNftMetadata({ chainId: Number(chainId), collection, tokenId: tokenIdToBytes32(id), isLsp8: true })
            .then((metadata) => [id, metadata])
            .catch(() => [id, undefined]),
        ),
      )
      if (cancelled) return

      paint(answers.filter(([, metadata]) => metadata !== undefined))

      // The batch endpoint going away (the database with it) drops each token back to the same
      // browser-side RPC read the cards fall back to.
      const unanswered = answers.filter(([, metadata]) => metadata === undefined).map(([id]) => id)
      if (unanswered.length === 0 || !publicClient) return

      await mapWithConcurrency(unanswered, THUMB_FALLBACK_CONCURRENCY, async (id) => {
        if (cancelled) return
        const metadata = await resolveNftMetadata({ publicClient, collection, tokenId: tokenIdToBytes32(id), isLsp8: true }).catch(() => null)
        paint([[id, metadata ? { ...metadata, imageIsProxied: false } : null]])
      })
    }

    run()

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

    const idBytes = tokenIdToBytes32(id)
    // Opens on the artwork the grid already resolved, so the token you clicked is on screen
    // while its document is still being read rather than a beat of nothing.
    const thumb = thumbs[id]
    setToken({ id, idBytes, loading: true, name: thumb?.name, image: resolveNftImageUrl(thumb, { width: HEAD_WIDTH, still: true }) })
    setLoading(true)

    try {
      /*
       * Ownership and the document, together. A token that was never minted has no owner, and
       * writing metadata for it would be writing into a slot nothing resolves.
       */
      const [owner, resolved] = await Promise.all([
        publicClient
          .readContract({ address: collection, abi: TOKEN_ABI, functionName: 'tokenOwnerOf', args: [idBytes] })
          .catch(() => null),
        resolveLsp8TokenDocument({ publicClient, collection, tokenId: idBytes }),
      ])

      if (!owner) {
        setToken({ id, idBytes, missing: true })
        return
      }

      /*
       * Seeded from whatever the token resolves to today, not only from an override it may not
       * have: most tokens follow the collection's base URI, and an editor that opened blank over
       * them showed none of the artwork the grid had just painted — and saved a document that
       * threw all of it away. The tier says whether these fields are the token's own, inherited
       * from the base URI, or the collection's, which describes the set rather than this piece.
       */
      const current = resolved.json?.LSP4Metadata ?? resolved.json ?? {}
      setToken({
        id,
        idBytes,
        owner,
        current,
        name: current.name,
        hasOverride: resolved.hasOverride,
        tier: resolved.tier,
        image:
          resolveNftImageUrl(thumb, { width: HEAD_WIDTH, still: true }) ||
          resolveStorageImageUrl(pickImageUrl(current.images) || pickImageUrl(current.image) || pickImageUrl(current.icon), {
            width: HEAD_WIDTH,
            still: true,
          }),
      })
    } catch (err) {
      toast(err.message || 'Could not read that token', 'error')
      setToken(null)
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
          <span className={clsx(styles.token__art, styles.token__headArt)}>
            {token.image ? <img src={token.image} alt="" onError={handleBrokenImage} /> : <em>#{token.id}</em>}
          </span>
          <span className={styles.token__headText}>
            <strong>{String(token.name || '').trim() || `Token #${token.id}`}</strong>
            <small>{describeToken(token)}</small>
          </span>
        </div>

        {token.loading && <p className={styles.token__note}>Reading this token&rsquo;s metadata…</p>}

        {token.missing && (
          <p className={styles.token__note}>
            Token #{token.id} has not been minted, so there is nothing to point at yet. Its number is on this page
            because the collection&rsquo;s supply once reached it — a burn leaves the gap behind.
          </p>
        )}

        {/* Keyed on the id so moving between tokens remounts the form rather than carrying one
            token's edits into the next. */}
        {!token.loading && !token.missing && (
          <Lsp4MetadataEditor
            key={token.idBytes}
            current={token.current}
            name={`#${token.id}`}
            subject="token"
            busy={busy}
            onSave={(uri) => onSave?.(token.idBytes, uri)}
          />
        )}
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
