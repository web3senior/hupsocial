'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowClockwiseIcon, CheckCircleIcon, ImageIcon, TrashIcon, UploadSimpleIcon, WarningIcon } from '@phosphor-icons/react'
import {
  isArchiverJunk,
  metadataSuffix,
  readTraitManifest,
  readZipEntries,
  sortReadyMadeEntries,
  sortZipEntries,
  validateCollection,
  validateReadyMade,
} from '@/lib/dropUpload'
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
 * The bulk path for a numbered collection. A creator drops in a zip or a folder, checks the
 * preview, and this pins what the collection reads per token. It tells the two things a creator
 * might hand it apart by looking: artwork — images numbered in the filename, traits alongside if
 * any — gets its metadata written here; metadata files already written — one per number, with or
 * without `.json` — are pinned as they are, renamed the way the standard asks.
 *
 * Writing the metadata exists because the alternative is asking an artist to hand-build a
 * thousand LSP4Metadata files, each carrying a keccak256 of its own image's bytes. Nobody does
 * that. We are pinning the bytes, so we can hash them — the verification digests that make LUKSO
 * metadata tamper-evident come out of the upload for free, and the artist never learns the term.
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
  // Finished metadata files, when that is what arrived: { files, ignored, errors, warnings }
  const [readyMade, setReadyMade] = useState(null)
  const [isReading, setIsReading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const [page, setPage] = useState(0)
  const [order, setOrder] = useState(null)
  const [jump, setJump] = useState('')

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null)
  // What landed: the button steps aside for a done mark once there is nothing left to upload
  const [pinned, setPinned] = useState(null)
  // Batches already pinned, kept across a failure so a retry does not re-send them. This is what
  // makes an interrupted upload cheap to resume rather than a full restart.
  const doneBatchesRef = useRef([])

  const isLukso = isLuksoStandard(standardId)
  const suffix = metadataSuffix(standardId)

  const reset = () => {
    setItems([])
    setTraits(new Map())
    setReport(null)
    setReadyMade(null)
    setOrder(null)
    setPage(0)
    setProgress(null)
    setPinned(null)
    doneBatchesRef.current = []
  }

  /** One read path for both ways in: a zip's entries and a folder's files arrive as the same shape. */
  const ingest = async (readEntries, emptyMessage) => {
    reset()
    setIsReading(true)
    try {
      const entries = await readEntries()
      const { images, jsonFiles, ignored } = sortZipEntries(entries)

      if (images.length) {
        const manifest = readTraitManifest(jsonFiles)
        const validation = validateCollection({ images, maxSupply })
        setItems(images)
        setTraits(manifest)
        setReport({ ...validation, ignored: ignored.length, hasManifest: manifest.size > 0 })
        return
      }

      // No artwork at all: perhaps the metadata is already written, one file per number
      const finished = sortReadyMadeEntries(entries)
      if (!finished.files.length) throw new Error(emptyMessage)
      setReadyMade({ files: finished.files, ignored: finished.ignored.length, ...validateReadyMade({ files: finished.files, maxSupply }) })
    } catch (err) {
      toast(err.message || 'Could not read that', 'error')
      reset()
    } finally {
      setIsReading(false)
    }
  }

  const handleFile = (file) => {
    if (!file) return
    ingest(async () => readZipEntries(await file.arrayBuffer()), 'No images or metadata files found in that zip')
  }

  /** A folder pick, or files dropped loose: the same set without the zip step. */
  const handleFiles = (files) => {
    const kept = files.filter((file) => !isArchiverJunk(file.webkitRelativePath || file.name))
    if (!kept.length) return
    ingest(
      () => Promise.all(kept.map(async (file) => ({ name: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))),
      'No images or metadata files found in that folder',
    )
  }

  // Windows reports application/x-zip-compressed, so the extension is the reliable half
  const isZip = (file) => /\.zip$/i.test(file.name) || /zip/i.test(file.type)

  /**
   * A label around a hidden input opens the picker on click but ignores a drop — the file lands on
   * the page instead, which in most browsers means navigating away from the half-filled form. So
   * the drop is handled here, and the same read path serves both ways in.
   */
  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled || isReading) return

    const files = Array.from(event.dataTransfer?.files ?? [])
    if (!files.length) return
    if (files.length === 1 && isZip(files[0])) return handleFile(files[0])
    if (files.some(isZip)) return toast('Drop one .zip, or the files themselves', 'error')
    handleFiles(files)
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
      setPinned({ cid: metadataCid, count: items.length, written: true })
      onPinned?.({ cid: metadataCid, suffix, count: items.length })
      toast(`Pinned ${countFormat.format(items.length)} tokens — check the link, then save it onchain`, 'success')
    } catch (err) {
      toast(err.message || 'Upload failed — press upload again to carry on from where it stopped', 'error')
    } finally {
      setUploading(false)
    }
  }

  /** Finished files go up as one directory, renamed the way this standard resolves them. */
  const handleUploadReadyMade = async () => {
    if (!readyMade || uploading) return

    setUploading(true)
    try {
      // LSP8 appends the bare number, ERC721 the ending — whatever the files were called on disk
      const files = readyMade.files.map((file) => new File([file.bytes], `${file.token}${suffix}`, { type: 'application/json' }))
      const cid = await uploadFolderToIPFS(files)

      setProgress({ percent: 100, done: files.length, total: files.length, estimate: null })
      setPinned({ cid, count: files.length })
      onPinned?.({ cid, suffix, count: files.length })
      toast(`Pinned ${countFormat.format(files.length)} files — check the link, then save it onchain`, 'success')
    } catch (err) {
      toast(err.message || 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  const totalBytes = items.reduce((n, i) => n + i.bytes.byteLength, 0)
  const blocked = Boolean(report?.errors?.length)
  const readyBlocked = Boolean(readyMade?.errors?.length)

  const notices = (errors = [], warnings = []) => (
    <>
      {errors.map((message) => (
        <p key={message} className={clsx(styles.upload__notice, styles['upload__notice--error'])}>
          <WarningIcon size={14} weight="fill" /> {message}
        </p>
      ))}
      {warnings.map((message) => (
        <p key={message} className={styles.upload__notice}>
          <WarningIcon size={14} /> {message}
        </p>
      ))}
    </>
  )

  const progressCard = progress && (
    <div className={styles.upload__progress}>
      <div className={styles.upload__progressHead}>
        <strong>{progress.percent === 100 ? 'Pinned' : 'Uploading…'}</strong>
        <em>{progress.percent}%</em>
      </div>
      <span className={styles.upload__progressTrack}>
        <span style={{ width: `${progress.percent}%` }} />
      </span>
      <small>
        {countFormat.format(progress.done)} of {countFormat.format(progress.total)} uploaded
        {progress.estimate ? ` · ${formatBytes(progress.estimate.bytesPerSecond)}/s · ${formatDuration(progress.estimate.remainingMs)} left` : ''}
      </small>
      <small>
        {progress.percent === 100
          ? 'The link below is filled in. Nothing is written onchain until you save it.'
          : 'Keep this tab open. Finished batches are kept, so an interrupted upload carries on rather than restarting.'}
      </small>
    </div>
  )

  // Once everything is pinned the button has nothing left to do, so it steps aside for the
  // done mark and the one action that still makes sense: starting over with another set
  const doneRow = pinned && (
    <div className={styles.upload__done}>
      <span className={styles.upload__doneBadge}>
        <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
        Pinned {countFormat.format(pinned.count)} {pinned.count === 1 ? 'file' : 'files'}
      </span>
      <button type="button" className={styles.upload__plain} onClick={reset} disabled={disabled}>
        Upload a different set
      </button>
      {pinned.written && (
        <small className={styles.upload__doneNote}>
          Written for you from the images and pinned beside them: one metadata file per token, named by its number — <code>1{suffix}</code>,{' '}
          <code>2{suffix}</code>, … — each pointing at its own picture. You never had to make these.
        </small>
      )}
    </div>
  )

  if (readyMade) {
    const first = readyMade.files[0]?.token
    const last = readyMade.files[readyMade.files.length - 1]?.token
    return (
      <div className={styles.upload}>
        <div className={styles.upload__panel}>
          <div className={styles.upload__head}>
            <div>
              <strong>
                {countFormat.format(readyMade.files.length)} metadata file{readyMade.files.length === 1 ? '' : 's'}
              </strong>
              <small>
                #{first}–#{last} · already written, pinned as they are
                {readyMade.ignored ? ` · ${readyMade.ignored} other file${readyMade.ignored === 1 ? '' : 's'} ignored` : ''}
              </small>
            </div>
            <button type="button" className={styles.upload__plain} onClick={reset} disabled={uploading}>
              Start over
            </button>
          </div>

          {notices(readyMade.errors, readyMade.warnings)}

          <p className={styles.upload__readyNote}>
            Named for {isLukso ? 'LSP8' : 'this standard'} on the way up — <code>1{suffix}</code>, <code>2{suffix}</code>, … — whatever they were
            called on disk, so every token finds its file.
          </p>
        </div>

        {progressCard}

        {doneRow || (
          <button type="button" className={styles.upload__submit} onClick={handleUploadReadyMade} disabled={disabled || uploading || readyBlocked}>
            {uploading ? 'Pinning…' : `Pin ${countFormat.format(readyMade.files.length)} ${readyMade.files.length === 1 ? 'file' : 'files'}`}
          </button>
        )}

        {readyBlocked && <small className={styles.upload__blocked}>Fix the problems above first — they would mint tokens that resolve to nothing.</small>}
      </div>
    )
  }

  return (
    <div className={styles.upload}>
      {!items.length ? (
        <>
          <label
            className={clsx(
              styles.upload__drop,
              isDragging && styles['upload__drop--dragging'],
              (disabled || isReading) && styles['upload__drop--busy'],
            )}
            onDragOver={(event) => {
              // Without preventDefault the browser refuses the drop and opens the file instead
              event.preventDefault()
              if (!isDragging && !disabled && !isReading) setIsDragging(true)
            }}
            onDragLeave={(event) => {
              // Crossing into a child fires dragleave on the parent; only a real exit counts
              if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false)
            }}
            onDrop={handleDrop}
          >
            <UploadSimpleIcon size={22} weight="light" />
            <strong>
              {isReading ? 'Reading the files…' : isDragging ? 'Drop it here' : 'Upload or drop a .zip of your artwork — or your finished metadata files'}
            </strong>
            <small>
              Artwork: one image per token, numbered in the filename — <code>1.png</code>, <code>2.png</code> — and the metadata is
              written for you, with traits from a <code>metadata.json</code> alongside if you have one. Already have the metadata? Drop the
              files themselves, named by number, and they are pinned as they are.
            </small>
            <input type="file" accept=".zip,application/zip" hidden disabled={disabled || isReading} onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>

          <div className={styles.upload__links}>
            {/* The same set without the zip step — a directory pick reads every file inside */}
            <label className={styles.upload__folder}>
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                hidden
                disabled={disabled || isReading}
                onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
              />
              Choose a folder instead
            </label>
            <a className={styles.upload__sample} href={`/api/v1/drops/sample?standard=${standardId}&name=${encodeURIComponent(collectionName || "")}`} download>
              Download a sample folder
            </a>
          </div>
        </>
      ) : (
        <>
          <div className={styles.upload__panel}>
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

            {notices(report?.errors, report?.warnings)}

            <div className={styles.upload__toolbar}>
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
                        disabled={uploading || Boolean(pinned)}
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

            <div className={styles.upload__foot}>
              <span>
                Showing {countFormat.format(page * PAGE_SIZE + 1)}–{countFormat.format(Math.min((page + 1) * PAGE_SIZE, view.length))} of{' '}
                {countFormat.format(view.length)}
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
          </div>

          {progressCard}

          {doneRow || (
            <button type="button" className={styles.upload__submit} onClick={handleUpload} disabled={disabled || uploading || blocked}>
              {uploading ? 'Uploading…' : `Upload ${countFormat.format(items.length)} ${items.length === 1 ? 'item' : 'items'}`}
            </button>
          )}

          {blocked && <small className={styles.upload__blocked}>Fix the problems above first — they would mint tokens that resolve to nothing.</small>}

          {!pinned && (
            <small className={styles.upload__note}>
              Artwork is pinned first, then one metadata file per token — <code>1{suffix}</code>, <code>2{suffix}</code>, … — is written for you, pointing at its own
              image{isLukso ? ' and carrying a keccak256 of it so the artwork is verifiable' : ''}. Nothing is written onchain until you save the link.
            </small>
          )}
        </>
      )}
    </div>
  )
}
