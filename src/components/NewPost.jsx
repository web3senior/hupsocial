'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { Bold, Image as ImageIcon, Italic, MapPin, SlidersHorizontal, SquarePlay, Trash2, X } from 'lucide-react'

import abi from '@/abi/post.json'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import styles from '@/components/NewPost.module.scss'
import Profile from './Profile'
import clsx from 'clsx'
import { resolveIPFSUrl } from '@/lib/storageHelper'

const MAX_MEDIA_ITEMS = 4
const MAX_MEDIA_SIZE_MB = 5
const MAX_POST_LENGTH = 5000

// ■■■ [Utility Helpers] ■■■

const normalizePrefillValue = (value) => {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.length > 0) || ''
  }
  return typeof value === 'string' ? value : ''
}

const createPostContent = (text = '', mediaItems = []) => ({
  version: '1',
  elements: [
    { type: 'text', data: { text } },
    { type: 'media', data: { items: mediaItems } },
  ],
})

const getContentPayload = (existingPost) => {
  const content = existingPost?.content
  if (!content) return null
  if (typeof content === 'string') {
    try { return JSON.parse(content) } catch { return null }
  }
  return content
}

const getContentElement = (content, type) =>
  content?.elements?.find((element) => element?.type === type)

const getInitialPostContent = (text, url, actionType, existingPost) => {
  if (actionType === 'edit' && existingPost) {
    const content = getContentPayload(existingPost)
    const existingText = getContentElement(content, 'text')?.data?.text || ''
    const existingMedia = getContentElement(content, 'media')?.data?.items || []
    return createPostContent(existingText, existingMedia)
  }
  return createPostContent([normalizePrefillValue(text), normalizePrefillValue(url)].filter(Boolean).join('\n'))
}

const getMediaPreviewSrc = (item) => item.localUrl || resolveIPFSUrl(item.cid)

const getSerializablePostContent = (content) => ({
  ...content,
  elements: content.elements.map((element) => {
    if (element.type !== 'media') return element
    return {
      ...element,
      data: {
        ...element.data,
        items: element.data.items.map(({ localUrl, ...item }) => item),
      },
    }
  }),
})

// Convert stored markdown to editor HTML (bold/italic only — used once on init)
const markdownToEditorHtml = (text) => {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
    )
    .join('<br>')
}

// Convert the editor's innerHTML back to markdown for state / on-chain storage
const editorHtmlToMarkdown = (html) => {
  if (!html) return ''
  return html
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/​/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ■■■ [Main Component] ■■■

export default function NewPost({ text = '', url = '', close, onClose, existingPost = null, actionType = 'post' }) {
  const mounted = useClientMounted()

  const initialPostContent = useMemo(
    () => getInitialPostContent(text, url, actionType, existingPost),
    [text, url, actionType, existingPost]
  )

  const [postContent, setPostContent] = useState(() => initialPostContent)
  const [allowComments, setAllowComments] = useState(true)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  const editorRef = useRef(null)
  const composerRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaItemsRef = useRef([])

  const { address, isConnected } = useConnection()
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const postText = postContent.elements[0].data.text
  const mediaItems = postContent.elements[1].data.items
  const isBusy = isSigning || isConfirming || isUploading
  const hasPostBody = postText.trim().length > 0 || mediaItems.length > 0
  const isTextOverLimit = postText.length > MAX_POST_LENGTH

  // Initialize editor with formatted HTML once the component mounts
  useEffect(() => {
    if (!mounted || !editorRef.current) return
    editorRef.current.innerHTML = markdownToEditorHtml(postText)
    editorRef.current.focus()
    // Move cursor to end
    const range = document.createRange()
    const sel = window.getSelection()
    range.selectNodeContents(editorRef.current)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  // Only run on mount — postText intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  const handleClose = useCallback(
    (e) => {
      if (e) e.stopPropagation()
      close?.()
      onClose?.()
    },
    [close, onClose]
  )

  const updateTextContent = (nextText) => {
    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      nextElements[0] = {
        ...nextElements[0],
        data: { ...nextElements[0].data, text: nextText },
      }
      return { ...prevContent, elements: nextElements }
    })
  }

  const handleEditorInput = () => {
    const html = editorRef.current?.innerHTML || ''
    updateTextContent(editorHtmlToMarkdown(html))
  }

  // Force plain-text paste so clipboard HTML doesn't corrupt the editor
  const handlePaste = (event) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()

    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return

    const range = selection.getRangeAt(0)
    range.deleteContents()
    const textNode = document.createTextNode(text)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.setEndAfter(textNode)
    selection.removeAllRanges()
    selection.addRange(range)

    handleEditorInput()
  }

  // Toggle bold/italic using Selection + Range (no deprecated execCommand)
  const applyFormat = (tag) => {
    const editor = editorRef.current
    if (!editor) return

    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return

    const range = selection.getRangeAt(0)

    // Toggle off if the selection/cursor is already inside this tag
    let node = selection.anchorNode
    while (node && node !== editor) {
      if (node.nodeName.toLowerCase() === tag) {
        if (range.collapsed) {
          // Cursor only — insert a plain-text node after the tag so the browser
          // doesn't inherit its formatting for subsequent typing.
          const zws = document.createTextNode('​')
          node.parentNode.insertBefore(zws, node.nextSibling)
          const newRange = document.createRange()
          newRange.setStart(zws, 1)
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          editor.focus()
          return
        }
        // Text is selected — unwrap to strip formatting from the selection
        const parent = node.parentNode
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
        handleEditorInput()
        editor.focus()
        return
      }
      node = node.parentNode
    }

    // Wrap selection in the tag
    if (!range.collapsed) {
      const el = document.createElement(tag)
      try {
        range.surroundContents(el)
      } catch {
        // surroundContents throws when selection crosses element boundaries
        el.appendChild(range.extractContents())
        range.insertNode(el)
      }
      selection.removeAllRanges()
      const newRange = document.createRange()
      newRange.selectNodeContents(el)
      selection.addRange(newRange)
    }

    handleEditorInput()
    editor.focus()
  }

  const uploadFileToIPFS = async (file) => {
    if (!file) return null
    setIsUploading(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const uploadRequest = await fetch('/api/ipfs/file', { method: 'POST', body: data })
      if (!uploadRequest.ok) throw new Error(`Upload failed with status ${uploadRequest.status}`)
      const result = await uploadRequest.json()
      return result.cid
    } catch (error) {
      console.error('Trouble uploading file:', error)
      toast('Error uploading file', 'error')
      return null
    } finally {
      setIsUploading(false)
    }
  }

  const uploadObjectToIPFS = async (json) => {
    setIsUploading(true)
    try {
      const uploadRequest = await fetch('/api/ipfs/object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json().catch(() => ({}))
        throw new Error(errorData.error || `Upload failed with status ${uploadRequest.status}`)
      }
      return uploadRequest.json()
    } catch (error) {
      console.error('Trouble uploading post metadata:', error)
      toast('Error uploading post metadata', 'error')
      throw error
    } finally {
      setIsUploading(false)
    }
  }

  const triggerFileInput = (type) => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) {
      toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
      return
    }
    setSelectedMediaType(type)
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*'
      fileInputRef.current.click()
    }
  }

  const getMediaDimensions = (file, type) => {
    return new Promise((resolve) => {
      const localUrl = URL.createObjectURL(file)
      if (type === 'image') {
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(localUrl); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
        img.onerror = () => { URL.revokeObjectURL(localUrl); resolve({ width: undefined, height: undefined }) }
        img.src = localUrl
      } else if (type === 'video') {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.onloadedmetadata = () => { URL.revokeObjectURL(localUrl); resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }) }
        video.onerror = () => { URL.revokeObjectURL(localUrl); resolve({ width: undefined, height: undefined, duration: 0 }) }
        video.src = localUrl
      } else {
        resolve({ width: undefined, height: undefined })
      }
    })
  }

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || mediaItems.length >= MAX_MEDIA_ITEMS) return

    const sizeInMB = file.size / (1024 * 1024)
    if (sizeInMB > MAX_MEDIA_SIZE_MB) {
      toast(`File size error. Maximum size is ${MAX_MEDIA_SIZE_MB}MB`, 'error')
      return
    }

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isExpectedType = (isImage && selectedMediaType === 'image') || (isVideo && selectedMediaType === 'video')
    if (!isExpectedType) {
      toast(`Please select a ${selectedMediaType} file`, 'error')
      return
    }

    const dimensions = await getMediaDimensions(file, selectedMediaType)
    const cid = await uploadFileToIPFS(file)
    if (!cid) return

    const localUrl = URL.createObjectURL(file)
    const nextItem = {
      type: selectedMediaType,
      cid,
      alt: `Hup asset ${selectedMediaType} | ${postText.slice(0, 30)}...`,
      storage: 'IPFS',
      mimeType: file.type,
      localUrl,
      width: dimensions.width,
      height: dimensions.height,
      duration: selectedMediaType === 'video' ? dimensions.duration || 0 : undefined,
      spoiler: false,
    }

    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      const mediaElement = nextElements[1]
      nextElements[1] = {
        ...mediaElement,
        data: { ...mediaElement.data, items: [...mediaElement.data.items, nextItem] },
      }
      return { ...prevContent, elements: nextElements }
    })
  }

  const handleRemoveMedia = (itemIndex) => {
    const item = mediaItems[itemIndex]
    if (item?.localUrl) URL.revokeObjectURL(item.localUrl)
    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      const mediaElement = nextElements[1]
      nextElements[1] = {
        ...mediaElement,
        data: { ...mediaElement.data, items: mediaElement.data.items.filter((_, index) => index !== itemIndex) },
      }
      return { ...prevContent, elements: nextElements }
    })
  }

  const toggleSpoiler = (itemIndex) => {
    setPostContent((prevContent) => {
      const nextElements = prevContent.elements.map((element, elementIndex) => {
        if (elementIndex !== 1) return element
        return {
          ...element,
          data: {
            ...element.data,
            items: element.data.items.map((item, index) =>
              index === itemIndex ? { ...item, spoiler: !item.spoiler } : item
            ),
          },
        }
      })
      return { ...prevContent, elements: nextElements }
    })
  }

  const handleCreatePost = async (event) => {
    event.preventDefault()

    if (!isConnected || !address) {
      toast('Connect your wallet before posting', 'error')
      return
    }

    if (!hasPostBody) {
      editorRef.current?.focus()
      return
    }

    if (isTextOverLimit) {
      toast(`Post is too long. Maximum ${MAX_POST_LENGTH} characters`, 'error')
      return
    }

    try {
      const resultIPFS = await uploadObjectToIPFS(getSerializablePostContent(postContent))
      const metadata = resultIPFS.cid
      if (!metadata) throw new Error('CID not found')

      const activeChain = getActiveChain()
      const postContractAddress = activeChain?.[1]?.hup || process.env.NEXT_PUBLIC_CONTRACT_POST

      if (actionType === 'edit') {
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'update',
          args: [address, existingPost.id, metadata, allowComments],
        })
      } else {
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'create',
          args: [address, 0, metadata, 0, allowComments],
        })
      }
    } catch (error) {
      console.error(error)
      toast(error.message || 'Unable to create post', 'error')
    }
  }

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    mediaItemsRef.current = mediaItems
  }, [mediaItems])

  useEffect(() => {
    if (!isConfirmed) return
    localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`, '')
    toast('Your post will appear once the transaction is confirmed.', 'success')
    handleClose()
  }, [handleClose, isConfirmed])

  useEffect(() => {
    return () => {
      mediaItemsRef.current.forEach((item) => {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl)
      })
    }
  }, [])

  if (!mounted) return null

  return (
    <section className={styles.newPost} aria-label="New thread composer" onClick={(e) => e.stopPropagation()}>
      <header className={styles.header}>
        <button type="button" className={styles.cancelButton} onClick={(e) => handleClose(e)}>
          Cancel
        </button>
        <h2>{actionType === 'edit' ? 'Edit post' : 'New post'}</h2>
      </header>

      <form className={styles.form} onSubmit={handleCreatePost}>
        <input ref={fileInputRef} type="file" onChange={handleFileSelect} className={styles.fileInput} multiple={false} />

        <div ref={composerRef} className={styles.composer}>
          <Profile variant="full" creator={address} />

          <div className={styles.composerBody}>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={styles.editor}
              onInput={handleEditorInput}
              onPaste={handlePaste}
              data-placeholder="What's happening?"
            />

            <div className={styles.toolbar} aria-label="Post tools">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerFileInput('image')}
                aria-label="Add image"
                disabled={isBusy}
              >
                <ImageIcon size={22} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerFileInput('video')}
                aria-label="Add video"
                disabled={isBusy}
              >
                <SquarePlay size={22} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat('strong')}
                aria-label="Bold"
                disabled={isBusy}
              >
                <Bold size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat('em')}
                aria-label="Italic"
                disabled={isBusy}
              >
                <Italic size={20} strokeWidth={1.8} />
              </button>
              <button type="button" aria-label="Location support coming soon" title="Location support coming soon" disabled>
                <MapPin size={22} strokeWidth={1.8} />
              </button>
            </div>

            <div className={styles.composerMeta}>
              <span>{mediaItems.length}/{MAX_MEDIA_ITEMS} media</span>
              <span className={clsx({ [styles.metaDanger]: isTextOverLimit })}>
                {postText.length}/{MAX_POST_LENGTH}
              </span>
            </div>

            {mediaItems.length > 0 && (
              <div className={styles.mediaGrid}>
                {mediaItems.map((item, index) => {
                  const mediaSrc = getMediaPreviewSrc(item)
                  return (
                    <figure key={`${item.cid || item.localUrl || index}`} className={styles.mediaItem}>
                      {item.type === 'image' ? (
                        <img src={mediaSrc} alt={item.alt || ''} className={item.spoiler ? styles.spoiler : undefined} />
                      ) : (
                        <video src={mediaSrc} controls className={item.spoiler ? styles.spoiler : undefined} />
                      )}
                      <figcaption>
                        <button type="button" onClick={() => toggleSpoiler(index)}>
                          <X size={14} />
                          <span>{item.spoiler ? 'Show' : 'Spoiler'}</span>
                        </button>
                        <button type="button" onClick={() => handleRemoveMedia(index)}>
                          <Trash2 size={14} />
                          <span>Remove</span>
                        </button>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            )}

            {isUploading && (
              <div className={styles.uploading}>
                <ContentSpinner />
                <span>Uploading media...</span>
              </div>
            )}
          </div>
        </div>

        <footer className={styles.footer}>
          <div className={styles.postOptions}>
            <button
              type="button"
              className={styles.postOptionsButton}
              onClick={() => setIsOptionsOpen((value) => !value)}
              aria-expanded={isOptionsOpen}
              aria-controls="new-post-options-panel"
            >
              <SlidersHorizontal size={22} strokeWidth={1.8} />
              <span>Post Options</span>
            </button>

            {isOptionsOpen && (
              <div id="new-post-options-panel" className={styles.optionsPanel}>
                <label htmlFor="allowComments">Allow comments</label>
                <select
                  id="allowComments"
                  name="allowComments"
                  value={allowComments ? 'true' : 'false'}
                  onChange={(event) => setAllowComments(event.target.value === 'true')}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            )}
          </div>

          <button type="submit" className={styles.postButton} disabled={isBusy || !hasPostBody || isTextOverLimit}>
            {isConfirming
              ? actionType === 'edit' ? 'Updating...' : 'Posting...'
              : isSigning
                ? 'Signing...'
                : actionType === 'edit' ? 'Update' : 'Post'}
          </button>
        </footer>
      </form>
    </section>
  )
}
