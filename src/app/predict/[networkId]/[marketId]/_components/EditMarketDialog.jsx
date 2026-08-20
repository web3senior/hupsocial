'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import useSWR from 'swr'
import { ImageIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { parseJsonArray } from '@/lib/predict'
import NativeDialog from '@/components/ui/NativeDialog'
import { toast } from '@/components/NextToast'
import styles from './EditMarketDialog.module.scss'

const MIN_OUTCOMES = 2
const MAX_OUTCOMES = 16

/**
 * Edit Market Dialog
 * Creator-only editor for a market's metadata (title, description, outcomes, cover image) —
 * the same pre-first-bet window the contract enforces (updateMarketMetadata reverts once
 * stakes exist). With no bets every outcome pool is zero, so outcomes can be added, removed,
 * and relabeled freely. Saving uploads a fresh metadata JSON to IPFS and swaps the market's
 * CID (and outcome count) onchain.
 * @param {Object} props
 * @param {Object} props.market The indexed market row (title, description, outcome_labels, image_cid).
 * @param {string|number} props.marketId The market's onchain id.
 * @param {string} props.viewer The connected wallet (the creator, per the visibility gate).
 * @param {Function} props.onAction MarketDetail's submitTx — (functionName, args, label).
 * @param {boolean} props.isBusy True while any market transaction is in flight.
 */
const EditMarketDialog = forwardRef(function EditMarketDialog({ market, marketId, viewer, onAction, isBusy }, ref) {
  const dialogRef = useRef(null)
  const imageInputRef = useRef(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [outcomeLabels, setOutcomeLabels] = useState([])
  const [image, setImage] = useState('')
  const [category, setCategory] = useState('')

  // Taxonomy lives in the market_categories DB table (runtime-editable) — only the slug
  // travels in the metadata JSON
  const { data: categoriesPayload } = useSWR('/api/v1/predict/categories', (url) => fetch(url).then((res) => res.json()))
  const categories = categoriesPayload?.data ?? []
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => {
      // Seed the form from the freshest indexed row every time it opens, so a reopen
      // after an outside refresh never shows stale drafts
      setTitle(market.title || '')
      setDescription(market.description || '')
      setOutcomeLabels(parseJsonArray(market.outcome_labels).map((outcome) => outcome.label || ''))
      setImage(market.image_cid || '')
      setCategory(market.category || '')
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const setOutcomeLabel = (index, value) => {
    setOutcomeLabels((labels) => labels.map((label, i) => (i === index ? value : label)))
  }

  const addOutcome = () => {
    setOutcomeLabels((labels) => (labels.length < MAX_OUTCOMES ? [...labels, ''] : labels))
  }

  const removeOutcome = (index) => {
    setOutcomeLabels((labels) => (labels.length > MIN_OUTCOMES ? labels.filter((_, i) => i !== index) : labels))
  }

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Image must be under 10 MB', 'error')
      return
    }

    setIsImageUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setImage(cid)
    } catch (err) {
      toast(err.message || 'Image upload failed. Please try again.', 'error')
    } finally {
      setIsImageUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const labels = outcomeLabels.map((label) => label.trim())
    if (labels.some((label) => !label)) {
      toast('Every outcome needs a name', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS({
        title: title.trim(),
        description: description.trim(),
        outcomes: labels.map((label) => ({ label })),
        image,
        ...(category ? { category } : {}),
      })
    } catch (err) {
      toast(err.message || 'Failed to upload market details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    await onAction('updateMarketMetadata', [viewer, BigInt(marketId), labels.length, cid], 'Market details updated')
    dialogRef.current?.close()
  }

  const busy = isBusy || isUploading || isImageUploading
  const imageUrl = image ? resolveStorageImageUrl(image, { width: 600 }) || image : null

  return (
    <NativeDialog ref={dialogRef} className={styles.editMarket} aria-label="Edit market details" onClick={(e) => e.stopPropagation()}>
      <header className={styles.editMarket__header}>
        <h3>Edit market details</h3>
        <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.editMarket__close}>
          <XIcon size={18} />
        </button>
      </header>

      <p className={styles.editMarket__hint}>
        Only you (the creator) can edit, and only until the first bet — the question bettors stake on never changes under
        them. Changes appear once the indexer catches up.
      </p>

      <form className={styles.editMarket__form} onSubmit={handleSubmit}>
        <label className={styles.editMarket__field}>
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are people predicting?"
            maxLength={140}
            disabled={busy}
            required
          />
        </label>

        <label className={styles.editMarket__field}>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Resolution criteria, sources, context…"
            rows={3}
            maxLength={1000}
            disabled={busy}
          />
        </label>

        {categories.length > 0 && (
          <label className={styles.editMarket__field}>
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
              <option value="">No category</option>
              {categories.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.emoji ? `${entry.emoji} ` : ''}
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className={styles.editMarket__outcomes}>
          <legend>Outcomes</legend>
          {outcomeLabels.map((label, index) => (
            // Index is the identity here — outcome ids ARE zero-based positions onchain
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} className={styles.editMarket__outcomeRow}>
              <input
                type="text"
                value={label}
                onChange={(e) => setOutcomeLabel(index, e.target.value)}
                placeholder={`Outcome #${index + 1}`}
                maxLength={60}
                disabled={busy}
                required
              />
              <button
                type="button"
                onClick={() => removeOutcome(index)}
                disabled={busy || outcomeLabels.length <= MIN_OUTCOMES}
                aria-label={`Remove outcome ${index + 1}`}
                className={styles.editMarket__removeOutcome}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          ))}
          {outcomeLabels.length < MAX_OUTCOMES && (
            <button type="button" onClick={addOutcome} disabled={busy} className={styles.editMarket__addOutcome}>
              <PlusIcon size={14} />
              Add outcome
            </button>
          )}
        </fieldset>

        <div className={styles.editMarket__image}>
          {imageUrl && <img src={imageUrl} alt="" />}
          <div className={styles.editMarket__imageActions}>
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy}>
              <ImageIcon size={14} />
              {isImageUploading ? 'Uploading…' : image ? 'Replace image' : 'Add cover image'}
            </button>
            {image && (
              <button type="button" onClick={() => setImage('')} disabled={busy} aria-label="Remove image">
                <TrashIcon size={14} />
                Remove
              </button>
            )}
          </div>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImageSelect} />
        </div>

        <button type="submit" className={styles.editMarket__submit} disabled={busy}>
          {isUploading ? 'Uploading…' : 'Save changes'}
        </button>
      </form>
    </NativeDialog>
  )
})

export default EditMarketDialog
