'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowClockwiseIcon, ImageIcon, TrashIcon, UploadSimpleIcon, WarningIcon } from '@phosphor-icons/react'
import { readTraitManifest, readZipEntries, sortZipEntries, validateCollection, metadataSuffix } from '@/lib/dropUpload'
import { buildMetadataFiles, estimateRemaining, indexPinnedImages, planImageBatches, uploadProgress, imageFileName } from '@/lib/dropUploadPlan'
import { uploadFolderToIPFS } from '@/lib/ipfs'
import { isLuksoStandard } from '@/lib/drops'
import { toast } from '@/components/NextToast'
import styles from './DropArtworkUpload.module.scss'

const PAGE_SIZE = 100
const countFormat = new Intl.NumberFormat('en')

const formatBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `~${minutes} min` : `~${Math.round(minutes / 60)} hr`
}

/**
 * Drop Artwork Upload
 * The bulk path for a numbered collection: a creator drops in a zip of artwork, checks the
 * preview, and this pins it as the per-token metadata their collection reads.
 *
 * It exists because the alternative is asking an artist to hand-build a thousand LSP4Metadata
 * files, each carrying a keccak256 of its own image's bytes. Nobody does that. We are pinning the
 * bytes, so we can hash them — the verification digests that make LUKSO metadata tamper-evident
 * come out of the upload for free, and the artist never learns the term.
 *
 * @param {Object} props
 * @param {number} props.standardId The drop's standard — decides filenames and metadata shape.
 * @param {number} props.maxSupply The drop's supply, checked against the file count.
 * @param {string} props.collectionName Fallback name for a token with no manifest entry.
 * @param {boolean} [props.disabled] Locked while the panel is busy elsewhere.
 * @param {Function} props.onPinned Called with `{ cid, suffix, count }` once the metadata
 *   directory is pinned. Writing it onchain belongs to the caller, which owns that transaction.
 */
export default function DropArtworkUpload({ standardId, maxSupply = 0, collectionName = '', disabled = false, onPinned }) {
  const [items, setItems] = useState([])
  const [traits, setTraits] = useState(new Map())
  const [report, setReport] = useState(null)
  const [isReading, setIsReading] = useState(false)

  const [page, setPage] = useState(0)
  const [order, setOrder] = useState(null)
  const [jump, setJump] = useState('')

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null)
  // Batches already pinned, kept across a failure so a retry does not re-send them. This is what
  // makes an interrupted upload cheap to resume rather than a full restart.
  const doneBatchesRef = useRef([])

  const isLukso = isLuksoStandard(standardId)

  const reset = () => {
    setItems([])
    setTraits(new Map())
    setReport(null)
    setOrder(null)
    setPage(0)
    setProgress(null)
    doneBatchesRef.current = []
  }

  const handleFile = async (file) => {
    if (!file) return
    reset()
    setIsReading(true)
    try {
      const entries = await readZipEntries(await file.arrayBuffer())
      const { images, jsonFiles, ignored } = sortZipEntries(entries)
      if (!images.length) throw new Error('No images found in that zip')

      const manifest = readTraitManifest(jsonFiles)
      const validation = validateCollection({ images, maxSupply })

      setItems(images)
      setTraits(manifest)
      setReport({ ...validation, ignored: ignored.length, hasManifest: manifest.size > 0 })
    } catch (err) {
      toast(err.message || 'Could not read that zip', 'error')
      reset()
    } finally {
      setIsReading(false)
    }
  }

  // Display order only — token numbers never move, so shuffling is safe and reversible.
  const view = useMemo(() => (order ? order.map((i) => items[i]).filter(Boolean) : items), [items, order])
  const pageCount = Math.max(1, Math.ceil(view.length / PAGE_SIZE))
  const pageItems = useMemo(() => view.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [view, page])

  /*
   * Preview URLs are made for the visible page only and revoked on the way out. A thousand live
   * blob URLs is a thousand decoded images held in memory, which is what turns a large collection
   * into a stalled tab.
   */
  const previews = useMemo(() => {
    const urls = new Map()
    for (const item of pageItems) urls.set(item.name, URL.createObjectURL(new Blob([item.bytes], { type: item.type })))
    return urls
  }, [pageItems])

  // Revoked when the page changes or the component goes away — the browser holds a decoded image
  // behind every live blob URL, and a thousand of those is the difference between a grid and a
  // stalled tab.
  useEffect(
    () => () => {
      for (const url of previews.values()) URL.revokeObjectURL(url)
    },
    [previews],
  )

  const removeItem = useCallback(
    (name) => {
      setItems((prev) => {
        const next = prev.filter((i) => i.name !== name)
        setReport((r) => (r ? { ...r, ...validateCollection({ images: next, maxSupply }) } : r))
        return next
      })
      setOrder(null)
    },
    [maxSupply],
  )

  const handleJump = () => {
    const token = parseInt(jump, 10)
    if (!Number.isFinite(token)) return
    const index = view.findIndex((i) => i.token === token)
    if (index === -1) {
      toast(`No artwork numbered ${token}`, 'error')
      return
    }
    setPage(Math.floor(index / PAGE_SIZE))
  }

  const handleUpload = async () => {
    if (!items.length || uploading) return

    const batches = planImageBatches(items)
    const bytesTotal = items.reduce((n, i) => n + i.bytes.byteLength, 0)
    const startedAt = Date.now()

    setUploading(true)
    try {
      // --- artwork, in batches: each is its own directory, which is fine because every image is
      // addressed by a full URL from inside its token's metadata ---
      for (let index = doneBatchesRef.current.length; index < batches.length; index++) {
        const batch = batches[index]
        const files = batch.map((image) => new File([image.bytes], imageFileName(image), { type: image.type }))
        const cid = await uploadFolderToIPFS(files)
        doneBatchesRef.current = [...doneBatchesRef.current, { cid, images: batch }]

        const bytesDone = doneBatchesRef.current.reduce((n, b) => n + b.images.reduce((m, i) => m + i.bytes.byteLength, 0), 0)
        setProgress({
          percent: uploadProgress({ imageBatches: batches, doneBatches: index + 1, metadataDone: false }),
          done: doneBatchesRef.current.reduce((n, b) => n + b.images.length, 0),
          total: items.length,
          estimate: estimateRemaining({ bytesDone, bytesTotal, elapsedMs: Date.now() - startedAt }),
        })
      }

      // --- metadata, as ONE directory: baseURI + tokenId can only resolve inside a single root ---
      const pinnedImages = indexPinnedImages(doneBatchesRef.current)
      const metadataFiles = buildMetadataFiles({ images: items, pinnedImages, standardId, collectionName, traits })
      const metadataCid = await uploadFolderToIPFS(
        metadataFiles.map((f) => new File([f.content], f.name, { type: 'application/json' })),
      )

      setProgress({ percent: 100, done: items.length, total: items.length, estimate: null })
      onPinned?.({ cid: metadataCid, suffix: metadataSuffix(standardId), count: items.length })
      toast(`Pinned ${countFormat.format(items.length)} tokens — check the base URI, then save it onchain`, 'success')
    } catch (err) {
      toast(err.message || 'Upload failed — press upload again to carry on from where it stopped', 'error')
    } finally {
      setUploading(false)
    }
  }

  const totalBytes = items.reduce((n, i) => n + i.bytes.byteLength, 0)
  const blocked = Boolean(report?.errors?.length)

  return (
    <div className={styles.upload}>
      {!items.length ? (
        <>
          <label className={clsx(styles.upload__drop, (disabled || isReading) && styles['upload__drop--busy'])}>
            <UploadSimpleIcon size={22} weight="light" />
            <strong>{isReading ? 'Reading the zip…' : 'Upload a .zip of your artwork'}</strong>
            <small>
              One image per token, numbered in the filename — <code>1.png</code>, <code>2.png</code>. Traits are read from a
              CSV or JSON alongside them, if you have one.
            </small>
            <input type="file" accept=".zip,application/zip" hidden disabled={disabled || isReading} onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>

          <a className={styles.upload__sample} href={`/api/v1/drops/sample?standard=${standardId}`} download>
            Download a sample folder
          </a>
        </>
      ) : (
        <>
          <div className={styles.upload__head}>
            <div>
              <strong>
                {countFormat.format(items.length)} item{items.length === 1 ? '' : 's'}
              </strong>
              <small>
                {formatBytes(totalBytes)}
                {report?.hasManifest ? ' · traits found' : ' · no trait file'}
                {report?.ignored ? ` · ${report.ignored} other file${report.ignored === 1 ? '' : 's'} ignored` : ''}
              </small>
            </div>
            <button type="button" className={styles.upload__plain} onClick={reset} disabled={uploading}>
              Start over
            </button>
          </div>

          {report?.errors?.map((message) => (
            <p key={message} className={clsx(styles.upload__notice, styles['upload__notice--error'])}>
              <WarningIcon size={14} weight="fill" /> {message}
            </p>
          ))}
          {report?.warnings?.map((message) => (
            <p key={message} className={styles.upload__notice}>
              <WarningIcon size={14} /> {message}
            </p>
          ))}

          <div className={styles.upload__toolbar}>
            <span>
              Showing {countFormat.format(page * PAGE_SIZE + 1)}–{countFormat.format(Math.min((page + 1) * PAGE_SIZE, view.length))} of{' '}
              {countFormat.format(view.length)}
            </span>

            <button
              type="button"
              className={styles.upload__plain}
              onClick={() => setOrder(order ? null : [...items.keys()].sort(() => Math.random() - 0.5))}
              disabled={uploading}
            >
              <ArrowClockwiseIcon size={13} /> {order ? 'Sort by number' : 'Shuffle'}
            </button>

            <span className={styles.upload__jump}>
              <input
                type="number"
                min="1"
                value={jump}
                placeholder="Token #"
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleJump())}
              />
              <button type="button" className={styles.upload__plain} onClick={handleJump}>
                Go
              </button>
            </span>

            <span className={styles.upload__pager}>
              <button type="button" className={styles.upload__plain} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </button>
              <em>
                {page + 1} / {pageCount}
              </em>
              <button
                type="button"
                className={styles.upload__plain}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next
              </button>
            </span>
          </div>

          <div className={styles.upload__grid}>
            {pageItems.map((item) => {
              const entry = traits.get(item.token)
              return (
                <figure key={item.name} className={styles.upload__card}>
                  <span className={styles.upload__art}>
                    {previews.get(item.name) ? <img src={previews.get(item.name)} alt="" loading="lazy" /> : <ImageIcon size={20} />}
                    <button
                      type="button"
                      className={styles.upload__remove}
                      onClick={() => removeItem(item.name)}
                      disabled={uploading}
                      aria-label={`Remove token ${item.token ?? item.name}`}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </span>
                  <figcaption>
                    <strong>{entry?.name || `${collectionName} #${item.token}`}</strong>
                    <small>
                      {item.token === null ? 'no number' : `#${item.token}`}
                      {entry?.attributes?.length ? ` · ${entry.attributes.length} traits` : ''}
                    </small>
                  </figcaption>
                </figure>
              )
            })}
          </div>

          {progress && (
            <div className={styles.upload__progress}>
              <div className={styles.upload__progressHead}>
                <strong>{progress.percent === 100 ? 'Pinned' : 'Uploading your artwork…'}</strong>
                <em>{progress.percent}%</em>
              </div>
              <span className={styles.upload__progressTrack}>
                <span style={{ width: `${progress.percent}%` }} />
              </span>
              <small>
                {countFormat.format(progress.done)} of {countFormat.format(progress.total)} uploaded
                {progress.estimate ? ` · ${formatBytes(progress.estimate.bytesPerSecond)}/s · ${formatDuration(progress.estimate.remainingMs)} left` : ''}
              </small>
              <small>Keep this tab open. Finished batches are kept, so an interrupted upload carries on rather than restarting.</small>
            </div>
          )}

          <button type="button" className={styles.upload__submit} onClick={handleUpload} disabled={disabled || uploading || blocked}>
            {uploading ? 'Uploading…' : `Upload ${countFormat.format(items.length)} ${items.length === 1 ? 'item' : 'items'}`}
          </button>

          {blocked && <small className={styles.upload__blocked}>Fix the problems above first — they would mint tokens that resolve to nothing.</small>}

          <small className={styles.upload__note}>
            Artwork is pinned first, then one metadata file per token pointing at it{isLukso ? ', each carrying a keccak256 of its image so the artwork is verifiable' : ''}. Nothing is
            written onchain until you save the base URI.
          </small>
        </>
      )}
    </div>
  )
}
