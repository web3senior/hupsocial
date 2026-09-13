'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { uploadFileToIPFS } from '@/lib/ipfsUpload'
import { normalizeIpfsUri, resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  ABOUT_MAX,
  TOKEN_PAGE_EDIT_ACTION,
  LINK_TITLE_MAX,
  MAX_LINKS,
  TAGLINE_MAX,
  tokenPageEditSubject,
  sanitizeTokenPage,
} from '@/lib/tokenPage'
import { buildSignatureMessage } from '@/lib/walletSignature'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import DialogHeader from '@/components/ui/DialogHeader'
import TextField from '@/components/ui/TextField'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import styles from './TokenManageDialog.module.scss'

/* A banner is laid out full-bleed across a card that tops out near 900 CSS px */
const BANNER_MAX_BYTES = 4 * 1024 * 1024

const emptyLink = () => ({ title: '', url: '' })

/** The stored page as the form holds it — every control needs a string, never null. */
const toDraft = (page) => ({
  tagline: page?.tagline ?? '',
  about: page?.about ?? '',
  banner_cid: page?.banner_cid ?? '',
  website: page?.website ?? '',
  x_handle: page?.x_handle ?? '',
  telegram: page?.telegram ?? '',
  discord: page?.discord ?? '',
  farcaster: page?.farcaster ?? '',
  links: page?.links?.length ? page.links.map((link) => ({ ...link })) : [emptyLink()],
})

/**
 * Token Manage Dialog
 * Where a creator writes the half of their token page that is theirs to write.
 *
 * Nothing here touches the chain, and for most tokens there is nothing it could touch: a launch's
 * metadata is emitted once and never stored, and a contract Hup never deployed has no field for
 * this at all. So the copy lives beside the token rather than inside it, authorised by a signature
 * instead of a transaction — one prompt, no gas, and the server can still prove the edit came from
 * whoever the chain says speaks for the token (its Hup creator, or its `owner()`).
 *
 * The same sanitiser the API runs is applied to the draft before it is sent, so what the creator
 * sees in the preview is what gets stored — a pasted x.com URL becomes a handle here rather than
 * silently becoming one on the server.
 *
 * @param {Object} props
 * @param {number} props.networkId
 * @param {string} props.tokenAddress The token contract — what the page is keyed on.
 * @param {string} [props.symbol] Ticker, for the dialog's own labels.
 * @param {Object|null} props.page Currently stored page, or null.
 * @param {() => void} props.onClose
 * @param {(page: Object) => void} props.onSaved Hands the saved page back to the page behind.
 */
export default function TokenManageDialog({ networkId, tokenAddress, symbol, page, onClose, onSaved }) {
  const dialogRef = useRef(null)
  const { address } = useConnection()
  const { signMessageAsync } = useSignMessage()

  const [draft, setDraft] = useState(() => toDraft(page))
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const setField = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }))

  const setLink = (index, field) => (event) =>
    setDraft((current) => ({
      ...current,
      links: current.links.map((link, at) => (at === index ? { ...link, [field]: event.target.value } : link)),
    }))

  const addLink = () =>
    setDraft((current) =>
      current.links.length >= MAX_LINKS ? current : { ...current, links: [...current.links, emptyLink()] },
    )

  const removeLink = (index) =>
    setDraft((current) => {
      const links = current.links.filter((_, at) => at !== index)
      return { ...current, links: links.length > 0 ? links : [emptyLink()] }
    })

  const handleBanner = async (event) => {
    const file = event.target.files?.[0]
    // Clearing the input means picking the same file twice still fires a change
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('The banner has to be an image.')
      return
    }
    if (file.size > BANNER_MAX_BYTES) {
      setError('That banner is over 4MB — pick a smaller image.')
      return
    }

    setError('')
    setIsUploading(true)
    try {
      // The uploader hands back a bare CID; stored as an ipfs:// URI so the banner reference
      // reads the same way as every other stored image on the launch
      const cid = await uploadFileToIPFS(file)
      setDraft((current) => ({ ...current, banner_cid: normalizeIpfsUri(cid) }))
    } catch {
      setError('The banner could not be uploaded. Try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSaving || isUploading) return

    setError('')
    setIsSaving(true)

    try {
      // Cleaned before signing, so the signature covers exactly what will be stored
      const clean = sanitizeTokenPage(draft)
      const message = buildSignatureMessage(TOKEN_PAGE_EDIT_ACTION, tokenPageEditSubject(networkId, tokenAddress))
      const signature = await signMessageAsync({ message })

      const response = await fetch(`/api/v1/tokens/${networkId}/${tokenAddress}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature, page: clean }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || !result.success) {
        setError(result.error || 'The page could not be saved.')
        return
      }

      onSaved?.(result.data)
      toast('Token page updated', 'success')
      dialogRef.current?.close()
    } catch (err) {
      // A rejected signature is a decision, not a failure worth an error message
      const rejected = /reject|denied|cancel/i.test(err?.message ?? '')
      if (!rejected) setError('The page could not be saved. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const bannerUrl = draft.banner_cid ? resolveStorageImageUrl(draft.banner_cid) : null
  const busy = isSaving || isUploading

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.manage}
      aria-label={`Edit the ${symbol ? `$${symbol}` : 'token'} page`}
      onClick={(event) => event.stopPropagation()}
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
      onCancel={(event) => event.stopPropagation()}
    >
      <DialogHeader
        title={symbol ? `Edit $${symbol} page` : 'Edit token page'}
        onCancel={() => dialogRef.current?.close()}
        compact
      />

      <form className={styles.manage__body} onSubmit={handleSubmit}>
        <section className={styles.manage__section}>
          <h3 className={styles.manage__legend}>Banner</h3>
          <div className={styles.banner}>
            {bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.banner__preview} src={bannerUrl} alt="Banner preview" />
            ) : (
              <p className={styles.banner__placeholder}>No banner yet</p>
            )}
            <div className={styles.banner__actions}>
              <label className={styles.banner__pick}>
                {draft.banner_cid ? 'Replace' : 'Upload'}
                <input type="file" accept="image/*" onChange={handleBanner} disabled={busy} hidden />
              </label>
              {draft.banner_cid && (
                <button
                  type="button"
                  className={styles.banner__clear}
                  onClick={() => setDraft((current) => ({ ...current, banner_cid: '' }))}
                  disabled={busy}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {isUploading && <p className={styles.manage__note}>Uploading…</p>}
        </section>

        <section className={styles.manage__section}>
          <h3 className={styles.manage__legend}>What this token is</h3>
          <TextField
            label="Tagline"
            value={draft.tagline}
            onChange={setField('tagline')}
            maxLength={TAGLINE_MAX}
            placeholder="One line your community would repeat"
            disabled={busy}
            hint={`${draft.tagline.length}/${TAGLINE_MAX}`}
          />
          <TextField
            label="About"
            multiline
            rows={6}
            value={draft.about}
            onChange={setField('about')}
            maxLength={ABOUT_MAX}
            placeholder="What it is, who it's for, what you're building. Blank lines start new paragraphs."
            disabled={busy}
            hint={`${draft.about.length}/${ABOUT_MAX}`}
          />
        </section>

        <section className={styles.manage__section}>
          <h3 className={styles.manage__legend}>Where to find you</h3>
          <TextField
            label="Website"
            value={draft.website}
            onChange={setField('website')}
            placeholder="yourtoken.xyz"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <div className={styles.manage__pair}>
            <TextField
              label="X"
              value={draft.x_handle}
              onChange={setField('x_handle')}
              placeholder="@handle"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <TextField
              label="Telegram"
              value={draft.telegram}
              onChange={setField('telegram')}
              placeholder="t.me/yourgroup"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          <div className={styles.manage__pair}>
            <TextField
              label="Discord"
              value={draft.discord}
              onChange={setField('discord')}
              placeholder="discord.gg/invite"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <TextField
              label="Farcaster"
              value={draft.farcaster}
              onChange={setField('farcaster')}
              placeholder="@handle"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
        </section>

        <section className={styles.manage__section}>
          <h3 className={styles.manage__legend}>Other links</h3>
          <ul className={styles.linkRows}>
            {draft.links.map((link, index) => (
              // Rows are positional and reorderable only by the creator retyping them, so the
              // index is their identity — a url key would remount the field being typed into
              <li className={styles.linkRows__row} key={index}>
                <TextField
                  label="Label"
                  value={link.title}
                  onChange={setLink(index, 'title')}
                  maxLength={LINK_TITLE_MAX}
                  placeholder="Docs"
                  disabled={busy}
                  className={styles.linkRows__title}
                />
                <TextField
                  label="URL"
                  value={link.url}
                  onChange={setLink(index, 'url')}
                  placeholder="docs.yourtoken.xyz"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  className={styles.linkRows__url}
                />
                <button
                  type="button"
                  className={styles.linkRows__remove}
                  onClick={() => removeLink(index)}
                  disabled={busy}
                  title="Remove this link"
                >
                  <TrashIcon size={16} aria-hidden="true" />
                  <span className="sr-only">Remove link</span>
                </button>
              </li>
            ))}
          </ul>
          {draft.links.length < MAX_LINKS && (
            <button type="button" className={styles.manage__add} onClick={addLink} disabled={busy}>
              <PlusIcon size={14} aria-hidden="true" />
              Add a link
            </button>
          )}
        </section>

        {error && (
          <p className={styles.manage__error} role="alert">
            {error}
          </p>
        )}

        <footer className={styles.manage__footer}>
          <p className={styles.manage__note}>
            Saving asks your wallet for a signature so we know the edit is yours. It costs no gas.
          </p>
          <button type="submit" className={styles.manage__submit} disabled={busy}>
            {isSaving ? 'Saving…' : 'Save page'}
          </button>
        </footer>
      </form>
    </NativeDialog>
  )
}
