'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { ImageIcon } from '@phosphor-icons/react'
import { uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { toast } from '@/components/NextToast'
// Field styles are shared with the LSP4 editor — same form, different metadata dialect.
// The preview card is this editor's own.
import fields from './Lsp4MetadataEditor.module.scss'
import styles from './ContractUriEditor.module.scss'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Contract URI Editor
 * The collection card an ERC721/1155 keeps behind `contractURI()` — edited through a live
 * preview of the card itself. The banner and artwork are replaced by clicking them in place,
 * the fields below feed the preview as they are typed, and saving pins the whole document as
 * one ERC-7572 JSON handed back as an `ipfs://` URI for `setContractURI`.
 *
 * One form because the document is one file behind one pointer: it seeds from the current
 * document first and re-pins everything, so a save never silently drops a field the owner had
 * not retyped.
 *
 * @param {Object} props
 * @param {Object} [props.current] The existing document, from the collection's contractURI().
 * @param {string} props.name Onchain name, used when the document has none.
 * @param {boolean} [props.busy]
 * @param {Function} props.onSave Called with the ipfs:// URI to write via setContractURI.
 */
export default function ContractUriEditor({ current, name: onchainName, busy = false, onSave }) {
  // Seeded at mount; the caller keys this on the collection address so a new collection
  // remounts the form instead of mutating it mid-edit.
  const [name, setName] = useState(() => current?.name || onchainName || '')
  const [description, setDescription] = useState(() => current?.description || '')
  const [image, setImage] = useState(() => current?.image || current?.image_url || '')
  const [banner, setBanner] = useState(() => current?.banner_image || current?.banner_image_url || '')
  const [externalLink, setExternalLink] = useState(() => current?.external_link || '')
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(false)

  const pickImage = async (event, setter, slot) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error')
    if (file.size > MAX_IMAGE_BYTES) return toast('Image must be under 10 MB', 'error')

    setUploading(slot)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      // Already an ipfs:// URI — wrapping it again produced ipfs://ipfs://… no gateway can serve
      setter(cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`)
    } catch (err) {
      toast(err.message || 'Image upload failed', 'error')
    } finally {
      setUploading(null)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return toast('The collection needs a name', 'error')

    setSaving(true)
    try {
      // Only what is filled in makes it into the document — marketplaces treat a present-but-empty
      // field as an answer, not an omission.
      const document = { name: name.trim() }
      if (description.trim()) document.description = description.trim()
      if (image) document.image = image
      if (banner) document.banner_image = banner
      if (externalLink.trim()) document.external_link = externalLink.trim()

      const uri = await uploadObjectToIPFS(document)
      if (!uri) throw new Error('Could not pin the metadata')

      await onSave?.(uri.startsWith('ipfs://') ? uri : `ipfs://${uri}`)
    } catch (err) {
      toast(err.message || 'Could not save the metadata', 'error')
    } finally {
      setSaving(false)
    }
  }

  const disabled = busy || saving || Boolean(uploading)

  // Shown the way a marketplace shows it: just the site, not the whole address
  const linkLabel = (() => {
    const raw = externalLink.trim()
    if (!raw) return ''
    try {
      return new URL(raw).hostname
    } catch {
      return raw
    }
  })()

  return (
    <div className={fields.editor}>
      <div className={styles.preview}>
        <span className={styles.preview__caption}>Live preview</span>

        {/* The card is the editor: it renders the document exactly the way a marketplace card
            does, so what you see here is what saving publishes. An empty slot names the size it
            wants, in the slot, where the picture will go. */}
        <div className={styles.card}>
          <label className={styles.card__banner}>
            {banner ? (
              <img src={resolveStorageImageUrl(banner)} alt="" onError={handleBrokenImage} />
            ) : (
              <span className={styles.card__size}>
                <ImageIcon size={18} weight="light" />
                <strong>Banner</strong>
                <small>1600 × 640</small>
              </span>
            )}
            <span className={styles.card__hint}>
              <ImageIcon size={13} /> {uploading === 'banner' ? 'Uploading…' : banner ? 'Change banner' : 'Add a banner'}
            </span>
            <input type="file" accept="image/*" hidden disabled={disabled} onChange={(e) => pickImage(e, setBanner, 'banner')} />
          </label>

          <label className={styles.card__artwork}>
            {image ? (
              <img src={resolveStorageImageUrl(image)} alt="" onError={handleBrokenImage} />
            ) : (
              <span className={clsx(styles.card__size, styles['card__size--small'])}>
                <small>1000 × 1000</small>
              </span>
            )}
            <span className={styles.card__hintSmall}>{uploading === 'image' ? 'Uploading…' : image ? 'Change' : 'Add'}</span>
            <input type="file" accept="image/*" hidden disabled={disabled} onChange={(e) => pickImage(e, setImage, 'image')} />
          </label>

          <div className={styles.card__body}>
            <strong className={styles.card__name}>{name.trim() || 'Collection name'}</strong>
            <p className={clsx(styles.card__description, !description.trim() && styles['card__description--empty'])}>
              {description.trim() || 'A few words about the collection — they appear here, under the name.'}
            </p>
            {linkLabel && <span className={styles.card__link}>{linkLabel}</span>}
          </div>
        </div>
      </div>

      <label className={fields.editor__field}>
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
      </label>

      <label className={fields.editor__field}>
        <span>Description</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={disabled} />
      </label>

      <label className={fields.editor__field}>
        <span>Website (optional)</span>
        <input
          type="url"
          value={externalLink}
          placeholder="https://"
          onChange={(e) => setExternalLink(e.target.value)}
          disabled={disabled}
        />
      </label>

      <button type="button" className={fields.editor__save} onClick={handleSave} disabled={disabled}>
        {saving ? 'Pinning and saving…' : 'Save metadata onchain'}
      </button>

      <small className={fields.editor__note}>
        Saving uploads your changes and sends one transaction pointing the collection at them. The artwork inside the
        tokens is untouched — this is only the collection’s public face.
      </small>
    </div>
  )
}
