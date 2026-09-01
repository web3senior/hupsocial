'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { ImageIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { buildLsp4MetadataJson, encodeVerifiableURIFromDigest } from '@/lib/drops'
import { hashIpfsContent, uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import { toast } from '@/components/NextToast'
import styles from './Lsp4MetadataEditor.module.scss'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const emptyLink = () => ({ title: '', url: '' })
const emptyAttribute = () => ({ key: '', value: '' })

/**
 * LSP4 Metadata Editor
 * Every field an LSP7 or LSP8 collection carries in its `LSP4Metadata` document — name,
 * description, icon, artwork, links, attributes — edited as one form and written back as one
 * document.
 *
 * It is one form because LSP4Metadata is one JSON file behind one data key. There is no way to
 * change only the description: the whole document is re-pinned and the key re-pointed, so a form
 * that edited fields piecemeal would have to re-upload everything anyway and would silently drop
 * whatever it had not loaded. That is why this seeds itself from the current document first and
 * refuses to save until it has.
 *
 * @param {Object} props
 * @param {Object} [props.current] The collection's existing metadata, from resolveCollectionMetadata.
 * @param {string} props.name Onchain name, used when the document has none.
 * @param {boolean} [props.busy]
 * @param {Function} props.onSave Called with the encoded VerifiableURI to write to LSP4Metadata.
 */
export default function Lsp4MetadataEditor({ current, name: onchainName, busy = false, onSave }) {
  /*
   * Seeded from the current document at mount, with no effect involved. The caller renders this
   * only once the document has arrived and keys it on the collection address, so a different
   * collection remounts the form rather than mutating it — which is both the idiomatic way to
   * reset state and the reason nothing here has to guard against a refetch landing mid-edit.
   */
  const [name, setName] = useState(() => current?.name || onchainName || '')
  const [description, setDescription] = useState(() => current?.description || '')
  const [icon, setIcon] = useState(() => current?.icon?.url || current?.icon || '')
  const [image, setImage] = useState(() => current?.banner?.url || current?.image?.url || '')
  const [links, setLinks] = useState(() =>
    Array.isArray(current?.links) ? current.links.map((l) => ({ title: l.title ?? '', url: l.url ?? '' })) : [],
  )
  const [attributes, setAttributes] = useState(() =>
    Array.isArray(current?.attributes)
      ? current.attributes.map((a) => ({ key: a.key ?? a.trait_type ?? '', value: String(a.value ?? '') }))
      : [],
  )
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
      setter(`ipfs://${cid}`)
    } catch (err) {
      toast(err.message || 'Image upload failed', 'error')
    } finally {
      setUploading(null)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return toast('A collection needs a name', 'error')

    setSaving(true)
    try {
      /*
       * Each image's digest is the keccak of the bytes the gateway actually serves, not of what
       * was uploaded — a pinning service that re-encodes or a gateway that adds whitespace would
       * otherwise produce a hash nothing can reproduce. `hashIpfsContent` fetches and hashes what
       * is really there, and a null digest degrades to an unverified entry rather than a wrong one.
       */
      const [iconHash, imageHash] = await Promise.all([
        icon ? hashIpfsContent(icon).catch(() => '') : '',
        image ? hashIpfsContent(image).catch(() => '') : '',
      ])

      const document = buildLsp4MetadataJson({
        name: name.trim(),
        description: description.trim(),
        iconUrl: icon,
        iconHash,
        imageUrl: image,
        imageHash,
        links: links.filter((l) => l.url.trim()).map((l) => ({ title: l.title.trim() || l.url.trim(), url: l.url.trim() })),
      })

      // Attributes are not part of buildLsp4MetadataJson's minimal shape, so they go on after —
      // LSP4 types them, unlike the OpenSea convention's untyped trait_type/value pairs.
      document.LSP4Metadata.attributes = attributes
        .filter((a) => a.key.trim() && a.value.trim())
        .map((a) => ({
          key: a.key.trim(),
          value: a.value.trim(),
          type: Number.isNaN(Number(a.value.trim())) ? 'string' : 'number',
        }))

      const uri = await uploadObjectToIPFS(document)
      if (!uri) throw new Error('Could not pin the metadata')

      const normalised = uri.startsWith('ipfs://') ? uri : `ipfs://${uri}`
      const digest = await hashIpfsContent(normalised).catch(() => '')

      await onSave?.(encodeVerifiableURIFromDigest(normalised, digest))
    } catch (err) {
      toast(err.message || 'Could not save the metadata', 'error')
    } finally {
      setSaving(false)
    }
  }

  const disabled = busy || saving || Boolean(uploading)

  return (
    <div className={styles.editor}>
      <div className={styles.editor__images}>
        {[
          { slot: 'icon', label: 'Icon', hint: 'The small square wallets show', value: icon, setter: setIcon },
          { slot: 'image', label: 'Artwork', hint: 'The collection’s main image', value: image, setter: setImage },
        ].map((field) => (
          <label key={field.slot} className={clsx(styles.editor__image, field.value && styles['editor__image--filled'])}>
            {field.value ? (
              <img src={resolveStorageImageUrl(field.value)} alt="" onError={handleBrokenImage} />
            ) : (
              <ImageIcon size={20} weight="light" />
            )}
            <span>
              <strong>{field.label}</strong>
              <small>{uploading === field.slot ? 'Uploading…' : field.hint}</small>
            </span>
            <input type="file" accept="image/*" hidden disabled={disabled} onChange={(e) => pickImage(e, field.setter, field.slot)} />
          </label>
        ))}
      </div>

      <label className={styles.editor__field}>
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
      </label>

      <label className={styles.editor__field}>
        <span>Description</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={disabled} />
      </label>

      <div className={styles.editor__list}>
        <span className={styles.editor__listHead}>Links</span>
        {links.map((link, index) => (
          <div key={index} className={styles.editor__row}>
            <input
              type="text"
              value={link.title}
              placeholder="Title"
              disabled={disabled}
              onChange={(e) => setLinks(links.map((l, i) => (i === index ? { ...l, title: e.target.value } : l)))}
            />
            <input
              type="url"
              value={link.url}
              placeholder="https://"
              disabled={disabled}
              onChange={(e) => setLinks(links.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)))}
            />
            <button type="button" onClick={() => setLinks(links.filter((_, i) => i !== index))} disabled={disabled} aria-label="Remove link">
              <XIcon size={13} />
            </button>
          </div>
        ))}
        <button type="button" className={styles.editor__add} onClick={() => setLinks([...links, emptyLink()])} disabled={disabled}>
          <PlusIcon size={13} /> Add a link
        </button>
      </div>

      <div className={styles.editor__list}>
        <span className={styles.editor__listHead}>
          Attributes <em>collection-level traits</em>
        </span>
        {attributes.map((attribute, index) => (
          <div key={index} className={styles.editor__row}>
            <input
              type="text"
              value={attribute.key}
              placeholder="Key"
              disabled={disabled}
              onChange={(e) => setAttributes(attributes.map((a, i) => (i === index ? { ...a, key: e.target.value } : a)))}
            />
            <input
              type="text"
              value={attribute.value}
              placeholder="Value"
              disabled={disabled}
              onChange={(e) => setAttributes(attributes.map((a, i) => (i === index ? { ...a, value: e.target.value } : a)))}
            />
            <button
              type="button"
              onClick={() => setAttributes(attributes.filter((_, i) => i !== index))}
              disabled={disabled}
              aria-label="Remove attribute"
            >
              <XIcon size={13} />
            </button>
          </div>
        ))}
        <button type="button" className={styles.editor__add} onClick={() => setAttributes([...attributes, emptyAttribute()])} disabled={disabled}>
          <PlusIcon size={13} /> Add an attribute
        </button>
      </div>

      <button type="button" className={styles.editor__save} onClick={handleSave} disabled={disabled}>
        {saving ? 'Pinning and saving…' : 'Save metadata onchain'}
      </button>

      <small className={styles.editor__note}>
        The whole document is re-pinned and the collection re-pointed at it, because LSP4Metadata is one file behind one key
        — there is no way to change a single field on its own.
      </small>
    </div>
  )
}
