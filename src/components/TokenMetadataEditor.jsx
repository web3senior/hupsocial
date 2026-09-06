'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { isAddress, toHex } from 'viem'
import clsx from 'clsx'
import { ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon, WarningIcon } from '@phosphor-icons/react'
import {
  LSP4_METADATA_KEY,
  LSP8_TOKEN_METADATA_BASE_URI_KEY,
  decodeVerifiableUri,
  erc725yGetDataAbi,
  fetchMetadataJson,
  pickImageUrl,
  pickLsp4Image,
} from '@/lib/lsp4'
import { resolveLsp8TokenDocument, resolveNftMetadata } from '@/lib/nftMetadata'
import { loadNftMetadata } from '@/lib/nftMetadataBatch'
import { mapWithConcurrency } from '@/lib/concurrency'
import { resolveNftImageUrl } from '@/hooks/useNftMetadata'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { toast } from '@/components/NextToast'
import SegmentedControl from '@/components/ui/SegmentedControl'
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
  if (token.missing) return 'Not in circulation — burned, or never minted'
  if (token.unminted) {
    if (token.hasOverride) return 'Not minted yet · already carries its own metadata'
    if (token.tier === 'baseUri') return 'Not minted yet · follows the collection folder'
    return 'Not minted yet · nothing resolves for it yet'
  }

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
 * The set is shown in two halves, because they are two different jobs. Minted tokens belong to
 * somebody: editing one changes what a collector already holds. Unminted numbers belong to
 * nobody yet — they are the uploaded artwork waiting its turn, and a document written there is
 * simply what the next collector will receive. Mixing them in one list hid both.
 *
 * @param {Object} props
 * @param {string} props.collection The collection contract — LSP8 unless told otherwise.
 * @param {number} props.chainId
 * @param {number} [props.cap] Highest number this collection will ever hand out — the uploaded
 *   set. Unknown, or zero for an open edition, leaves only the minted half listable.
 * @param {number} [props.mintedCount] Numbers handed out so far, as a high-water mark a burn does
 *   not move. Falls back to `totalSupply()`, which does.
 * @param {string} [props.baseUri] Where an unminted number resolves from. Read from the
 *   collection when the caller does not already have it.
 * @param {string} [props.uriSuffix] Appended after the number, for folders serving `1.json`.
 * @param {boolean} [props.isLsp8=true] False for an ERC721 folder collection, whose tokens have
 *   no store of their own to read or write.
 * @param {boolean} [props.editable=isLsp8] False shows the same two halves read-only, for the
 *   standards — and the frozen collections — where a token cannot carry a document of its own.
 * @param {boolean} [props.busy]
 * @param {Function} props.onSave Called with `(tokenIdBytes32, verifiableUri)` to write onchain.
 * @param {Function} [props.onPreview] Called with a minted token's number when a read-only cell is
 *   clicked — a collection whose tokens cannot be edited here is still worth looking at.
 */
export default function TokenMetadataEditor({
  collection,
  chainId,
  cap,
  mintedCount,
  baseUri,
  uriSuffix = '',
  isLsp8 = true,
  editable = isLsp8,
  busy = false,
  onSave,
  onPreview,
}) {
  const publicClient = usePublicClient({ chainId })
  const [tokenInput, setTokenInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(null)
  const [page, setPage] = useState(0)
  const [scope, setScope] = useState(null)

  const knownMinted = Number.isFinite(Number(mintedCount)) ? Math.max(0, Number(mintedCount)) : null

  const { data: supply } = useReadContract({
    address: collection,
    abi: TOKEN_ABI,
    functionName: 'totalSupply',
    chainId,
    query: { enabled: Boolean(collection) && knownMinted === null },
  })

  // Asked only when the caller has not already got it — the drop panel has it on screen already
  const { data: baseUriBytes } = useReadContract({
    address: collection,
    abi: erc725yGetDataAbi,
    functionName: 'getData',
    args: [LSP8_TOKEN_METADATA_BASE_URI_KEY],
    chainId,
    query: { enabled: Boolean(collection) && !baseUri },
  })
  const folderUri = baseUri || decodeVerifiableUri(baseUriBytes) || ''

  /*
   * Ids are 1..N. That holds because the collection declares LSP8TokenIdFormat NUMBER and the
   * engine mints sequentially — it is the same assumption the base URI itself relies on, so a
   * collection where it fails would already be resolving nothing.
   *
   * Burned tokens leave gaps: totalSupply falls while the numbers already handed out do not, so
   * the minted half can show ids that no longer exist. Opening one says so rather than
   * pretending otherwise, which is the honest failure for a list that cannot know. `mintedCount`
   * is the better line to draw the halves at wherever the caller can supply it, since the
   * high-water mark is exactly where minting resumes.
   */
  const minted = knownMinted ?? Number(supply ?? 0)
  const hasCeiling = Number(cap ?? 0) > 0
  const total = Math.max(minted, hasCeiling ? Number(cap) : 0)
  const unminted = total - minted

  // The chosen half wins even when it is empty — "Minted (0)" is an answer, not a dead end. The
  // fallback only settles the first render, and picks the half that has something in it.
  const activeScope = scope === 'unminted' && unminted === 0 ? 'minted' : (scope ?? (minted > 0 ? 'minted' : 'unminted'))
  const isUnmintedScope = activeScope === 'unminted'

  const rangeStart = isUnmintedScope ? minted + 1 : 1
  const rangeCount = Math.max(0, isUnmintedScope ? unminted : minted)
  const pageCount = Math.max(1, Math.ceil(rangeCount / PAGE_SIZE))
  const pageIds = useMemo(
    () => Array.from({ length: Math.min(PAGE_SIZE, Math.max(0, rangeCount - page * PAGE_SIZE)) }, (_, i) => rangeStart + page * PAGE_SIZE + i),
    [rangeStart, rangeCount, page],
  )

  const chooseScope = (next) => {
    setScope(next)
    setPage(0)
  }

  // One batched call for the visible page: which tokens already carry their own document. Only
  // LSP8 has a per-token store to ask about — an ERC721 folder collection would revert on every
  // one of these, so it is never asked.
  const { data: overrides } = useReadContracts({
    contracts: pageIds.map((id) => ({
      address: collection,
      abi: TOKEN_ABI,
      functionName: 'getDataForTokenId',
      args: [tokenIdToBytes32(id), LSP4_METADATA_KEY],
      chainId,
    })),
    query: { enabled: isLsp8 && pageIds.length > 0 },
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
  const [thumbTick, setThumbTick] = useState(0)
  // Which token the editor currently shows, readable from a save that finishes after a re-render
  const openIdRef = useRef(null)

  useEffect(() => {
    if (!collection || !pageIds.length) return undefined
    // The unminted half decides per number whether to read a pre-written document or the folder,
    // and that answer is the multicall above — so it waits for it rather than painting twice.
    if (isUnmintedScope && isLsp8 && overrides === undefined) return undefined

    const asked = askedRef.current
    const wanted = pageIds.filter((id) => !asked.has(id))
    if (!wanted.length) return undefined
    wanted.forEach((id) => asked.add(id))
    setPending((prev) => new Set([...prev, ...wanted]))

    let cancelled = false
    const done = new Set()

    /** LSP8 numbers travel as bytes32; an ERC721 folder collection numbers them plainly. */
    const tokenKey = (id) => (isLsp8 ? tokenIdToBytes32(id) : String(id))
    /** What the multicall above says about one number: bytes written for it, or nothing yet. */
    const hasOverrideAt = (id) => {
      const value = overrides?.[pageIds.indexOf(id)]?.result
      return Boolean(value && value !== '0x')
    }

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
      /*
       * A number nobody has minted has nothing to look up. The indexer refuses to remember it —
       * rightly, since an unowned id is a ghost row everywhere else in the app — so asking the
       * batch endpoint would buy an ownership read per tile and cache none of it. What the
       * number does have is its place in the folder, which is precisely what it will resolve to
       * the moment somebody mints it. That file is the preview.
       */
      if (isUnmintedScope) {
        await mapWithConcurrency(wanted, THUMB_FALLBACK_CONCURRENCY, async (id) => {
          if (cancelled) return

          // Unless a document was already written for it ahead of the mint, which wins here the
          // same way it will win onchain
          if (hasOverrideAt(id) && publicClient) {
            const metadata = await resolveNftMetadata({ publicClient, collection, tokenId: tokenKey(id), isLsp8 }).catch(() => null)
            paint([[id, metadata ? { ...metadata, imageIsProxied: false } : null]])
            return
          }

          /* A base URI carrying a fragment is the placeholder state a numbered drop launches in:
             every id resolves to that one document, so the whole page shares a single fetch
             rather than asking for the same file once per tile. */
          const previewUri = folderUri.includes('#') ? folderUri : `${folderUri}${id}${uriSuffix}`
          const doc = folderUri ? await fetchMetadataJson(previewUri).catch(() => null) : null
          const lsp4 = doc?.LSP4Metadata ?? doc
          paint([[id, lsp4 ? { name: lsp4.name ?? null, image: pickLsp4Image(lsp4), imageIsProxied: false } : null]])
        })
        return
      }

      // Issued in one tick, so the coalescer folds the whole page into a single request
      const answers = await Promise.all(
        wanted.map((id) =>
          loadNftMetadata({ chainId: Number(chainId), collection, tokenId: tokenKey(id), isLsp8 })
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
        const metadata = await resolveNftMetadata({ publicClient, collection, tokenId: tokenKey(id), isLsp8 }).catch(() => null)
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
  }, [pageIds, collection, chainId, publicClient, isUnmintedScope, isLsp8, folderUri, uriSuffix, overrides, thumbTick])

  /** Re-resolves one number's artwork right away — after a save changed it. The tick re-runs the
      fetch effect, which otherwise only wakes when the page of numbers changes. */
  const forgetThumb = (id) => {
    askedRef.current.delete(id)
    setThumbs((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setThumbTick((n) => n + 1)
  }

  const load = () => {
    const id = parseInt(tokenInput, 10)
    if (!Number.isFinite(id) || id < 1) return toast('Token ids start at 1', 'error')
    return open(id)
  }

  const open = async (id) => {
    if (!publicClient || !isAddress(collection)) return

    const idBytes = tokenIdToBytes32(id)
    const notMintedYet = id > minted
    // Opens on the artwork the grid already resolved, so the token you clicked is on screen
    // while its document is still being read rather than a beat of nothing.
    const thumb = thumbs[id]
    setToken({
      id,
      idBytes,
      loading: true,
      unminted: notMintedYet,
      name: thumb?.name,
      image: resolveNftImageUrl(thumb, { width: HEAD_WIDTH, still: true }),
    })
    setLoading(true)
    openIdRef.current = id

    try {
      /*
       * Ownership and the document, together — except above the high-water mark, where there is
       * nobody to ask about and a null owner would only be read as a burn. A number that has not
       * been minted is not a mistake to catch here: LSP8 keeps a document against the id whether
       * or not the token exists, so writing one now is how a creator decides what the next
       * collector receives, before anyone owns it.
       */
      const [owner, resolved] = await Promise.all([
        notMintedYet
          ? Promise.resolve(null)
          : publicClient.readContract({ address: collection, abi: TOKEN_ABI, functionName: 'tokenOwnerOf', args: [idBytes] }).catch(() => null),
        resolveLsp8TokenDocument({ publicClient, collection, tokenId: idBytes }),
      ])

      if (!owner && !notMintedYet) {
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
        unminted: notMintedYet,
        current,
        name: current.name,
        hasOverride: resolved.hasOverride,
        tier: resolved.tier,
        // A token with its own document shows that document's art: the grid's thumbnail came
        // through a cache that may predate the override and still carry the collection's image
        image:
          (resolved.hasOverride &&
            resolveStorageImageUrl(pickImageUrl(current.images) || pickImageUrl(current.image) || pickImageUrl(current.icon), {
              width: HEAD_WIDTH,
              still: true,
            })) ||
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
          <button
            type="button"
            className={styles.token__back}
            onClick={() => {
              openIdRef.current = null
              setToken(null)
            }}
            disabled={busy}
          >
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
            Nobody holds token #{token.id}. Its number is in the minted half because the collection&rsquo;s supply once
            reached it — a burn leaves the gap behind, and nothing can be written into it.
          </p>
        )}

        {token.unminted && !token.loading && (
          <p className={styles.token__note}>
            Token #{token.id} has not been minted. What you save here is written against its number now and is what
            whoever mints it receives — the folder&rsquo;s file for #{token.id} is only the starting point below.
          </p>
        )}

        {/* What a save reaches, said before the form: one number, never the collection. The fear
            worth answering is that touching one token scrambles the others — it cannot. */}
        {!token.loading && !token.missing && (
          <p className={styles.token__alert}>
            <WarningIcon size={14} weight="fill" aria-hidden="true" />
            <span>
              {token.hasOverride
                ? `Only token #${token.id} changes: it already carries metadata of its own, and saving replaces that. Every other token is untouched.`
                : `Only token #${token.id} changes. Saving gives it metadata of its own, which wins over the collection’s folder for this number alone — the other tokens keep following the folder, and a later change to the folder will not touch this one.`}
            </span>
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
            onSave={async (uri) => {
              const hash = await onSave?.(token.idBytes, uri)
              const id = token.id
              /* The grid and the server-side cache both resolved this number before it had a
                 document of its own, and nothing onchain tells the cache it changed. So, after the
                 save has already reported: let the block land, ask the cache to re-read this one
                 token, then re-resolve the tile and the open editor. Nobody waits on any of it. */
              const settle = async () => {
                if (hash && publicClient) await publicClient.waitForTransactionReceipt({ hash }).catch(() => null)
                await fetch('/api/v1/nfts/metadata/refresh', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    chainId: Number(chainId),
                    collection,
                    tokenId: isLsp8 ? tokenIdToBytes32(id) : String(id),
                    isLsp8: Boolean(isLsp8),
                  }),
                }).catch(() => null)
                forgetThumb(id)
                if (openIdRef.current === id) open(id)
              }
              void settle()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className={styles.token}>
      {/* A read-only grid with no count to draw from would otherwise render as nothing at all */}
      {total === 0 && !editable && (
        <p className={styles.token__note}>This collection does not say how many tokens it has, so there is nothing to list here.</p>
      )}

      {total > 0 && (
        <>
          {/* The two halves only exist where the collection declares a ceiling. An open edition
              has no unminted numbers to separate — its next token is decided at the mint. Once
              the last one is gone the count still stands, but there is no half left to switch to. */}
          {hasCeiling && (
            <div className={styles.token__scope}>
              <strong>
                Total {countFormat.format(total)} token{total === 1 ? '' : 's'}
              </strong>
              {unminted > 0 && (
                <SegmentedControl
                  className={styles.token__scopeSwitch}
                  options={[
                    { value: 'minted', label: `Minted (${countFormat.format(minted)})` },
                    { value: 'unminted', label: `Unminted (${countFormat.format(unminted)})` },
                  ]}
                  value={activeScope}
                  onChange={chooseScope}
                  label="Which tokens"
                  as="tabs"
                  size="sm"
                />
              )}
            </div>
          )}

          {rangeCount === 0 ? (
            <p className={styles.token__note}>Nothing has been minted yet — the whole collection is waiting in the unminted half.</p>
          ) : (
            <>
              <div className={styles.token__grid}>
                {pageIds.map((id, index) => {
                  // A token that already carries its own document is the one a creator is usually
                  // looking for — either to change it again, or to avoid overwriting it by accident.
                  const overridden = overrides?.[index]?.result && overrides[index].result !== '0x'
                  const thumb = thumbs[id]
                  const image = resolveNftImageUrl(thumb, { width: THUMB_WIDTH, still: true })
                  const isPending = pending.has(id)
                  // A read-only grid still opens minted tokens for a look; only an unminted
                  // number, which nobody can hold yet, has nothing behind it to show
                  const previewable = !editable && !isUnmintedScope && Boolean(onPreview)
                  // Resolved, but not from anything of its own: the file the folder link should
                  // hold for this number is missing, so what shows is the collection standing in
                  const borrowed = !isUnmintedScope && Boolean(thumb) && thumb.source !== 'token'
                  const className = clsx(
                    styles.token__cell,
                    overridden && styles['token__cell--overridden'],
                    borrowed && styles['token__cell--borrowed'],
                    isPending && !image && styles['token__cell--pending'],
                    !editable && !previewable && styles['token__cell--static'],
                  )
                  const title = `${thumb?.name || `Token #${id}`}${overridden ? ' — has its own metadata' : ''}${
                    borrowed ? ' — no file of its own where the folder link points; the collection stands in' : ''
                  }${isUnmintedScope ? ' — not minted yet' : ''}`
                  const art = (
                    <>
                      <span className={styles.token__art}>
                        {image ? <img src={image} alt="" loading="lazy" onError={handleBrokenImage} /> : <em>#{id}</em>}
                      </span>
                      <span className={styles.token__cellLabel}>#{id}</span>
                    </>
                  )

                  // Nothing to open where a token cannot carry a document of its own and nobody
                  // asked to look at it, so the cell stops offering — the grid is there to be read
                  return editable || previewable ? (
                    <button
                      key={id}
                      type="button"
                      className={className}
                      disabled={busy || loading}
                      aria-busy={isPending || undefined}
                      onClick={() => (editable ? open(id) : onPreview(id))}
                      title={title}
                    >
                      {art}
                    </button>
                  ) : (
                    <figure key={id} className={className} aria-busy={isPending || undefined} title={title}>
                      {art}
                    </figure>
                  )
                })}
              </div>

              <div className={styles.token__pager}>
                <button type="button" onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0}>
                  <CaretLeftIcon size={13} /> Previous
                </button>
                <span>
                  #{countFormat.format(pageIds[0] ?? 0)}–#{countFormat.format(pageIds[pageIds.length - 1] ?? 0)} ·{' '}
                  {countFormat.format(rangeCount)} {isUnmintedScope ? 'unminted' : 'minted'}
                </span>
                <button type="button" onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))} disabled={page >= pageCount - 1}>
                  Next <CaretRightIcon size={13} />
                </button>
              </div>
            </>
          )}

          <small className={styles.token__note}>
            {!editable
              ? `Every one of these follows the collection’s folder — on this standard a token cannot carry a document of its own.${
                  onPreview && !isUnmintedScope ? ' Open one to see it the way collectors do.' : ''
                }`
              : isUnmintedScope
                ? 'Nobody owns these yet. What you see is the file the folder holds for each number; open one to give it a document of its own before it mints — a highlighted number already has one.'
                : 'A highlighted number already carries its own metadata. The rest follow the collection’s folder link — a dashed one has no file there, so the collection’s own image stands in for it.'}
          </small>
        </>
      )}

      {editable && (
        <>
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
            Give one token its own name, artwork and traits. What you write here wins over the collection&rsquo;s base URI
            for that token alone — every other token carries on resolving as it did.
          </small>
        </>
      )}
    </div>
  )
}
