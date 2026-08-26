'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  ArticleIcon,
  ClockIcon,
  CodeIcon,
  EyeIcon,
  ImageIcon,
  LinkIcon,
  ListBulletsIcon,
  PencilSimpleIcon,
  QuotesIcon,
  SpinnerIcon,
  TextBIcon,
  TextHOneIcon,
  TextItalicIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import NewPost from '@/components/NewPost'
import { toast } from '@/components/NextToast'
import {
  MAX_ARTICLE_BODY_BYTES,
  MAX_ARTICLE_SUBTITLE,
  MAX_ARTICLE_TAGS,
  MAX_ARTICLE_TITLE,
  countWords,
  makeArticleBody,
  makeArticleRef,
  readingTimeLabel,
} from '@/lib/article'
import { uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { renderArticleMarkdown } from '@/lib/markdown'
import { resolveIPFSImageUrl } from '@/lib/storageHelper'
import { handleBrokenImage } from '@/lib/utils'
import styles from './ArticleEditor.module.scss'

/* Covers are pinned at full size and only ever displayed at card or header width, so the same
   ceiling the composer puts on a picture applies here. */
const MAX_COVER_SIZE_MB = 10

const DRAFT_KEY = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}article-draft`
/* Long enough that typing does not write on every keystroke, short enough that a closed tab
   loses at most a sentence. */
const DRAFT_SAVE_DEBOUNCE_MS = 800

const byteFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const wordFormat = new Intl.NumberFormat('en')

const EMPTY_DRAFT = { title: '', subtitle: '', cover: '', tags: [], markdown: '' }

const loadDraft = () => {
  if (typeof window === 'undefined') return EMPTY_DRAFT
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return EMPTY_DRAFT
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
      cover: typeof parsed.cover === 'string' ? parsed.cover : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag) => typeof tag === 'string') : [],
      markdown: typeof parsed.markdown === 'string' ? parsed.markdown : '',
    }
  } catch {
    return EMPTY_DRAFT
  }
}

/**
 * Article Editor
 *
 * Writes markdown, pins it to IPFS under its own CID, then hands the finished reference to the
 * ordinary composer to publish. Nothing here talks to a contract: the composer owns signing,
 * moderation, the gasless path and crash recovery, so an article publishes down exactly the same
 * road every other post takes and inherits every fix made to it.
 */
export default function ArticleEditor() {
  const router = useRouter()

  /* The draft is one state object rather than five pieces of state for a specific reason: it is
     restored from localStorage after mount (reading storage during the first render would make
     the server and client markup disagree), and restoring five separate values would queue five
     renders where one will do. */
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const { title, subtitle, cover, tags, markdown } = draft
  const patch = useCallback((changes) => setDraft((current) => ({ ...current, ...changes })), [])

  const [mode, setMode] = useState('write')
  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  /* Set once the body is pinned; mounting the composer with it is the publish step */
  const [pendingArticle, setPendingArticle] = useState(null)

  const bodyRef = useRef(null)
  const coverInputRef = useRef(null)

  // Restore the stored draft once, after mount. The rule below is about cascading renders, and
  // this is the case it has to make an exception for: localStorage cannot be read during render
  // without desyncing hydration, so the read has to happen here. It runs a single time and sets
  // one state object — which is why the draft is one object and not five useStates.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(loadDraft())
    setDraftLoaded(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // Autosave. Skipped until the stored draft has been read, or the first render would overwrite
  // a real draft with the empty initial state.
  useEffect(() => {
    if (!draftLoaded) return

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        setSavedAt(Date.now())
      } catch {
        /* Quota or a private window — the draft is a convenience, never the source of truth */
      }
    }, DRAFT_SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [draftLoaded, draft])

  const wordCount = useMemo(() => countWords(markdown), [markdown])
  const bodyBytes = useMemo(() => new Blob([markdown]).size, [markdown])
  const isOverSize = bodyBytes > MAX_ARTICLE_BODY_BYTES
  const previewHtml = useMemo(() => (mode === 'preview' ? renderArticleMarkdown(markdown) : ''), [mode, markdown])
  const coverPreview = cover ? resolveIPFSImageUrl(cover, { width: 1200 }) : null

  const canPublish = Boolean(title.trim()) && Boolean(markdown.trim()) && !isOverSize && !isUploadingCover && !isPreparing

  /**
   * Wrap or prefix the current selection with markdown syntax. Operating on the textarea's own
   * selection (rather than appending) is what makes the toolbar usable mid-paragraph.
   * @param {string} before Inserted at the start of the selection.
   * @param {string} [after] Inserted at the end; omit for line-prefix syntax like `> ` or `- `.
   * @param {string} [placeholder] Used when nothing is selected, and left selected afterwards.
   */
  const applyFormat = useCallback(
    (before, after = '', placeholder = 'text') => {
      const el = bodyRef.current
      if (!el) return

      const { selectionStart, selectionEnd, value } = el
      const selected = value.slice(selectionStart, selectionEnd) || placeholder
      const next = `${value.slice(0, selectionStart)}${before}${selected}${after}${value.slice(selectionEnd)}`

      patch({ markdown: next })

      /* Restore the caret after React has committed the new value, otherwise the browser puts
         it at the end and the next keystroke lands in the wrong place. */
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(selectionStart + before.length, selectionStart + before.length + selected.length)
      })
    },
    [patch]
  )

  const handleCoverPick = async (event) => {
    const file = event.target.files?.[0]
    /* Clear immediately so picking the same file twice after a failure still fires a change */
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast('A cover has to be an image', 'error')
      return
    }
    if (file.size > MAX_COVER_SIZE_MB * 1024 * 1024) {
      toast(`Covers are limited to ${MAX_COVER_SIZE_MB}MB`, 'error')
      return
    }

    setIsUploadingCover(true)
    try {
      patch({ cover: await uploadFileToIPFS(file) })
    } catch (error) {
      toast(error.message || 'Could not upload the cover', 'error')
    } finally {
      setIsUploadingCover(false)
    }
  }

  const commitTag = () => {
    const tag = tagInput.trim().replace(/^#/, '').toLowerCase()
    setTagInput('')
    if (!tag) return
    if (tags.includes(tag)) return
    if (tags.length >= MAX_ARTICLE_TAGS) {
      toast(`Up to ${MAX_ARTICLE_TAGS} tags`, 'error')
      return
    }
    patch({ tags: [...tags, tag] })
  }

  const handleTagKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commitTag()
      return
    }
    // Backspace on an empty input removes the last tag — the usual chip-field behaviour
    if (event.key === 'Backspace' && !tagInput && tags.length) {
      patch({ tags: tags.slice(0, -1) })
    }
  }

  const handlePublish = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast('Give the article a title', 'error')
      return
    }
    if (!markdown.trim()) {
      toast('The article has no body yet', 'error')
      return
    }
    if (isOverSize) {
      toast('This article is too long to pin in one piece', 'error')
      return
    }

    setIsPreparing(true)
    try {
      /* The body is pinned before the composer opens, so by the time a transaction is signed the
         CID it references already resolves. Re-publishing identical markdown yields the identical
         CID, so a retry after a rejected transaction costs nothing and pins nothing new. */
      const bodyCid = await uploadObjectToIPFS(makeArticleBody(markdown))
      setPendingArticle(makeArticleRef({ title: trimmedTitle, subtitle: subtitle.trim(), cover, tags, bodyCid, markdown }))
    } catch (error) {
      toast(error.message || 'Could not pin the article body', 'error')
    } finally {
      setIsPreparing(false)
    }
  }

  const handleDiscard = () => {
    if (!window.confirm('Discard this draft? This cannot be undone.')) return
    localStorage.removeItem(DRAFT_KEY)
    setDraft(EMPTY_DRAFT)
    setSavedAt(null)
  }

  /* Only a post that actually reached the indexer clears the draft. Closing the composer without
     publishing — or a transaction the wallet rejected — leaves the article exactly where it was. */
  const handlePublished = () => {
    localStorage.removeItem(DRAFT_KEY)
    router.replace('/')
  }

  return (
    <div className={styles.editor}>
      <header className={styles.editor__header}>
        <div className={styles.editor__heading}>
          <ArticleIcon size={20} weight="fill" />
          <h1>Write an article</h1>
        </div>

        <div className={styles.editor__actions}>
          <button
            type="button"
            className={styles.editor__ghostButton}
            onClick={handleDiscard}
            disabled={isPreparing || (!title && !markdown && !cover)}
          >
            <TrashIcon size={16} />
            <span>Discard</span>
          </button>

          <button type="button" className={styles.editor__publish} onClick={handlePublish} disabled={!canPublish}>
            {isPreparing ? <SpinnerIcon size={16} className={styles.editor__spin} /> : null}
            <span>{isPreparing ? 'Preparing…' : 'Continue'}</span>
          </button>
        </div>
      </header>

      {/* Cover */}
      <section className={styles.editor__cover}>
        {coverPreview ? (
          <>
            <img src={coverPreview} alt="" onError={handleBrokenImage} />
            <button type="button" className={styles.editor__coverRemove} onClick={() => patch({ cover: '' })} aria-label="Remove cover">
              <XIcon size={16} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.editor__coverPick}
            onClick={() => coverInputRef.current?.click()}
            disabled={isUploadingCover}
          >
            {isUploadingCover ? <SpinnerIcon size={20} className={styles.editor__spin} /> : <ImageIcon size={20} />}
            <span>{isUploadingCover ? 'Uploading cover…' : 'Add a cover image'}</span>
          </button>
        )}
        <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverPick} hidden />
      </section>

      {/* Title + subtitle */}
      <input
        className={styles.editor__title}
        value={title}
        onChange={(e) => patch({ title: e.target.value.slice(0, MAX_ARTICLE_TITLE) })}
        placeholder="Title"
        dir="auto"
        aria-label="Article title"
      />
      <input
        className={styles.editor__subtitle}
        value={subtitle}
        onChange={(e) => patch({ subtitle: e.target.value.slice(0, MAX_ARTICLE_SUBTITLE) })}
        placeholder="Subtitle (optional)"
        dir="auto"
        aria-label="Article subtitle"
      />

      {/* Tags */}
      <div className={styles.editor__tags}>
        {tags.map((tag) => (
          <span key={tag} className={styles.editor__tag}>
            {tag}
            <button type="button" onClick={() => patch({ tags: tags.filter((t) => t !== tag) })} aria-label={`Remove ${tag}`}>
              <XIcon size={11} />
            </button>
          </span>
        ))}
        {tags.length < MAX_ARTICLE_TAGS && (
          <input
            className={styles.editor__tagInput}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={commitTag}
            placeholder={tags.length ? 'Add another tag' : 'Add tags'}
            aria-label="Add a tag"
          />
        )}
      </div>

      {/* Write / preview */}
      <div className={styles.editor__bar}>
        <div className={styles.editor__tabs}>
          <button
            type="button"
            className={clsx(styles.editor__tab, mode === 'write' && styles.editor__tab_active)}
            onClick={() => setMode('write')}
          >
            <PencilSimpleIcon size={14} />
            <span>Write</span>
          </button>
          <button
            type="button"
            className={clsx(styles.editor__tab, mode === 'preview' && styles.editor__tab_active)}
            onClick={() => setMode('preview')}
          >
            <EyeIcon size={14} />
            <span>Preview</span>
          </button>
        </div>

        {mode === 'write' && (
          <div className={styles.editor__tools}>
            <button type="button" onClick={() => applyFormat('## ', '', 'Heading')} aria-label="Heading" title="Heading">
              <TextHOneIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('**', '**', 'bold')} aria-label="Bold" title="Bold">
              <TextBIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('_', '_', 'italic')} aria-label="Italic" title="Italic">
              <TextItalicIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('[', '](https://)', 'link text')} aria-label="Link" title="Link">
              <LinkIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('> ', '', 'quote')} aria-label="Quote" title="Quote">
              <QuotesIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('- ', '', 'item')} aria-label="List" title="List">
              <ListBulletsIcon size={16} />
            </button>
            <button type="button" onClick={() => applyFormat('`', '`', 'code')} aria-label="Code" title="Code">
              <CodeIcon size={16} />
            </button>
          </div>
        )}
      </div>

      {mode === 'write' ? (
        <textarea
          ref={bodyRef}
          className={styles.editor__body}
          value={markdown}
          onChange={(e) => patch({ markdown: e.target.value })}
          placeholder="Write your article. Markdown works — headings, links, lists, quotes, code."
          dir="auto"
          aria-label="Article body"
        />
      ) : (
        <div className={styles.editor__preview} dir="auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      )}

      <footer className={styles.editor__footer}>
        <span className={styles.editor__stat}>{wordFormat.format(wordCount)} words</span>
        <span className={styles.editor__stat}>
          <ClockIcon size={13} />
          {readingTimeLabel(wordCount)}
        </span>
        {isOverSize && (
          <span className={styles.editor__over}>
            {byteFormat.format(Math.round(bodyBytes / 1024))}KB — over the {byteFormat.format(MAX_ARTICLE_BODY_BYTES / 1024)}KB limit
          </span>
        )}
        {/* Only once there is something to have saved — an empty editor reporting "Draft saved"
            is telling the author their blank page is safe, which reads as a glitch */}
        {savedAt && !isOverSize && (title || markdown || cover) && <span className={styles.editor__saved}>Draft saved</span>}
      </footer>

      {/* The publish step. The composer carries the article reference into an ordinary post, so
          the network picker, moderation, gasless relay and crash recovery all apply unchanged. */}
      {pendingArticle && (
        <NewPost
          article={pendingArticle}
          text={title.trim()}
          onClose={() => setPendingArticle(null)}
          onConfirmed={handlePublished}
        />
      )}
    </div>
  )
}
