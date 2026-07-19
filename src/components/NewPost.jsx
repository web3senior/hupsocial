'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import HupCommunityABI from '@/abis/HupCommunity'
import { getCachedIdentityPrivKeyHex, unwrapContentKey, encryptPostContent } from '@/lib/communityVault'
import { FadersHorizontalIcon, GifIcon, ImageIcon, MapPinIcon, MicrophoneIcon, MonitorPlayIcon, StorefrontIcon, TextBIcon, TextItalicIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import abi from '@/abi/post.json'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import { CONTRACTS } from '@/config/wagmi'
import { ContentType } from '@/lib/content'
import { renderMarkdown } from '@/lib/markdown'
import styles from '@/components/NewPost.module.scss'
import NativeDialog from '@/components/ui/NativeDialog'
import GifPicker from '@/components/GifPicker'
import SellNftModal from '@/components/SellNftModal'
import Profile from './Profile'
import MediaGallery from './Gallery'
import clsx from 'clsx'
import { resolveIPFSUrl, resolveIPFSImageUrl } from '@/lib/storageHelper'
import { uploadFileToIPFS as uploadToIPFS } from '@/lib/ipfs'

const MAX_MEDIA_ITEMS = 8
const MAX_MEDIA_SIZE_MB = 10
const MAX_POST_LENGTH = 5000
const MAX_HISTORY_ENTRIES = 100
const HISTORY_DEBOUNCE_MS = 300

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

const getDraftStorageKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`

// Media items are already uploaded to IPFS by the time they land in state, so a saved
// draft's cids stay resolvable even after a refresh drops the in-memory blob URLs.
const loadDraftContent = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getDraftStorageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.elements) ? parsed : null
  } catch {
    return null
  }
}

const getInitialPostContent = (text, url, actionType, existingPost) => {
  if (actionType === 'edit' && existingPost) {
    const content = getContentPayload(existingPost)
    const existingText = getContentElement(content, 'text')?.data?.text || ''
    const existingMedia = getContentElement(content, 'media')?.data?.items || []
    return createPostContent(existingText, existingMedia)
  }

  const hasPrefill = Boolean(normalizePrefillValue(text) || normalizePrefillValue(url))
  const draft = !hasPrefill && actionType === 'post' ? loadDraftContent() : null
  if (draft) return draft

  return createPostContent([normalizePrefillValue(text), normalizePrefillValue(url)].filter(Boolean).join('\n'))
}

// Extract the text/media of the post being replied to, matching Post.jsx's content-shape handling
const getReplyTargetText = (target) => {
  if (!target) return ''
  if (target?.content?.encrypted) return '🔒 Encrypted community post — open the community to view'
  if (target?.content?.elements?.length > 1) return target.content.elements[0]?.data?.text || ''
  return `${target?.content || ''}`
}

const getReplyTargetMedia = (target) =>
  target?.content?.elements?.length > 1 ? target.content.elements[1]?.data?.items || [] : []

const getMediaPreviewSrc = (item) =>
  item.localUrl || (item.type === 'image' ? resolveIPFSImageUrl(item.cid, { width: 800 }) : resolveIPFSUrl(item.cid))

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

// Caret position as a child-index path from the editor root — plain node references
// would go stale when an undo/redo restore replaces the editor's innerHTML
const getCaretState = (editor) => {
  const selection = window.getSelection()
  if (!editor || !selection || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return null
  const path = []
  let node = range.startContainer
  while (node && node !== editor) {
    path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node))
    node = node.parentNode
  }
  return { path, offset: range.startOffset }
}

const restoreCaretState = (editor, caret) => {
  let node = editor
  let valid = Boolean(caret)
  if (valid) {
    for (const index of caret.path) {
      if (!node.childNodes[index]) {
        valid = false
        break
      }
      node = node.childNodes[index]
    }
  }
  const range = document.createRange()
  if (valid) {
    const maxOffset = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length
    range.setStart(node, Math.min(caret.offset, maxOffset))
    range.collapse(true)
  } else {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

// ■■■ [Main Component] ■■■

export default function NewPost({ text = '', url = '', close, onClose, existingPost = null, actionType = 'post', replyTarget = null, quoteTarget = null, communityTarget = null, onConfirmed }) {
  const mounted = useClientMounted()

  const initialPostContent = useMemo(
    () => getInitialPostContent(text, url, actionType, existingPost),
    [text, url, actionType, existingPost]
  )

  const isComment = actionType === 'comment'
  const isQuote = actionType === 'quote' && Boolean(quoteTarget)
  // Both replies and quotes preview the post they target with the same card
  const previewTarget = isComment ? replyTarget : isQuote ? quoteTarget : null
  const previewTargetText = useMemo(() => getReplyTargetText(previewTarget), [previewTarget])
  const previewTargetMedia = useMemo(() => getReplyTargetMedia(previewTarget), [previewTarget])
  const previewTargetHandle = previewTarget?.wallet_address
    ? `${previewTarget.wallet_address.slice(0, 6)}…${previewTarget.wallet_address.slice(-4)}`
    : ''

  const [postContent, setPostContent] = useState(() => initialPostContent)
  const [allowComments, setAllowComments] = useState(true)
  const [nftListing, setNftListing] = useState(null)
  const [showSellNftModal, setShowSellNftModal] = useState(false)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  const editorRef = useRef(null)
  const dialogRef = useRef(null)
  const composerRef = useRef(null)
  const fileInputRef = useRef(null)
  const gifPickerRef = useRef(null)
  const mediaItemsRef = useRef([])
  // Undo/redo history for the contenteditable editor. The paste handler and applyFormat
  // mutate the DOM programmatically (no execCommand), which the browser's native undo
  // stack can't track — so Ctrl+Z is backed by these snapshots instead.
  const historyRef = useRef({ stack: [], index: -1, timer: null, restoring: false })

  const { address, isConnected } = useConnection()
  const { data: hash, isPending: isSigning, error: submitError, mutate: writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  // Which community this submission belongs to, if any: an explicit community composer target
  // (posting from a community page), the replied-to post's community, or the quoted post's
  // community — quotes and replies inherit the community so they stay inside it instead of
  // leaking to the public feed.
  const communityContext = communityTarget
    ? { communityId: communityTarget.communityId, networkId: communityTarget.networkId }
    : replyTarget?.community_id
    ? { communityId: replyTarget.community_id, networkId: replyTarget.network_id }
    : quoteTarget?.community_id
    ? { communityId: quoteTarget.community_id, networkId: quoteTarget.network_id }
    : null

  // Read client on the community's network — replies/quotes land on the parent's chain, and the
  // encryption checks below must query that chain's community contract, not the wallet's chain.
  const communityPublicClient = usePublicClient({
    chainId: communityContext?.networkId ? Number(communityContext.networkId) : undefined,
  })

  // Everything inside an encrypted community stays encrypted — posts, replies, and quotes alike.
  // Encrypted-type community with an initialized key → seal with the community content key;
  // plaintext community → tag the content with communityId so cidex can verify + surface it in
  // the community feed. No key or locked vault → block rather than publish a plaintext leak.
  const sealForCommunity = async (plainContent) => {
    const communityId = communityContext?.communityId
    const communityContract = CONTRACTS[`chain${communityContext?.networkId}`]?.community
    if (!communityId || !communityContract || !communityPublicClient) return plainContent

    const read = (functionName, args) =>
      communityPublicClient.readContract({ address: communityContract, abi: HupCommunityABI, functionName, args })

    let membershipType
    let currentKeyVersion
    try {
      const communityRow = await read('communities', [BigInt(communityId)])
      membershipType = Number(communityRow[2])
      currentKeyVersion = Number(await read('keyVersion', [BigInt(communityId)]))
    } catch (err) {
      console.error('Failed to resolve the community encryption state for this reply:', err)
      toast('Could not verify the community encryption settings. Try again.', 'error')
      return null
    }

    // Encrypted membership types (Request-Based, Private, NFT/Token/NFT+Token/Follower-Gated)
    // with an initialized key get sealed; plaintext communities just carry the tag.
    const isEncryptedType = [1, 2, 3, 4, 5, 8].includes(membershipType)
    if (!isEncryptedType || currentKeyVersion === 0) {
      return { ...plainContent, communityId: Number(communityId) }
    }

    const privKeyHex = getCachedIdentityPrivKeyHex()
    if (!privKeyHex) {
      toast('This community is encrypted — unlock your Security Vault in Settings → Security first', 'error')
      return null
    }

    const envelope = await read('wrappedKeys', [BigInt(communityId), address, BigInt(currentKeyVersion)])
    if (!envelope || envelope === '0x') {
      toast("You don't have this community's encryption key — only members can post here", 'error')
      return null
    }

    const rawContentKey = unwrapContentKey(envelope, privKeyHex)
    const { iv, ciphertext } = await encryptPostContent(rawContentKey, plainContent)

    return { version: '1', encrypted: true, keyVersion: currentKeyVersion, iv, ciphertext, communityId: Number(communityId) }
  }

  const postText = postContent.elements[0].data.text
  const mediaItems = postContent.elements[1].data.items
  const isBusy = isSigning || isConfirming || isUploading || isSubmitting
  const hasPostBody = postText.trim().length > 0 || mediaItems.length > 0 || Boolean(nftListing)
  const isTextOverLimit = postText.length > MAX_POST_LENGTH

  // NFT listings ride only on plain new posts — the listing settles on the chain the post
  // lands on (the community's chain, or the active chain otherwise)
  const canAttachNft = actionType === 'post'
  const nftChainId = communityTarget ? Number(communityTarget.networkId) : Number(getActiveChain()?.[0]?.id) || null
  const nftTradeAvailable = Boolean(nftChainId && CONTRACTS[`chain${nftChainId}`]?.trade)

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
    if (!historyRef.current.restoring) scheduleHistorySnapshot()
  }

  const pushHistorySnapshot = () => {
    const history = historyRef.current
    history.timer = null
    if (!editorRef.current) return
    const snapshot = { html: editorRef.current.innerHTML, caret: getCaretState(editorRef.current) }
    // Content unchanged (e.g. a formatting toggle that resolved to the same markup) —
    // refresh the caret without truncating the redo branch
    if (history.stack[history.index]?.html === snapshot.html) {
      history.stack[history.index] = snapshot
      return
    }
    history.stack = [...history.stack.slice(0, history.index + 1), snapshot].slice(-MAX_HISTORY_ENTRIES)
    history.index = history.stack.length - 1
  }

  // Debounced so a burst of typing collapses into a single undo step
  const scheduleHistorySnapshot = () => {
    const history = historyRef.current
    if (history.timer) clearTimeout(history.timer)
    history.timer = setTimeout(pushHistorySnapshot, HISTORY_DEBOUNCE_MS)
  }

  const applyHistorySnapshot = (snapshot) => {
    const editor = editorRef.current
    const history = historyRef.current
    if (!editor || !snapshot) return
    history.restoring = true
    editor.innerHTML = snapshot.html
    restoreCaretState(editor, snapshot.caret)
    handleEditorInput()
    history.restoring = false
  }

  const undoEdit = () => {
    const history = historyRef.current
    // Capture any still-debouncing keystrokes first so undo steps back from the latest state
    if (history.timer) {
      clearTimeout(history.timer)
      pushHistorySnapshot()
    }
    if (history.index <= 0) return
    history.index -= 1
    applyHistorySnapshot(history.stack[history.index])
  }

  const redoEdit = () => {
    const history = historyRef.current
    if (history.index >= history.stack.length - 1) return
    history.index += 1
    applyHistorySnapshot(history.stack[history.index])
  }

  // The browser's native undo stack can't see our programmatic edits, so Ctrl+Z /
  // Ctrl+Shift+Z / Ctrl+Y are intercepted and served from the snapshot history
  const handleEditorKeyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) redoEdit()
      else undoEdit()
    } else if (key === 'y') {
      event.preventDefault()
      redoEdit()
    }
  }

  // Show the modal dialog and initialize the editor once the component mounts —
  // callers keep the mount = open / unmount = close contract
  useEffect(() => {
    if (!mounted || !editorRef.current) return
    dialogRef.current?.open()
    editorRef.current.innerHTML = markdownToEditorHtml(postText)
    editorRef.current.focus()
    // Move cursor to end
    const range = document.createRange()
    const sel = window.getSelection()
    range.selectNodeContents(editorRef.current)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)

    // Seed the undo history with the initial content and catch context-menu
    // undo/redo, which arrives as beforeinput instead of a keydown
    const editor = editorRef.current
    historyRef.current = {
      stack: [{ html: editor.innerHTML, caret: getCaretState(editor) }],
      index: 0,
      timer: null,
      restoring: false,
    }
    const handleBeforeInput = (event) => {
      if (event.inputType === 'historyUndo') {
        event.preventDefault()
        undoEdit()
      } else if (event.inputType === 'historyRedo') {
        event.preventDefault()
        redoEdit()
      }
    }
    editor.addEventListener('beforeinput', handleBeforeInput)
    return () => {
      editor.removeEventListener('beforeinput', handleBeforeInput)
      if (historyRef.current.timer) clearTimeout(historyRef.current.timer)
    }
  // Only run on mount — postText intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  // Handle paste: upload clipboard images to IPFS or insert plain text
  const handlePaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageItem = items.find((item) => item.type.startsWith('image/'))

    if (imageItem) {
      event.preventDefault()
      if (mediaItems.length >= MAX_MEDIA_ITEMS) {
        toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
        return
      }
      const file = imageItem.getAsFile()
      if (!file) return
      const sizeInMB = file.size / (1024 * 1024)
      if (sizeInMB > MAX_MEDIA_SIZE_MB) {
        toast(`File size error. Maximum size is ${MAX_MEDIA_SIZE_MB}MB`, 'error')
        return
      }
      const dimensions = await getMediaDimensions(file, 'image')
      const cid = await uploadFileToIPFS(file)
      if (!cid) return
      const localUrl = URL.createObjectURL(file)
      setPostContent((prevContent) => {
        const nextElements = [...prevContent.elements]
        const mediaElement = nextElements[1]
        nextElements[1] = {
          ...mediaElement,
          data: {
            ...mediaElement.data,
            items: [
              ...mediaElement.data.items,
              {
                type: 'image',
                cid,
                alt: `Hup asset image | ${postText.slice(0, 30)}...`,
                storage: 'IPFS',
                mimeType: file.type,
                localUrl,
                width: dimensions.width,
                height: dimensions.height,
                spoiler: false,
              },
            ],
          },
        }
        return { ...prevContent, elements: nextElements }
      })
      return
    }

    // Force plain-text paste so clipboard HTML doesn't corrupt the editor
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
      return await uploadToIPFS(file)
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
      fileInputRef.current.accept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*'
      fileInputRef.current.multiple = type === 'image'
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
      } else if (type === 'audio') {
        const audio = document.createElement('audio')
        audio.preload = 'metadata'
        audio.onloadedmetadata = () => { URL.revokeObjectURL(localUrl); resolve({ duration: audio.duration }) }
        audio.onerror = () => { URL.revokeObjectURL(localUrl); resolve({ duration: 0 }) }
        audio.src = localUrl
      } else {
        resolve({ width: undefined, height: undefined })
      }
    })
  }

  const handleFileSelect = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    const remainingSlots = MAX_MEDIA_ITEMS - mediaItems.length
    if (remainingSlots <= 0) {
      toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
      return
    }

    const filesToProcess = files.slice(0, remainingSlots)
    if (files.length > remainingSlots) {
      toast(`Only ${remainingSlots} slot(s) remaining — processing first ${remainingSlots} file(s)`, 'info')
    }

    const newItems = []
    for (const file of filesToProcess) {
      const sizeInMB = file.size / (1024 * 1024)
      if (sizeInMB > MAX_MEDIA_SIZE_MB) {
        toast(`"${file.name}" exceeds the ${MAX_MEDIA_SIZE_MB}MB limit`, 'error')
        continue
      }

      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      const isAudio = file.type.startsWith('audio/')
      const isExpectedType =
        (isImage && selectedMediaType === 'image') ||
        (isVideo && selectedMediaType === 'video') ||
        (isAudio && selectedMediaType === 'audio')
      if (!isExpectedType) {
        toast(`Please select a ${selectedMediaType} file`, 'error')
        continue
      }

      const dimensions = await getMediaDimensions(file, selectedMediaType)
      const cid = await uploadFileToIPFS(file)
      if (!cid) continue

      const localUrl = URL.createObjectURL(file)
      newItems.push({
        type: selectedMediaType,
        cid,
        alt: `Hup asset ${selectedMediaType} | ${postText.slice(0, 30)}...`,
        storage: 'IPFS',
        mimeType: file.type,
        localUrl,
        width: dimensions.width,
        height: dimensions.height,
        duration: selectedMediaType !== 'image' ? (dimensions.duration || 0) : undefined,
        spoiler: false,
      })
    }

    if (newItems.length === 0) return

    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      const mediaElement = nextElements[1]
      nextElements[1] = {
        ...mediaElement,
        data: { ...mediaElement.data, items: [...mediaElement.data.items, ...newItems] },
      }
      return { ...prevContent, elements: nextElements }
    })
  }

  const openGifPicker = () => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) {
      toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
      return
    }
    gifPickerRef.current?.open()
  }

  // A picked GIF flows through the same IPFS pipeline as uploaded files, so the
  // feed renders it like any other image and the post never depends on Giphy's CDN
  const handleGifSelect = async (gif) => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) {
      toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
      return
    }

    setIsUploading(true)
    try {
      const response = await fetch(gif.full.url)
      if (!response.ok) throw new Error('GIF download failed')
      const blob = await response.blob()
      const sizeInMB = blob.size / (1024 * 1024)
      if (sizeInMB > MAX_MEDIA_SIZE_MB) {
        toast(`GIF exceeds the ${MAX_MEDIA_SIZE_MB}MB limit`, 'error')
        return
      }

      const file = new File([blob], `giphy-${gif.id}.gif`, { type: 'image/gif' })
      const cid = await uploadFileToIPFS(file)
      if (!cid) return

      const localUrl = URL.createObjectURL(file)
      setPostContent((prevContent) => {
        const nextElements = [...prevContent.elements]
        const mediaElement = nextElements[1]
        nextElements[1] = {
          ...mediaElement,
          data: {
            ...mediaElement.data,
            items: [
              ...mediaElement.data.items,
              {
                type: 'image',
                cid,
                alt: gif.title || 'GIF',
                storage: 'IPFS',
                mimeType: 'image/gif',
                localUrl,
                width: gif.full.width || undefined,
                height: gif.full.height || undefined,
                spoiler: false,
              },
            ],
          },
        }
        return { ...prevContent, elements: nextElements }
      })
    } catch (error) {
      console.error('Trouble adding GIF:', error)
      toast('Error adding GIF', 'error')
    } finally {
      setIsUploading(false)
    }
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

    setIsSubmitting(true)
    try {
      const serializableContent = getSerializablePostContent(postContent)

      // Quotes are regular posts carrying a `quoteOf` key in their content JSON —
      // the contract rejects metadata on reposts and parent ids on posts, so the
      // reference can only travel inside the content payload (see isQuotePost in lib/content)
      if (isQuote) serializableContent.quoteOf = String(quoteTarget.id)

      // NFT listings travel the same way — the onchain listing already exists (created in
      // SellNftModal); the content JSON only carries the reference TradeCard resolves live
      if (nftListing) serializableContent.nftListing = nftListing

      const moderationRes = await fetch('/api/moderation/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: serializableContent }),
      })
      const moderation = await moderationRes.json().catch(() => ({}))
      if (moderation?.flagged) {
        const categories = moderation.categories?.length ? ` (${moderation.categories.join(', ')})` : ''
        toast(`Flagged as harmful${categories}. Please revise.`, 'error')
        return
      }

      // Community submissions (posts, replies, quotes) are sealed/tagged after moderation
      // (moderation must see plaintext) and before upload. null = blocked (toast already shown).
      let contentForUpload = serializableContent
      if (communityContext && actionType !== 'edit') {
        contentForUpload = await sealForCommunity(serializableContent)
        if (contentForUpload === null) return
      }

      const resultIPFS = await uploadObjectToIPFS(contentForUpload)
      const metadata = resultIPFS.cid
      if (!metadata) throw new Error('CID not found')

      if (actionType === 'edit') {
        const activeChain = getActiveChain()
        const postContractAddress = activeChain?.[1]?.hup || process.env.NEXT_PUBLIC_CONTRACT_POST
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'update',
          args: [address, existingPost.id, metadata, allowComments],
        })
      } else if (isComment) {
        // Replies must land on the same network as the post they target, not whatever chain the wallet happens to be on
        const targetContractAddress = CONTRACTS[`chain${replyTarget?.network_id}`]?.hup
        if (!targetContractAddress) throw new Error('Contract configuration missing for network')
        writeContract({
          abi,
          address: targetContractAddress,
          functionName: 'create',
          args: [address, ContentType.Comment, metadata, replyTarget.id, allowComments],
        })
      } else if (isQuote) {
        // Quotes must land on the same network as the post they quote, so the id stays resolvable
        const targetContractAddress = CONTRACTS[`chain${quoteTarget?.network_id}`]?.hup
        if (!targetContractAddress) throw new Error('Contract configuration missing for network')
        writeContract({
          abi,
          address: targetContractAddress,
          functionName: 'create',
          args: [address, ContentType.Post, metadata, 0, allowComments],
        })
      } else {
        // Community posts must land on the community's chain (like replies/quotes do), not
        // whatever chain the wallet happens to be on
        const postContractAddress = communityTarget
          ? CONTRACTS[`chain${communityTarget.networkId}`]?.hup
          : getActiveChain()?.[1]?.hup || process.env.NEXT_PUBLIC_CONTRACT_POST
        if (!postContractAddress) throw new Error('Contract configuration missing for network')
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'create',
          args: [address, ContentType.Post, metadata, 0, allowComments],
        })
      }
    } catch (error) {
      console.error(error)
      toast(error.message || 'Unable to create post', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    mediaItemsRef.current = mediaItems
  }, [mediaItems])

  // Persist the draft so an accidental refresh doesn't lose it — restored via loadDraftContent()
  useEffect(() => {
    if (!mounted || actionType !== 'post') return
    try {
      localStorage.setItem(getDraftStorageKey(), JSON.stringify(getSerializablePostContent(postContent)))
    } catch (error) {
      console.error('Failed to save post draft:', error)
    }
  }, [mounted, actionType, postContent])

  useEffect(() => {
    if (!isConfirmed) return
    if (actionType === 'post') localStorage.removeItem(getDraftStorageKey())
    toast(isComment ? 'Your reply will appear once the transaction is confirmed.' : 'Your post will appear once the transaction is confirmed.', 'success')
    onConfirmed?.()
    handleClose()
  }, [handleClose, isConfirmed, actionType, isComment, onConfirmed])

  useEffect(() => {
    return () => {
      mediaItemsRef.current.forEach((item) => {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl)
      })
    }
  }, [])

  if (!mounted) return null

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.newPost}
      aria-label={isComment ? 'Reply composer' : isQuote ? 'Quote composer' : 'New thread composer'}
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc must not discard the composer while media uploads or the transaction is in flight
        if (isBusy) e.preventDefault()
      }}
      onClose={handleClose}
    >
      <header className={styles.header}>
        <button type="button" className={styles.cancelButton} onClick={(e) => handleClose(e)}>
          Cancel
        </button>
        <h2>{actionType === 'edit' ? 'Edit post' : isComment ? 'Reply' : isQuote ? 'Quote post' : communityTarget ? `Post to ${communityTarget.name || 'community'}` : 'New post'}</h2>
      </header>

      <form className={styles.form} onSubmit={handleCreatePost}>
        <input ref={fileInputRef} type="file" onChange={handleFileSelect} className={styles.fileInput} />

        <div ref={composerRef} className={styles.composer}>
          {previewTarget && (
            <div className={styles.replyContext}>
              <Profile variant="fullWithoutTime" creator={previewTarget.wallet_address} networkId={previewTarget.network_id} />
              {previewTargetText && (
                <div className={styles.replyContext__text} dangerouslySetInnerHTML={{ __html: renderMarkdown(previewTargetText) }} />
              )}
              {previewTargetMedia.length > 0 && (
                <div className={styles.replyContext__media}>
                  <MediaGallery data={previewTargetMedia} />
                </div>
              )}
              <p className={styles.replyContext__label}>
                {isQuote ? 'Quoting' : 'Replying to'} <b>{previewTargetHandle}</b>
              </p>
            </div>
          )}

          <Profile variant="full" creator={address} />

          <div className={styles.composerBody}>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={clsx(styles.editor, { [styles.editor_comment]: isComment })}
              onInput={handleEditorInput}
              onKeyDown={handleEditorKeyDown}
              onPaste={handlePaste}
              data-placeholder={isComment ? 'Post your reply' : isQuote ? 'Add a comment' : "What's happening?"}
            />

            <div className={styles.toolbar} aria-label="Post tools">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerFileInput('image')}
                aria-label="Add image"
                disabled={isBusy}
              >
                <ImageIcon size={20} />
                <span>Image</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerFileInput('video')}
                aria-label="Add video"
                disabled={isBusy}
              >
                <MonitorPlayIcon size={20} />
                <span>Video</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openGifPicker}
                aria-label="Add GIF"
                disabled={isBusy}
              >
                {/* GifIcon already renders the letters "GIF" — a text label would duplicate it */}
                <GifIcon size={20} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerFileInput('audio')}
                aria-label="Add audio"
                disabled={isBusy}
              >
                <MicrophoneIcon size={20} />
                <span>Audio</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat('strong')}
                aria-label="Bold"
                disabled={isBusy}
              >
                <TextBIcon size={20} />
                <span>Bold</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat('em')}
                aria-label="Italic"
                disabled={isBusy}
              >
                <TextItalicIcon size={20} />
                <span>Italic</span>
              </button>
              <button type="button" aria-label="Location support coming soon" title="Location support coming soon" disabled>
                <MapPinIcon size={20} />
                <span>Location</span>
              </button>
              {canAttachNft && nftTradeAvailable && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowSellNftModal(true)}
                  aria-label="Sell an NFT"
                  disabled={isBusy || Boolean(nftListing)}
                >
                  <StorefrontIcon size={20} />
                  <span>Sell NFT</span>
                </button>
              )}
            </div>

            {nftListing && (
              <div className={styles.nftAttachment}>
                <StorefrontIcon size={16} />
                <span>NFT for sale attached (listing #{nftListing.listingId})</span>
                <button type="button" onClick={() => setNftListing(null)} aria-label="Detach NFT listing" disabled={isBusy}>
                  <XIcon size={14} />
                </button>
              </div>
            )}

            <div className={styles.composerMeta}>
              <span>{mediaItems.length}/{MAX_MEDIA_ITEMS} media</span>
              <span className={clsx({ [styles.metaDanger]: isTextOverLimit })}>
                {postText.length}/{MAX_POST_LENGTH}
              </span>
            </div>

            {mediaItems.some((item) => item.type !== 'audio') && (
              <div className={styles.mediaGrid}>
                {mediaItems.map((item, index) => {
                  if (item.type === 'audio') return null
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
                          <XIcon size={14} />
                          <span>{item.spoiler ? 'Show' : 'Spoiler'}</span>
                        </button>
                        <button type="button" onClick={() => handleRemoveMedia(index)}>
                          <TrashIcon size={14} />
                          <span>Remove</span>
                        </button>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            )}

            {mediaItems.some((item) => item.type === 'audio') && (
              <div className={styles.audioList}>
                {mediaItems.map((item, index) => {
                  if (item.type !== 'audio') return null
                  const mediaSrc = getMediaPreviewSrc(item)
                  return (
                    <div key={`${item.cid || item.localUrl || index}`} className={styles.audioListItem}>
                      <audio src={mediaSrc} controls />
                      <button type="button" className={styles.audioRemoveButton} onClick={() => handleRemoveMedia(index)}>
                        <TrashIcon size={14} />
                      </button>
                    </div>
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
            {!isComment && (
              <>
                <button
                  type="button"
                  className={styles.postOptionsButton}
                  onClick={() => setIsOptionsOpen((value) => !value)}
                  aria-expanded={isOptionsOpen}
                  aria-controls="new-post-options-panel"
                >
                  <FadersHorizontalIcon size={22} />
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
              </>
            )}
          </div>

          <button type="submit" className={styles.postButton} disabled={isBusy || !hasPostBody || isTextOverLimit}>
            {isConfirming
              ? actionType === 'edit' ? 'Updating...' : isComment ? 'Replying...' : 'Posting...'
              : isSigning
                ? 'Signing...'
                : actionType === 'edit' ? 'Update' : isComment ? 'Reply' : 'Post'}
          </button>
        </footer>
      </form>

      {/* Outside the <form>: the picker's search input must never submit the post */}
      <GifPicker ref={gifPickerRef} onSelect={handleGifSelect} />

      {showSellNftModal && (
        <SellNftModal
          chainId={nftChainId}
          onAttached={(listing) => {
            setNftListing(listing)
            setShowSellNftModal(false)
          }}
          onClose={() => setShowSellNftModal(false)}
        />
      )}
    </NativeDialog>
  )
}
