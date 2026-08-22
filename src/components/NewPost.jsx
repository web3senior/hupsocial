'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, usePublicClient, useSignTypedData, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { isSessionActive } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { formatWait } from '@/config/gasless'
import HupCommunityABI from '@/abis/HupCommunity'
import { getCachedIdentityPrivKeyHex, unwrapContentKey, encryptPostContent } from '@/lib/communityVault'
import { ChartLineUpIcon, CoinIcon, GifIcon, ImageIcon, MicrophoneIcon, MonitorPlayIcon, PuzzlePieceIcon, StorefrontIcon, TextBIcon, TextItalicIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import abi from '@/abi/post.json'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { trackPostPublication } from '@/lib/postPublishToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { useActiveChain } from '@/hooks/useActiveChain'
import useVisualViewport from '@/hooks/useVisualViewport'
import { getActiveChain } from '@/lib/communication'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { ContentType } from '@/lib/content'
import { renderMarkdown } from '@/lib/markdown'
import styles from '@/components/NewPost.module.scss'
import NativeDialog from '@/components/ui/NativeDialog'
import DialogHeader from '@/components/ui/DialogHeader'
import NetworkSelect from '@/components/ui/NetworkSelect'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import GifPicker from '@/components/GifPicker'
import SellNftModal from '@/components/SellNftModal'
import AttachMarketModal from '@/components/AttachMarketModal'
import AttachLaunchModal from '@/components/AttachLaunchModal'
import AttachDropModal from '@/components/AttachDropModal'
import AttachMiniAppDialog from '@/components/AttachMiniAppDialog'
import Profile from './Profile'
import MediaGallery from './Gallery'
import clsx from 'clsx'
import { resolveIPFSUrl, resolveIPFSImageUrl } from '@/lib/storageHelper'
import { uploadFileToIPFS as uploadToIPFS } from '@/lib/ipfs'
import { captureVideoPoster } from '@/lib/videoPoster'

const MAX_MEDIA_ITEMS = 8
const MAX_MEDIA_SIZE_MB = 10
// Video needs its own ceiling — a few seconds of phone footage already clears the image limit.
// Uploads above ~4MB bypass the serverless route and go straight to storage, so the cap is a
// storage-cost decision rather than a platform one. Kept in step with MAX_UPLOAD_BYTES in
// /api/ipfs/presign, which enforces it server-side.
const MAX_VIDEO_SIZE_MB = 100
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

// Lone UTF-16 surrogates (half an emoji, e.g. from an interrupted paste or a buggy input
// method) are invalid Unicode: encodeURIComponent throws on them and they publish as
// permanently broken text — strip them before the content ever reaches IPFS.
const stripLoneSurrogates = (text) =>
  typeof text === 'string' ? text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') : ''

const createPostContent = (text = '', mediaItems = []) => ({
  version: '1',
  elements: [
    { type: 'text', data: { text: stripLoneSurrogates(text) } },
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

// Map a file's MIME type onto the composer's media taxonomy
const getMediaType = (file) => {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

const getMaxSizeMb = (mediaType) => (mediaType === 'video' ? MAX_VIDEO_SIZE_MB : MAX_MEDIA_SIZE_MB)

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

// Tags the browser creates on Enter — each one is its own line in the editor
const BLOCK_ELEMENTS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

const escapeEditorHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Convert stored markdown to editor HTML (bold/italic only — used once on init).
// Escaping runs first so a post that literally contains "<b>hi</b>" re-opens as text
// rather than turning into markup on every edit.
const markdownToEditorHtml = (text) => {
  if (!text) return ''
  // CR-aware split: pasted Windows text saved "\r\n" into old drafts, and a lone \r
  // in innerHTML gets parser-normalized into a newline — doubling every break
  return text
    .split(/\r\n|[\r\n]/)
    .map((line) =>
      escapeEditorHtml(line)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
    )
    .join('<br>')
}

// Convert the editor's DOM back to markdown for state / onchain storage.
//
// This walks nodes rather than string-replacing tags because a contentEditable mixes
// two line models: the explicit <br>s we seed on init, and the block wrappers the
// browser produces once the user presses Enter. Every browser-made block also carries
// a trailing filler <br> that exists only to give the line height — scraping innerHTML
// counted that filler *and* the block boundary, so each edit pass added a blank line.
const editorToMarkdown = (editor) => {
  if (!editor) return ''

  const lines = ['']
  const appendText = (text) => {
    // A pre-wrap editor also receives literal newlines from the browser's Enter
    // handling, and pasted Windows clipboard text arrives with \r\n line endings
    const parts = text.split(/\r\n|[\r\n]/)
    lines[lines.length - 1] += parts[0]
    for (let index = 1; index < parts.length; index += 1) lines.push(parts[index])
  }
  const breakLine = () => lines.push('')

  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        appendText(child.data)
        return
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return

      const tag = child.nodeName
      if (tag === 'BR') {
        // No following sibling means this is the browser's filler <br>, not a typed break
        if (child.nextSibling) breakLine()
        return
      }
      if (BLOCK_ELEMENTS.has(tag)) {
        if (lines[lines.length - 1] !== '') breakLine()
        walk(child)
        if (child.nextSibling) breakLine()
        return
      }
      if (tag === 'STRONG' || tag === 'B') {
        appendText('**')
        walk(child)
        appendText('**')
        return
      }
      if (tag === 'EM' || tag === 'I') {
        appendText('*')
        walk(child)
        appendText('*')
        return
      }
      walk(child)
    })
  }

  walk(editor)

  // Text nodes carry already-decoded characters, so the zero-width space applyFormat
  // parks after a tag and the nbsp the browser inserts are stripped as literals here
  return lines
    .join('\n')
    .replace(/​/g, '')
    .replace(/ /g, ' ')
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

export default function NewPost({ text = '', url = '', seedFiles = null, close, onClose, existingPost = null, actionType = 'post', replyTarget = null, quoteTarget = null, communityTarget = null, onConfirmed }) {
  const mounted = useClientMounted()
  // The composer mounts open and unmounts closed, so this tracks exactly the sheet's lifetime:
  // the mobile fullscreen sheet sizes itself off these vars to survive the software keyboard
  useVisualViewport()

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
  // Edits re-upload the whole content JSON, so the existing attachment must be carried
  // into state or saving the edit would silently drop the listing from the post
  const [nftListing, setNftListing] = useState(() =>
    actionType === 'edit' ? getContentPayload(existingPost)?.nftListing ?? null : null
  )
  const [showSellNftModal, setShowSellNftModal] = useState(false)
  // Prediction markets travel like NFT listings: a content-JSON reference to an onchain id
  const [predictMarket, setPredictMarket] = useState(() =>
    actionType === 'edit' ? getContentPayload(existingPost)?.predictMarket ?? null : null
  )
  const [showAttachMarket, setShowAttachMarket] = useState(false)
  // Token launches too — a { launchId, token, chainId } reference the LaunchCard resolves live,
  // so the curve's price and state are never frozen into the stored post
  const [tokenLaunch, setTokenLaunch] = useState(() =>
    actionType === 'edit' ? getContentPayload(existingPost)?.tokenLaunch ?? null : null
  )
  const [showAttachLaunch, setShowAttachLaunch] = useState(false)
  // NFT drops as well — a thin reference plus static art; DropCard resolves supply, phases,
  // and progress live from the HupDrops engine so the card never shows stale mint state
  const [nftDrop, setNftDrop] = useState(() => (actionType === 'edit' ? getContentPayload(existingPost)?.nftDrop ?? null : null))
  const [showAttachDrop, setShowAttachDrop] = useState(false)
  // Mini apps travel the same way: a thin { appId, chainId } reference, never the frame URL, so
  // a moderator revoking an app takes effect in every post that embedded it
  const [miniApp, setMiniApp] = useState(() => (actionType === 'edit' ? getContentPayload(existingPost)?.miniApp ?? null : null))
  const attachMiniAppRef = useRef(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  // { categories, resolve } while the advisory moderation warning awaits the author's decision
  const [moderationWarning, setModerationWarning] = useState(null)
  const moderationDialogRef = useRef(null)
  const moderationDecisionRef = useRef(false)
  const editorRef = useRef(null)
  const dialogRef = useRef(null)
  const composerRef = useRef(null)
  const fileInputRef = useRef(null)
  const gifPickerRef = useRef(null)
  const mediaItemsRef = useRef([])
  const seededRef = useRef(false)
  // What the in-flight submission needs to be recognised once the indexer writes it. Filled the
  // moment the metadata is pinned, read by finishSubmission — which runs from a receipt effect
  // and so can't see handleCreatePost's locals.
  const pendingPublishRef = useRef(null)
  // Undo/redo history for the contenteditable editor. The paste handler and applyFormat
  // mutate the DOM programmatically (no execCommand), which the browser's native undo
  // stack can't track — so Ctrl+Z is backed by these snapshots instead.
  const historyRef = useRef({ stack: [], index: -1, timer: null, restoring: false })

  const { address, isConnected, status: connectionStatus, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  // The composer's own NetworkSelect writes the disconnected selection to a module store, and
  // getActiveChain() is a plain getter that can't wake this component when it changes — so the
  // target chain below reads the subscribed value instead of re-polling on every render
  const { chainId: activeChainId } = useActiveChain()
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

    let currentKeyVersion
    try {
      currentKeyVersion = Number(await read('keyVersion', [BigInt(communityId)]))
    } catch (err) {
      console.error('Failed to resolve the community encryption state for this reply:', err)
      toast('Could not verify the community encryption settings. Try again.', 'error')
      return null
    }

    // Encryption is orthogonal to admission mode now: keyVersion > 0 is the single source of
    // truth. No key epoch → plaintext community → just carry the tag. (The old "encrypted type
    // but no key" trap can't exist anymore — the toggle and the key are set atomically.)
    if (currentKeyVersion === 0) {
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
  const hasPostBody =
    postText.trim().length > 0 ||
    mediaItems.length > 0 ||
    Boolean(nftListing) ||
    Boolean(predictMarket) ||
    Boolean(tokenLaunch) ||
    Boolean(nftDrop) ||
    Boolean(miniApp)
  const isTextOverLimit = postText.length > MAX_POST_LENGTH

  // Every submission is pinned to one chain: an edit updates the post where it already lives,
  // replies and quotes land on the chain of the post they target, community posts on the
  // community's chain, and a plain post on whatever chain the wallet is currently on.
  const targetChainId =
    actionType === 'edit'
      ? Number(existingPost?.network_id) || null
      : isComment
      ? Number(replyTarget?.network_id) || null
      : isQuote
      ? Number(quoteTarget?.network_id) || null
      : communityTarget
      ? Number(communityTarget.networkId)
      : activeChainId || Number(getActiveChain()?.[0]?.id) || null
  const targetChain = appChains.find((chain) => chain.id === targetChainId)

  // Only a plain post is free to pick its chain — an edit, a reply, a quote, and a community
  // post all inherit theirs, so the switcher would lie about where the submission lands
  const isChainPinned = actionType !== 'post' || Boolean(communityTarget)

  // Relay reads (forwarder nonce, account code) must hit the chain the submission lands on
  const targetPublicClient = usePublicClient({ chainId: targetChainId || undefined })
  const { signTypedDataAsync } = useSignTypedData()

  // The wallet only ever signs on the chain it is connected to — editing a Celo post from a
  // LUKSO connection would otherwise fire `update` at Celo's contract address on LUKSO, so the
  // composer prompts for a switch instead (same pattern as the Bazaar/Predict dialogs)
  const isWrongChain = Boolean(walletChain && targetChainId && walletChain.id !== targetChainId)

  // NFT listings ride on plain posts and post edits — the listing settles on the chain the
  // post lands on
  const canAttachNft = actionType === 'post' || actionType === 'edit'
  const nftTradeAvailable = Boolean(targetChainId && CONTRACTS[`chain${targetChainId}`]?.trade)
  // Prediction markets pin to the same chain the post lands on, like NFT listings
  const predictAvailable = Boolean(targetChainId && CONTRACTS[`chain${targetChainId}`]?.predict)
  // Token launches pin to the post's chain like the others
  const launchAvailable = Boolean(targetChainId && CONTRACTS[`chain${targetChainId}`]?.launch)
  // NFT drops too — only offered where the HupDrops engine is deployed
  const dropsAvailable = Boolean(targetChainId && CONTRACTS[`chain${targetChainId}`]?.drops)
  // The composer already holds an image and text, so the create dialog opens with two of its four
  // required fields filled — the author only types a name and a ticker
  const launchPrefillImage = mediaItems.find((item) => item.type === 'image' && item.cid)?.cid ?? ''

  const handleClose = useCallback(
    (e) => {
      if (e) e.stopPropagation()
      close?.()
      onClose?.()
    },
    [close, onClose]
  )

  // Publishing takes a signature, so a composer opened without a wallet is a dead end — the
  // entry points gate on the click, and this refuses to open for every other way in (the share
  // target, a deep link, a community composer). wagmi still reports 'reconnecting' for a beat
  // after a reload, so the verdict waits for a settled connection; the ref then latches it to
  // the mount, because disconnecting mid-compose must not throw the draft away — handleCreatePost
  // already blocks that submit.
  const isConnectionSettled = connectionStatus !== 'connecting' && connectionStatus !== 'reconnecting'
  const isWalletMissing = isConnectionSettled && !isConnected
  const walletGateRef = useRef(false)

  useEffect(() => {
    if (walletGateRef.current || !isConnectionSettled) return
    walletGateRef.current = true
    if (isConnected) return
    toast('Please connect wallet', 'error')
    handleClose()
  }, [isConnectionSettled, isConnected, handleClose])

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
    updateTextContent(editorToMarkdown(editorRef.current))
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
    if (!mounted || isWalletMissing || !editorRef.current) return
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

  // The one ingest path for attachments, whether the author picked them or the OS share
  // sheet handed them over. `expectedType` holds the picker to the kind it asked for; a
  // share passes null, so each file is classified by its own MIME type instead.
  const ingestFiles = async (files, expectedType) => {
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
      const mediaType = getMediaType(file)
      if (!mediaType) {
        toast(`"${file.name}" isn't an image, video, or audio file`, 'error')
        continue
      }
      if (expectedType && mediaType !== expectedType) {
        toast(`Please select a ${expectedType} file`, 'error')
        continue
      }

      // Classified first: video carries a much larger ceiling than an image does
      const maxSizeMb = getMaxSizeMb(mediaType)
      const sizeInMB = file.size / (1024 * 1024)
      if (sizeInMB > maxSizeMb) {
        toast(`"${file.name}" exceeds the ${maxSizeMb}MB limit`, 'error')
        continue
      }

      const dimensions = await getMediaDimensions(file, mediaType)
      const cid = await uploadFileToIPFS(file)
      if (!cid) continue

      /* A still, pinned separately, so feed cards render a thumbnail without pulling the video
         through a gateway. Best-effort: a container the browser can't decode just posts without
         one, exactly as every video posted before this did. */
      let poster
      if (mediaType === 'video') {
        const posterFile = await captureVideoPoster(file)
        if (posterFile) poster = (await uploadFileToIPFS(posterFile)) || undefined
      }

      const localUrl = URL.createObjectURL(file)
      newItems.push({
        type: mediaType,
        cid,
        poster,
        alt: `Hup asset ${mediaType} | ${postText.slice(0, 30)}...`,
        storage: 'IPFS',
        mimeType: file.type,
        localUrl,
        width: dimensions.width,
        height: dimensions.height,
        duration: mediaType !== 'image' ? (dimensions.duration || 0) : undefined,
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

  const handleFileSelect = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await ingestFiles(files, selectedMediaType)
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

  useEffect(() => {
    if (moderationWarning) moderationDialogRef.current?.open()
  }, [moderationWarning])

  // Shared by the wallet path (receipt confirmed) and the relayed path (relayer accepted the
  // transaction) — both end the composer the same way
  const finishSubmission = useCallback(() => {
    if (actionType === 'post') localStorage.removeItem(getDraftStorageKey())

    // Handed to a module-scope tracker, not awaited here: the composer unmounts on the next line,
    // so the loading toast and its poll have to live outside it. Clearing the ref also makes a
    // second call (a re-fired isConfirmed effect) a no-op instead of a duplicate toast.
    const pending = pendingPublishRef.current
    pendingPublishRef.current = null
    if (pending) trackPostPublication(pending)

    onConfirmed?.()
    handleClose()
  }, [actionType, handleClose, onConfirmed])

  /**
   * Relays `create` through our forwarder so the author pays no gas. Returns false when the
   * relay is unavailable for this wallet or network, leaving the caller to send the
   * transaction the usual way. Only `create` is sponsored — edits keep paying their own gas.
   */
  const tryGaslessCreate = async (args) => {
    if (!isGaslessEnabled(targetChainId) || !targetChain || !targetPublicClient) return false

    try {
      const session = await isSessionActive({ userAddress: address, publicClient: targetPublicClient })

      await relayHupAction({
        chain: targetChain,
        publicClient: targetPublicClient,
        owner: address,
        functionName: 'create',
        args,
        signTypedDataAsync,
        useSessionKey: session.active,
      })

      return true
    } catch (err) {
      // A cooldown is an answer, not a failure — falling through would charge the author for
      // a post they were just told to retry in a moment
      if (err.code === 'RELAY_COOLDOWN') throw err

      // A relayer hiccup is never fatal — the wallet path still works, so this only
      // decides who pays for the post
      console.warn('Gasless post unavailable:', err.message)
      return false
    }
  }

  const handleCreatePost = async (event) => {
    event.preventDefault()

    if (!isConnected || !address) {
      toast('Connect your wallet before posting', 'error')
      return
    }

    // Bail before the IPFS upload — signing on the wrong network can only fail
    if (isWrongChain) {
      toast(`Switch your wallet to ${targetChain?.name || 'the right network'} first`, 'error')
      return
    }

    // Same reason: a sponsored post still cooling down should not pin its media first
    if (actionType !== 'edit') {
      const cooldown = gaslessCooldown('create', targetChainId, address)
      if (cooldown > 0) {
        toast(`Slow down — you can post again in ${formatWait(cooldown)}.`, 'error')
        return
      }
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

      // Sanitize at the last exit before publication: typed/pasted text can carry lone
      // surrogates the initial-state factory never sees
      if (serializableContent?.elements?.[0]?.data) {
        serializableContent.elements[0].data.text = stripLoneSurrogates(serializableContent.elements[0].data.text)
      }

      // Quotes are regular posts carrying a `quoteOf` key in their content JSON —
      // the contract rejects metadata on reposts and parent ids on posts, so the
      // reference can only travel inside the content payload (see isQuotePost in lib/content)
      if (isQuote) serializableContent.quoteOf = String(quoteTarget.id)

      // NFT listings travel the same way — the onchain listing already exists (created in
      // SellNftModal); the content JSON only carries the reference TradeCard resolves live
      if (nftListing) serializableContent.nftListing = nftListing

      // Prediction markets too — the market already exists onchain; PredictCard resolves
      // the reference from the indexed API
      if (predictMarket) serializableContent.predictMarket = predictMarket

      // Token launches as well — the launch already exists onchain (created in CreateLaunchDialog);
      // LaunchCard resolves price and curve state live so the post never carries stale numbers
      if (tokenLaunch) serializableContent.tokenLaunch = tokenLaunch

      // NFT drops as well — the drop already exists onchain (created in CreateDropDialog);
      // DropCard resolves supply and phase state live so the post never carries stale numbers
      if (nftDrop) serializableContent.nftDrop = nftDrop

      // Mini apps as well — MiniAppEmbed resolves the frame URL at render time, so an app
      // that later loses its embeddable grant stops rendering without touching stored posts
      if (miniApp) serializableContent.miniApp = miniApp

      // Edits rebuild the payload from the composer's text/media state, so reference keys
      // that only exist in the stored JSON must be carried over or the edit erases them
      if (actionType === 'edit') {
        const existingContent = getContentPayload(existingPost)
        if (existingContent?.quoteOf) serializableContent.quoteOf = existingContent.quoteOf
        if (existingContent?.communityId) serializableContent.communityId = existingContent.communityId
      }

      const moderationRes = await fetch('/api/moderation/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: serializableContent }),
      })
      const moderation = await moderationRes.json().catch(() => ({}))
      // Block tier (CSAM, explicit sexual imagery) has no override — pinning it to IPFS
      // would make the platform itself the host
      if (moderation?.blocked) {
        toast('This content can’t be published on Hup.', 'error')
        return
      }
      if (moderation?.flagged) {
        // Advisory, never a gate — the author always keeps the final say. Flagged posts are
        // still labeled by the indexer (moderation_flagged) so clients can blur or collapse them.
        const proceed = await new Promise((resolve) => {
          moderationDecisionRef.current = false
          setModerationWarning({ categories: moderation.categories || [], resolve })
        })
        setModerationWarning(null)
        if (!proceed) return
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

      // The metadata URI is the one handle on this submission that works everywhere: it exists
      // before the transaction is sent (so the relayed path has it too), it is what the indexer
      // stores verbatim, and an edit rewrites it onto the row it already has.
      pendingPublishRef.current = {
        networkId: targetChainId,
        author: address,
        metadata,
        kind: actionType === 'edit' ? 'edit' : isComment ? 'reply' : 'post',
        parentId: isComment ? replyTarget?.id : null,
      }

      if (actionType === 'edit') {
        // Edits must go back to the chain the post already lives on — the wallet's active chain
        // can be an entirely different network
        const postContractAddress = CONTRACTS[`chain${existingPost?.network_id}`]?.hup
        if (!postContractAddress) throw new Error('Contract configuration missing for network')
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'update',
          args: [address, existingPost.id, metadata, allowComments],
          chainId: targetChainId,
        })
      } else if (isComment) {
        // Replies must land on the same network as the post they target, not whatever chain the wallet happens to be on
        const targetContractAddress = CONTRACTS[`chain${replyTarget?.network_id}`]?.hup
        if (!targetContractAddress) throw new Error('Contract configuration missing for network')
        const createArgs = [address, ContentType.Comment, metadata, replyTarget.id, allowComments]
        if (await tryGaslessCreate(createArgs)) {
          finishSubmission()
          return
        }
        writeContract({
          abi,
          address: targetContractAddress,
          functionName: 'create',
          args: createArgs,
          chainId: targetChainId,
        })
      } else if (isQuote) {
        // Quotes must land on the same network as the post they quote, so the id stays resolvable
        const targetContractAddress = CONTRACTS[`chain${quoteTarget?.network_id}`]?.hup
        if (!targetContractAddress) throw new Error('Contract configuration missing for network')
        const createArgs = [address, ContentType.Post, metadata, 0, allowComments]
        if (await tryGaslessCreate(createArgs)) {
          finishSubmission()
          return
        }
        writeContract({
          abi,
          address: targetContractAddress,
          functionName: 'create',
          args: createArgs,
          chainId: targetChainId,
        })
      } else {
        // Community posts must land on the community's chain (like replies/quotes do), not
        // whatever chain the wallet happens to be on
        const postContractAddress = communityTarget
          ? CONTRACTS[`chain${communityTarget.networkId}`]?.hup
          : CONTRACTS[`chain${targetChainId}`]?.hup || process.env.NEXT_PUBLIC_CONTRACT_POST
        if (!postContractAddress) throw new Error('Contract configuration missing for network')
        const createArgs = [address, ContentType.Post, metadata, 0, allowComments]
        if (await tryGaslessCreate(createArgs)) {
          finishSubmission()
          return
        }
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'create',
          args: createArgs,
          chainId: targetChainId,
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

  // Files handed over by the OS share sheet (app/share/page.jsx) attach themselves once the
  // composer mounts. Guarded by a ref, not the dependency list: ingesting uploads to IPFS,
  // and a second pass would pin every file twice.
  useEffect(() => {
    if (seededRef.current || !seedFiles?.length) return
    seededRef.current = true
    ingestFiles(Array.from(seedFiles), null)
  }, [seedFiles]) // eslint-disable-line react-hooks/exhaustive-deps

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
    finishSubmission()
  }, [isConfirmed, finishSubmission])

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
      <DialogHeader
        title={
          actionType === 'edit'
            ? 'Edit post'
            : isComment
              ? 'Reply'
              : isQuote
                ? 'Quote post'
                : communityTarget
                  ? `Post to ${communityTarget.name || 'community'}`
                  : 'New post'
        }
        onCancel={(e) => handleClose(e)}
        actions={isChainPinned ? null : <NetworkSelect placement="bottom-end" />}
      />

      {isWrongChain && (
        <div className={styles.chainWarning} role="alert">
          <WarningIcon size={16} />
          <span>
            {actionType === 'edit'
              ? `This post lives on ${targetChain?.name || 'another network'}`
              : isComment
                ? `This reply lands on ${targetChain?.name || 'another network'}`
                : isQuote
                  ? `This quote lands on ${targetChain?.name || 'another network'}`
                  : `This post lands on ${targetChain?.name || 'another network'}`}
            {' — switch your wallet to sign.'}
          </span>
          <button
            type="button"
            className={styles.chainWarning__switch}
            onClick={() => switchChain.mutate({ chainId: targetChainId })}
            disabled={switchChain.isPending}
          >
            {switchChain.isPending ? 'Switching...' : 'Switch'}
          </button>
        </div>
      )}

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
              {canAttachNft && predictAvailable && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowAttachMarket(true)}
                  aria-label="Attach a prediction market"
                  disabled={isBusy || Boolean(predictMarket)}
                >
                  <ChartLineUpIcon size={20} />
                  <span>Predict</span>
                </button>
              )}
              {canAttachNft && launchAvailable && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowAttachLaunch(true)}
                  aria-label="Launch a token"
                  disabled={isBusy || Boolean(tokenLaunch)}
                >
                  <CoinIcon size={20} />
                  <span>Token</span>
                </button>
              )}
              {canAttachNft && dropsAvailable && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowAttachDrop(true)}
                  aria-label="Attach an NFT drop"
                  disabled={isBusy || Boolean(nftDrop)}
                >
                  <ImageIcon size={20} />
                  <span>Drop</span>
                </button>
              )}
              {canAttachNft && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => attachMiniAppRef.current?.open()}
                  aria-label="Attach a mini app"
                  disabled={isBusy || Boolean(miniApp)}
                >
                  <PuzzlePieceIcon size={20} />
                  <span>Mini app</span>
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

            {predictMarket && (
              <div className={styles.nftAttachment}>
                <ChartLineUpIcon size={16} />
                <span>Prediction market attached (market #{predictMarket.marketId})</span>
                <button type="button" onClick={() => setPredictMarket(null)} aria-label="Detach prediction market" disabled={isBusy}>
                  <XIcon size={14} />
                </button>
              </div>
            )}

            {tokenLaunch && (
              <div className={styles.nftAttachment}>
                <CoinIcon size={16} />
                <span>Token launch attached (launch #{tokenLaunch.launchId})</span>
                <button type="button" onClick={() => setTokenLaunch(null)} aria-label="Detach token launch" disabled={isBusy}>
                  <XIcon size={14} />
                </button>
              </div>
            )}

            {nftDrop && (
              <div className={styles.nftAttachment}>
                <ImageIcon size={16} />
                <span>NFT drop attached (drop #{nftDrop.dropId})</span>
                <button type="button" onClick={() => setNftDrop(null)} aria-label="Detach NFT drop" disabled={isBusy}>
                  <XIcon size={14} />
                </button>
              </div>
            )}

            {miniApp && (
              <div className={styles.nftAttachment}>
                <PuzzlePieceIcon size={16} />
                <span>Mini app attached (app #{miniApp.appId})</span>
                <button type="button" onClick={() => setMiniApp(null)} aria-label="Detach mini app" disabled={isBusy}>
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
            {/* One setting, so it sits in the open — a disclosure that hides a single switch
                behind two taps is all cost and no saving */}
            {!isComment && (
              <div className={styles.postOption}>
                <label htmlFor="allowComments">Allow comments</label>
                <ToggleSwitch
                  id="allowComments"
                  checked={allowComments}
                  onChange={(event) => setAllowComments(event.target.checked)}
                />
              </div>
            )}
          </div>

          <button type="submit" className={styles.postButton} disabled={isBusy || !hasPostBody || isTextOverLimit || isWrongChain}>
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
          chainId={targetChainId}
          onAttached={(listing) => {
            setNftListing(listing)
            setShowSellNftModal(false)
          }}
          onClose={() => setShowSellNftModal(false)}
        />
      )}

      {moderationWarning && (
        <NativeDialog
          ref={moderationDialogRef}
          className={styles.moderationWarning}
          aria-label="Content sensitivity warning"
          onClick={(e) => e.stopPropagation()}
          onCancel={(e) => e.stopPropagation()}
          onClose={(e) => {
            // Nested dialog: without this, closing the warning also closes the composer
            e.stopPropagation()
            moderationWarning.resolve(moderationDecisionRef.current)
          }}
        >
          <h3 className={styles.moderationWarning__title}>Sensitive content warning</h3>
          <p className={styles.moderationWarning__body}>
            This may be seen as sensitive
            {moderationWarning.categories.length > 0 && <> ({moderationWarning.categories.join(', ')})</>}. Nothing stops you
            from posting it — Hup doesn't censor — but it may be labeled so other users can choose not to see it.
          </p>
          <div className={styles.moderationWarning__actions}>
            <button type="button" className={styles.moderationWarning__revise} onClick={() => moderationDialogRef.current?.close()}>
              Go back
            </button>
            <button
              type="button"
              className={styles.moderationWarning__confirm}
              onClick={() => {
                moderationDecisionRef.current = true
                moderationDialogRef.current?.close()
              }}
            >
              Post anyway
            </button>
          </div>
        </NativeDialog>
      )}

      {showAttachMarket && (
        <AttachMarketModal
          chainId={targetChainId}
          onAttached={(marketRef) => {
            setPredictMarket(marketRef)
            setShowAttachMarket(false)
          }}
          onClose={() => setShowAttachMarket(false)}
        />
      )}

      {showAttachLaunch && (
        <AttachLaunchModal
          chainId={targetChainId}
          prefillImage={launchPrefillImage}
          prefillDescription={postText}
          onAttached={(launchReference) => {
            setTokenLaunch(launchReference)
            setShowAttachLaunch(false)
          }}
          onClose={() => setShowAttachLaunch(false)}
        />
      )}

      {showAttachDrop && (
        <AttachDropModal
          chainId={targetChainId}
          prefillImage={launchPrefillImage}
          prefillDescription={postText}
          onAttached={(dropReference) => {
            setNftDrop(dropReference)
            setShowAttachDrop(false)
          }}
          onClose={() => setShowAttachDrop(false)}
        />
      )}

      <AttachMiniAppDialog ref={attachMiniAppRef} onAttached={(reference) => setMiniApp(reference)} />
    </NativeDialog>
  )
}
