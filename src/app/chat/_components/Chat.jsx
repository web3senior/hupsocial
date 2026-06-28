'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import CryptoJS from 'crypto-js'
import { ethers } from 'ethers'
import ecies from 'eciesjs'
import { useConnection, usePublicClient } from 'wagmi'
import { getIPFS } from '@/lib/ipfs'
import clsx from 'clsx'
import { ArrowUp, EllipsisVertical, MessageSquarePlus, Image as ImageIcon, SquarePlay, X, ChevronLeft, Smile, MoreHorizontal, Pencil, Trash2, Check } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import { bytesToHex, encodeFunctionData } from 'viem'
import { ContentSpinner, MessageLoader } from '@/components/Loading'
import { chatLocalStorageBurnerKey, chatLocalStorageBurnerAddress, chatSessionStorageUnlockedKey, CHAT_ZERO_ADDRESS as ZERO_ADDRESS } from '@/lib/chatBurnerSession'
import { APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE, unlockAppKeyFromStorage } from '@/lib/appVault'
import { decryptData } from '@/lib/cryptoHelper'
import { getActiveChain } from '@/lib/communication'
import { resolveIPFSUrl } from '@/lib/storageHelper'
import { ConversationList } from './ConversationList'
import styles from './Chat.module.scss'
import abiChat from '@/abis/Chat.json'
import abiPublicKeyRegistry from '@/abis/PublicKeyRegistry.json'
import { Buffer } from 'buffer'
import { useChatHistory } from '@/hooks/useChatHistory'
import { useProfile } from '@/hooks/useProfile'
import { useSWRConfig } from 'swr'
import { CheckCircle2 } from 'lucide-react'

const CHAT_PAGE_SIZE = 200

// IPFS content is immutable — same CID always returns the same bytes.
// Cache fetches at module scope so the polling interval never re-fetches known CIDs.
const _ipfsCache = new Map()
async function cachedGetIPFS(cid) {
  if (_ipfsCache.has(cid)) return _ipfsCache.get(cid)
  const data = await getIPFS(cid)
  _ipfsCache.set(cid, data)
  return data
}
const MAX_MEDIA_ITEMS = 4
const MAX_MEDIA_SIZE_MB = 5

const forwarderAbi = [
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]

function normalizeCID(cidValue) {
  if (!cidValue || typeof cidValue !== 'string') return ''
  return cidValue
    .trim()
    .replace(/^ipfs:\/\//i, '')
    .replace(/^\/ipfs\//i, '')
}

function normalizePrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') return null
  const trimmed = privateKey.trim()
  if (!trimmed) return null
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
  return /^0x[0-9a-fA-F]{64}$/.test(withPrefix) ? withPrefix : null
}

function decodeEncryptedKeyBlob(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const clean = value.replace(/^0x/, '')
    if (!clean || clean.length % 2 !== 0) return null
    return Uint8Array.from(Buffer.from(clean, 'hex'))
  }
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return Uint8Array.from(value)
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data)
  }
  return null
}

const getMediaDimensions = (file, type) => {
  return new Promise((resolve) => {
    const localUrl = URL.createObjectURL(file)
    if (type === 'image') {
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(localUrl)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(localUrl)
        resolve({ width: undefined, height: undefined })
      }
      img.src = localUrl
    } else if (type === 'video') {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(localUrl)
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
      }
      video.onerror = () => {
        URL.revokeObjectURL(localUrl)
        resolve({ width: undefined, height: undefined, duration: 0 })
      }
      video.src = localUrl
    } else {
      resolve({ width: undefined, height: undefined })
    }
  })
}

// ■■■ Lazy Decryption Component ■■■

const EncryptedMediaItem = ({ item, rawKeyHex, onLoad }) => {
  const [localUrl, setLocalUrl] = useState(null)
  const [isDecrypting, setIsDecrypting] = useState(true)

  useEffect(() => {
    let active = true
    const fetchAndDecrypt = async () => {
      try {
        const response = await fetch(resolveIPFSUrl(item.cid))
        if (!response.ok) throw new Error('Failed to fetch encrypted media blob')

        const encryptedBuffer = await response.arrayBuffer()
        const subtle = window.crypto.subtle

        const key = await subtle.importKey('raw', ethers.getBytes(rawKeyHex), 'AES-GCM', true, ['decrypt'])

        const decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv: ethers.getBytes(item.iv) }, key, encryptedBuffer)

        if (!active) return

        const blob = new Blob([decryptedBuffer], { type: item.mimeType })
        setLocalUrl(URL.createObjectURL(blob))
      } catch (error) {
        console.error('Media decryption failed:', error)
      } finally {
        if (active) setIsDecrypting(false)
      }
    }

    fetchAndDecrypt()

    return () => {
      active = false
      if (localUrl) URL.revokeObjectURL(localUrl)
    }
  }, [item.cid, item.iv, item.mimeType, rawKeyHex])

  if (isDecrypting) {
    return (
      <div className={clsx(styles['chat-message__media-placeholder'], 'flex items-center justify-center bg-zinc-800 rounded h-32 w-32')}>
        <ContentSpinner />
      </div>
    )
  }

  if (!localUrl) {
    return <div className={clsx(styles['chat-message__media-error'])}>Media unavailable</div>
  }

  return item.type === 'image' ? (
    <img src={localUrl} alt="Encrypted asset" className={styles['chat-message__media-item']} onLoad={onLoad} />
  ) : (
    <video src={localUrl} controls className={styles['chat-message__media-item']} onLoadedData={onLoad} />
  )
}

// ■■■ Main Logic ■■■

export default function Chat() {
  const { mutate } = useSWRConfig()
  const router = useRouter()
  const [messageText, setMessageText] = useState('')
  const [pendingMessages, setPendingMessages] = useState([])
  const [receiverAddress, setReceiverAddress] = useState('')
  const [contacts, setContacts] = useState([])
  const [contactsRefreshKey, setContactsRefreshKey] = useState(0)
  const [isAddingContact, setIsAddingContact] = useState(false)
  const [isSubmittingContact, setIsSubmittingContact] = useState(false)
  const [deletingContact, setDeletingContact] = useState(null)
  const [contactInput, setContactInput] = useState('')
  const [contactError, setContactError] = useState('')
  const contactsInitializedRef = useRef(false)
  const activeReceiverRef = useRef(null)
  const chatIntervalRef = useRef(null)
  const scrollRef = useRef(null)
  const currentNonce = useRef(null)
  const sendQueueRef = useRef([])
  const isProcessingQueueRef = useRef(false)
  const processQueueRef = useRef(null)
  const lastConfirmedCountRef = useRef(0)
  const [pendingMessage, setPendingMessage] = useState(null)
  const [showChat, setShowChat] = useState(false)
  const [reactionTypes, setReactionTypes] = useState([])
  const [activeMessageMenu, setActiveMessageMenu] = useState(null)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [deletingMessageId, setDeletingMessageId] = useState(null)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null)
  const [myReactions, setMyReactions] = useState({})
  const [pendingReactionId, setPendingReactionId] = useState(null)

  const [mediaItems, setMediaItems] = useState([])
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const [activeChainConfig, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat
  const forwarderAddress = activeChainContracts?.forwarder
  const pkRegistryAddress = activeChainContracts?.publicKeyRegistry
  const relayRpcUrl = activeChainConfig?.rpcUrls?.default?.http?.[0]
  const [chatHistory, setChatHistory] = useState({ list: [], isLoading: false })
  const isMounted = useClientMounted()

  const { profile: receiverProfile } = useProfile(receiverAddress)

  const { data: chatList } = useChatHistory(receiverAddress, contacts, {
    publicClient,
    tunnelAddress,
    address,
  })

  // ■■■ Media Handlers ■■■

  const uploadFileToIPFS = async (fileOrBlob) => {
    const data = new FormData()
    // Append a generic filename to bypass potential multer/FormData restrictions on raw blobs
    data.set('file', fileOrBlob, 'shrouded_asset.bin')
    const uploadRequest = await fetch('/api/ipfs/file', {
      method: 'POST',
      body: data,
    })
    if (!uploadRequest.ok) throw new Error(`Upload failed: ${uploadRequest.status}`)
    const result = await uploadRequest.json()
    return result.cid
  }

  const triggerFileInput = (type) => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) return
    setSelectedMediaType(type)
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*'
      fileInputRef.current.click()
    }
  }

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || mediaItems.length >= MAX_MEDIA_ITEMS) return

    const sizeInMB = file.size / (1024 * 1024)
    if (sizeInMB > MAX_MEDIA_SIZE_MB) {
      setContactError(`Maximum file size is ${MAX_MEDIA_SIZE_MB}MB`)
      return
    }

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    if (!((isImage && selectedMediaType === 'image') || (isVideo && selectedMediaType === 'video'))) return

    const dimensions = await getMediaDimensions(file, selectedMediaType)
    const localUrl = URL.createObjectURL(file)

    // We strictly stage the file; NO UPLOAD occurs here to prevent plaintext leaks.
    const nextItem = {
      type: selectedMediaType,
      file,
      mimeType: file.type,
      localUrl,
      width: dimensions.width,
      height: dimensions.height,
      duration: selectedMediaType === 'video' ? dimensions.duration || 0 : undefined,
    }

    setMediaItems((prev) => [...prev, nextItem])
  }

  const handleRemoveMedia = (itemIndex) => {
    const item = mediaItems[itemIndex]
    if (item?.localUrl) URL.revokeObjectURL(item.localUrl)
    setMediaItems((prev) => prev.filter((_, index) => index !== itemIndex))
  }

  useEffect(() => {
    return () => {
      mediaItems.forEach((item) => {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl)
      })
    }
  }, [mediaItems])

  // ■■■ Core Chat Logic ■■■

  async function getNextNonce(from) {
    if (currentNonce.current === null) {
      currentNonce.current = await publicClient.readContract({
        address: forwarderAddress,
        abi: forwarderAbi,
        functionName: 'nonces',
        args: [from],
      })
    } else {
      currentNonce.current += 1n
    }
    return currentNonce.current
  }

  const getRegisteredChatPublicKey = async (walletAddress) => {
    if (!walletAddress || !publicClient) return null
    try {
      if (pkRegistryAddress) {
        const key = await publicClient.readContract({
          address: pkRegistryAddress,
          abi: abiPublicKeyRegistry,
          functionName: 'getKey',
          args: [walletAddress],
        })
        if (!key || key === '0x') return null
        return key.startsWith('0x') ? key : `0x${key}`
      }
      if (!tunnelAddress) return null
      const key = await publicClient.readContract({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'publicKeyRegistry',
        args: [walletAddress],
      })
      if (!key || key === '0x') return null
      return key.startsWith('0x') ? key : `0x${key}`
    } catch {
      return null
    }
  }

  const deriveRoomFromPeerKey = (privKeyHex, peerPublicKey) => {
    const normalizedPrivKey = privKeyHex.startsWith('0x') ? privKeyHex : `0x${privKeyHex}`
    const signingKey = new ethers.SigningKey(normalizedPrivKey)
    const secret = signingKey.computeSharedSecret(peerPublicKey)
    const pairHash = ethers.keccak256(secret)
    return {
      topic: pairHash,
      stealthAddress: ethers.getAddress(ethers.dataSlice(pairHash, 12)),
    }
  }

  const relayMetaTransaction = async (functionData) => {
    if (!publicClient || !forwarderAddress || !tunnelAddress || !relayRpcUrl) {
      throw new Error('Chat relay configuration is missing for this chain.')
    }
    const unlockedKey = sessionStorage.getItem(chatSessionStorageUnlockedKey)
    let burnerKey = normalizePrivateKey(unlockedKey)

    if (!burnerKey) {
      const encryptedBurnerKey = localStorage.getItem(chatLocalStorageBurnerKey)
      const pin = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
      if (encryptedBurnerKey && pin) {
        try {
          const decrypted = await decryptData(encryptedBurnerKey, pin)
          burnerKey = normalizePrivateKey(decrypted)
          if (burnerKey) sessionStorage.setItem(chatSessionStorageUnlockedKey, burnerKey)
        } catch {}
      }
    }

    if (!burnerKey) throw new Error('Session expired or burner key is missing.')
    const burner = new ethers.Wallet(burnerKey)
    const { request, signature } = await signMetaTransactionSessionMode(burner, functionData)

    const res = await fetch('/api/v1/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, signature, rpcUrl: relayRpcUrl, forwarderAddress, chainId: activeChainConfig?.id }, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Message relay failed.')
    return true
  }

  async function signMetaTransactionSessionMode(signer, functionData) {
    const from = await signer.getAddress()
    const nonce = await getNextNonce(from)
    const chainId = activeChainConfig?.id
    if (!chainId) throw new Error('Missing active chain id.')
    const deadline = Math.floor(Date.now() / 1000) + 3600
    const domain = { name: 'HupForwarder', version: '1', chainId, verifyingContract: forwarderAddress }
    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint48' },
        { name: 'data', type: 'bytes' },
      ],
    }
    const message = { from, to: tunnelAddress, value: 0n, gas: 1_000_000n, nonce, deadline, data: functionData }
    const signature = await signer.signTypedData(domain, types, message)
    return { request: message, signature }
  }

  const getUnlockedKey = async () => {
    try {
      const unlocked = await unlockAppKeyFromStorage()
      if (!unlocked) {
        sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
        return null
      }
      return unlocked
    } catch (error) {
      sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
      router.push('/unlock')
      return null
    }
  }

  const loadReactionTypes = async () => {
    if (!publicClient || !tunnelAddress) return
    try {
      const result = await publicClient.readContract({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'getReactionTypes',
        args: [0n, 20n],
      })
      const [ids, labels, enabled] = result
      const types = Array.from(ids)
        .map((id, i) => ({ id: Number(id), label: labels[i], enabled: enabled[i] }))
        .filter((t) => t.enabled)
      console.debug('[chat] reactionTypes loaded:', types)
      setReactionTypes(types)
    } catch (e) {
      console.warn('[chat] loadReactionTypes failed:', e?.message)
    }
  }

  const persistContactsOnchain = async (nextContacts, keys) => {
    if (!publicClient || !tunnelAddress || !address) throw new Error('Wallet or chain not ready for contacts sync.')
    const normalizedContacts = nextContacts.map((c) => ({
      contactAddress: c.contactAddress,
      topic: c.topic,
      stealthAddress: c.stealthAddress,
    }))
    const encryptedData = CryptoJS.AES.encrypt(JSON.stringify(normalizedContacts), keys.privKeyHex).toString()
    const ipfsResult = await uploadObjectToIPFS({ version: '1', encrypted_data: encryptedData })
    const cid = normalizeCID(ipfsResult?.cid)
    if (!cid) throw new Error('Failed to upload encrypted contacts to IPFS.')
    const currentContacts = await publicClient.readContract({
      address: tunnelAddress,
      abi: abiChat,
      functionName: 'getEncryptedContacts',
      args: [address],
    })
    const currentVersion = Number(currentContacts?.[2] ?? currentContacts?.version ?? 0)
    const nextVersion = BigInt(currentVersion + 1)
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(cid))
    const functionData = encodeFunctionData({
      abi: abiChat,
      functionName: 'setEncryptedContacts',
      args: [address, cid, contentHash, nextVersion],
    })
    return await relayMetaTransaction(functionData)
  }

  const loadMyContacts = async () => {
    try {
      if (!publicClient || !tunnelAddress || !address) return

      const keys = await getUnlockedKey()
      if (!keys) return

      const onchainContacts = await publicClient.readContract({
        address: tunnelAddress,
        abi: abiChat,
        functionName: 'getEncryptedContacts',
        args: [address],
      })

      const cid = normalizeCID(onchainContacts?.[0] ?? '')
      const version = Number(onchainContacts?.[2] ?? 0)

      if (!cid || version === 0) {
        setContacts([])
        return
      }

      const payload = await cachedGetIPFS(cid)
      let rawBlob = typeof payload === 'string' ? payload : payload?.encrypted_data || payload?.encryptedData || payload?.data || null
      if (!rawBlob) {
        setContacts([])
        return
      }
      rawBlob = rawBlob.replace(/^"|"$/g, '').trim()
      if (rawBlob.startsWith('{')) {
        try {
          const unwrapped = JSON.parse(rawBlob)
          rawBlob = unwrapped.encryptedData || unwrapped.encrypted_data || unwrapped.data || rawBlob
        } catch {
          console.warn('Failed to parse IPFS JSON wrapper.')
        }
      }

      // Try both key formats: the vault normalises to bare hex, but contacts
      // saved before that normalisation may have been encrypted with the 0x-prefixed form.
      const keyVariants = [keys.privKeyHex, `0x${keys.privKeyHex}`]
      let decoded = null
      for (const key of keyVariants) {
        try {
          const bytes = CryptoJS.AES.decrypt(rawBlob, key)
          const candidate = bytes.toString(CryptoJS.enc.Utf8)
          if (candidate) { decoded = candidate; break }
        } catch {}
      }
      if (!decoded) {
        console.error('Cryptographic Fault: could not decrypt contacts with any known key format.')
        setContacts([])
        return
      }
      const parsed = JSON.parse(decoded)
      console.log(parsed)
      const normalized = Array.isArray(parsed) ? parsed : parsed?.contacts
      const validContacts = Array.isArray(normalized)
        ? normalized.filter((item) => item?.contactAddress && item?.topic && item?.stealthAddress)
        : []
      setContacts(validContacts)
    } catch (err) {
      console.error('Failed loading contacts:', err)
    }
  }

  const uploadObjectToIPFS = async (json) => {
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
      throw error
    }
  }

  const readHistoryChat = async (contactAddress) => {
    const keys = await getUnlockedKey()
    if (!keys || !publicClient || !tunnelAddress || !address) return []
    const subtle = window.crypto.subtle
    const myAddress = address.toLowerCase()

    try {
      const friend = contacts.find((c) => c.contactAddress.toLowerCase() === contactAddress.toLowerCase())

      // Peer's current registered public key — needed for ECDH room derivation
      const latestPeerKey = await getRegisteredChatPublicKey(contactAddress)

      // Without a stored contact AND without an on-chain key we have no room to look in
      if (!friend && !latestPeerKey) return []

      const topicsToCheck = new Set()
      if (friend?.topic) topicsToCheck.add(friend.topic)

      // ECDH-derived room — uncomputable without a private key, breaks the address-pair link
      let ecdhStealthAddress = null
      if (latestPeerKey) {
        const ecdhRoom = deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey)
        topicsToCheck.add(ecdhRoom.topic)
        ecdhStealthAddress = ecdhRoom.stealthAddress
        console.debug('[readHistoryChat] ECDH room:', ecdhRoom.topic, ecdhRoom.stealthAddress)
      }

      // Legacy inbox (stored when contact was added — may be old address-based derivation)
      if (friend?.stealthAddress && friend.stealthAddress.toLowerCase() !== ecdhStealthAddress?.toLowerCase()) {
        try {
          const [inboxTopics] = await publicClient.readContract({
            address: tunnelAddress,
            abi: abiChat,
            functionName: 'getPaginatedTopics',
            args: [friend.stealthAddress, 0n, 50n],
          })
          if (Array.isArray(inboxTopics)) {
            inboxTopics.forEach((t) => topicsToCheck.add(t))
          }
        } catch (e) {
          console.warn('Legacy meeting point inbox fetch failed:', e)
        }
      }

      // Primary inbox: ECDH-derived stealth address
      if (ecdhStealthAddress) {
        try {
          const [inboxTopics] = await publicClient.readContract({
            address: tunnelAddress,
            abi: abiChat,
            functionName: 'getPaginatedTopics',
            args: [ecdhStealthAddress, 0n, 50n],
          })
          if (Array.isArray(inboxTopics)) {
            inboxTopics.forEach((t) => topicsToCheck.add(t))
          }
        } catch (e) {
          console.warn('ECDH meeting point inbox fetch failed:', e)
        }
      }

      const candidateTopics = Array.from(topicsToCheck)

      if (candidateTopics.length === 0) return []

      // Fetch history for all candidate topics in parallel
      const historyResponses = await Promise.all(
        candidateTopics.map(async (topic) => {
          try {
            const response = await publicClient.readContract({
              address: tunnelAddress,
              abi: abiChat,
              functionName: 'getTopicHistory',
              args: [topic, 0n, BigInt(CHAT_PAGE_SIZE)],
            })
            if (!Array.isArray(response?.[0])) return []
            // getTopicHistory returns newest-first; conversationThreads indexes oldest-first.
            // Map each JS position back to the correct on-chain index so messageId lookups land on the right slot.
            const total = Number(response[1])
            return response[0].map((msg, jsIndex) => ({ topic, index: total - 1 - jsIndex, msg }))
          } catch {
            return []
          }
        })
      )

      const flatMessages = historyResponses.flat().filter(Boolean)

      // Deduplicate
      const seenIds = new Set()
      const mergedMessages = flatMessages.filter((entry) => {
        const meta = entry?.msg?.metadata ?? entry?.msg?.[2] ?? ''
        const sender = entry?.msg?.sender ?? entry?.msg?.[0] ?? ''
        const timestamp = String(entry?.msg?.timestamp ?? entry?.msg?.[1] ?? '')
        const id = `${entry.topic}-${sender}-${timestamp}-${meta}`
        if (seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })

      // ── Resolve message IDs via conversationThreads (direct contract read) ──────
      if (mergedMessages.length > 0) {
        try {
          const results = await publicClient.multicall({
            contracts: mergedMessages.map((entry) => ({
              address: tunnelAddress,
              abi: abiChat,
              functionName: 'conversationThreads',
              args: [entry.topic, BigInt(entry.index)],
            })),
            allowFailure: true,
          })
          mergedMessages.forEach((entry, i) => {
            const r = results[i]
            // 0n means uninitialized slot — not a valid message ID
            entry.messageId = r.status === 'success' && r.result != null && r.result !== 0n ? r.result : null
          })
        } catch {
          mergedMessages.forEach((entry) => { entry.messageId = null })
        }
      }
      console.debug('[chat] messageIds resolved:', mergedMessages.map((e) => e.messageId?.toString() ?? 'null'))

      // Pre-derive seed keys for all candidate topics
      const topicSeedKeys = {}
      for (const topic of candidateTopics) {
        const seed = ethers.keccak256(ethers.concat([topic, ethers.toUtf8Bytes('content-encryption')]))
        topicSeedKeys[topic] = await subtle.importKey('raw', ethers.getBytes(seed), 'AES-GCM', true, ['encrypt', 'decrypt'])
      }

      // Fetch my burner address for sender identification
      let myBurnerAddress = ''
      try {
        const mySession = await publicClient.readContract({
          address: tunnelAddress,
          abi: abiChat,
          functionName: 'userSessions',
          args: [address],
        })
        myBurnerAddress = (mySession?.burnerKey ?? mySession?.[0] ?? '').toLowerCase()
      } catch {}

      const decryptedList = await Promise.all(
        mergedMessages.map(async (entry) => {
          try {
            const msg = entry.msg
            const onChainSender = String(msg.sender ?? msg[0] ?? '').toLowerCase()
            const msgTimestamp = Number(msg.timestamp ?? msg[1] ?? 0)
            const msgMetadata = normalizeCID(msg.metadata ?? msg[2] ?? '')
            const msgEncryptedKey = msg.encryptedKey ?? msg[3]
            const msgDeleted = Boolean(msg.isDeleted ?? msg[5])

            if (!msgMetadata || msgDeleted) return null

            const ipfsPayloadRaw = await cachedGetIPFS(msgMetadata)
            let ipfsPayload = typeof ipfsPayloadRaw === 'string' ? JSON.parse(ipfsPayloadRaw) : ipfsPayloadRaw
            if (typeof ipfsPayload === 'string') {
              try {
                ipfsPayload = JSON.parse(ipfsPayload)
              } catch {
                return null
              }
            }

            // Determine direction using senderAddr from payload (most reliable)
            // Fall back to on-chain sender vs known addresses
            const payloadSender = ipfsPayload?.senderAddr?.toLowerCase?.() ?? null
            const effectiveSender = payloadSender ?? onChainSender

            const isMine = effectiveSender === myAddress || onChainSender === myAddress || onChainSender === myBurnerAddress

            // Resolve decryption key
            let decryptionKey = null

            // Primary path: topic seed key — both parties derive the same key independently
            // since topic = pairHash(sorted addresses) is symmetric for sender and receiver
            decryptionKey = topicSeedKeys[entry.topic] ?? null

            // Fallback for incoming messages: ECIES unwrap
            // (only works when vault private key matches the registered on-chain public key)
            if (!decryptionKey && !isMine) {
              const wrappedKeyBlob = decodeEncryptedKeyBlob(msgEncryptedKey)
              if (wrappedKeyBlob) {
                try {
                  const unwrappedSeedBytes = ecies.decrypt(
                    Buffer.from(keys.privKeyHex.replace(/^0x/, ''), 'hex'),
                    Buffer.from(wrappedKeyBlob)
                  )
                  decryptionKey = await subtle.importKey('raw', new Uint8Array(unwrappedSeedBytes), 'AES-GCM', true, ['decrypt'])
                } catch (eciesErr) {
                  console.warn('ECIES unwrap failed:', msgMetadata, eciesErr?.message)
                }
              }
            }

            if (!decryptionKey) {
              console.warn('No decryption key for:', msgMetadata, '| isMine:', isMine)
              return null
            }

            const exportedKeyBuffer = await subtle.exportKey('raw', decryptionKey)
            const rawKeyHex = ethers.hexlify(new Uint8Array(exportedKeyBuffer))

            const iv = ethers.getBytes(ipfsPayload.iv)
            const ciphertext = ethers.getBytes(ipfsPayload.ciphertext)

            let decryptedBuffer
            try {
              decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, decryptionKey, ciphertext)
            } catch (aesgcmErr) {
              console.warn('AES-GCM decrypt failed:', msgMetadata, aesgcmErr?.message)
              return null
            }

            const content = JSON.parse(new TextDecoder().decode(decryptedBuffer))

            return {
              id: `${entry.topic}-${msgTimestamp}-${effectiveSender}-${msgMetadata}`,
              content,
              timestamp: new Date(msgTimestamp * 1000).toLocaleString(),
              sender: effectiveSender,
              onChainSender,
              side: isMine ? 'me' : 'them',
              rawTimestamp: msgTimestamp,
              rawKeyHex,
              messageId: entry.messageId,
              topic: entry.topic,
              isEdited: Boolean(msg.isEdited ?? msg[4]),
              isMine,
              encryptedKey: msgEncryptedKey ?? '0x',
            }
          } catch (err) {
            console.warn('Message processing failed:', err)
            return null
          }
        })
      )

      return decryptedList.filter(Boolean).sort((a, b) => a.rawTimestamp - b.rawTimestamp)
    } catch (error) {
      console.error('readHistoryChat failed:', error)
      return []
    }
  }

  const handleBack = () => {
    setShowChat(false)
    setReceiverAddress('')
    activeReceiverRef.current = null
    setChatHistory({ list: [], isLoading: false })
    if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
  }

  const viewChatWith = async (contactAddress, clearPending = false) => {
    if (!contactAddress) return
    if (activeReceiverRef.current !== contactAddress) lastConfirmedCountRef.current = 0
    if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
    setShowChat(true)
    setReceiverAddress(contactAddress)
    activeReceiverRef.current = contactAddress

    const performSync = async (opts = {}) => {
      if (isProcessingQueueRef.current) return
      try {
        const prevCount = lastConfirmedCountRef.current
        const freshMessages = await readHistoryChat(contactAddress)
        if (contactAddress !== activeReceiverRef.current) return
        lastConfirmedCountRef.current = freshMessages.length
        setChatHistory({ list: freshMessages, isLoading: false })
        // Remove 'sent' pending bubbles only once their message actually lands on chain.
        // On fast chains this is immediate; on LUKSO it waits for the next poll that
        // sees a higher message count, avoiding the disappear-then-reappear flash.
        if (freshMessages.length > prevCount) {
          setPendingMessages((prev) => prev.filter((m) => m.status === 'sending'))
        }
        if (opts.clearPending) setPendingMessage(null)
      } catch (err) {
        console.error('Background message sync failure:', err)
        setChatHistory((prev) => ({ ...prev, isLoading: false }))
        if (opts.clearPending) setPendingMessage(null)
      }
    }
    setChatHistory((prev) => ({ ...prev, isLoading: prev.list.length === 0 }))
    await performSync({ clearPending })
    chatIntervalRef.current = setInterval(performSync, 5000)
  }

  const updateMessageStatus = (id, status, error = null) => {
    setPendingMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, status, error } : msg)))
  }

  // Relays queued messages one at a time so meta-tx nonces stay sequential.
  async function processQueue() {
    if (isProcessingQueueRef.current || sendQueueRef.current.length === 0) return
    isProcessingQueueRef.current = true

    const { pendingId, capturedReceiverAddress, capturedMediaItems, trimmed } = sendQueueRef.current[0]

    try {
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault is locked.')
      const friend = contacts.find((c) => c.contactAddress.toLowerCase() === capturedReceiverAddress.toLowerCase())
      if (!friend) throw new Error('Contact not found.')
      const latestPeerKey = await getRegisteredChatPublicKey(friend.contactAddress)
      if (!latestPeerKey) throw new Error('Receiver public key not registered.')

      const latestRoom = deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey)
      const subtle = window.crypto.subtle
      const derivedKeySeed = ethers.keccak256(ethers.concat([latestRoom.topic, ethers.toUtf8Bytes('content-encryption')]))
      const contentKey = await subtle.importKey('raw', ethers.getBytes(derivedKeySeed), 'AES-GCM', true, ['encrypt'])

      const processedMediaItems = []
      for (const item of capturedMediaItems) {
        const arrayBuffer = await item.file.arrayBuffer()
        const mediaIv = window.crypto.getRandomValues(new Uint8Array(12))
        const encryptedMediaBuffer = await subtle.encrypt({ name: 'AES-GCM', iv: mediaIv }, contentKey, arrayBuffer)
        const encryptedBlob = new Blob([encryptedMediaBuffer])
        const mediaCid = await uploadFileToIPFS(encryptedBlob)
        processedMediaItems.push({
          type: item.type,
          cid: mediaCid,
          iv: ethers.hexlify(mediaIv),
          mimeType: item.mimeType,
          width: item.width,
          height: item.height,
          duration: item.duration,
        })
      }

      const messageElements = []
      if (trimmed) messageElements.push({ type: 'text', data: { text: trimmed } })
      if (processedMediaItems.length > 0) messageElements.push({ type: 'media', data: { items: processedMediaItems } })

      const payloadIv = window.crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv: payloadIv },
        contentKey,
        new TextEncoder().encode(JSON.stringify({ version: '1', elements: messageElements }))
      )

      // Prefetch nonce from forwarder in parallel with IPFS — saves one RPC round-trip on first send.
      const burnerAddr = localStorage.getItem(chatLocalStorageBurnerAddress)
      const shouldPrefetchNonce = currentNonce.current === null && !!burnerAddr && !!publicClient && !!forwarderAddress
      const [ipfsResult, rawPrefetchedNonce] = await Promise.all([
        uploadObjectToIPFS({
          version: '1',
          iv: ethers.hexlify(payloadIv),
          ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
          senderAddr: address,
        }),
        shouldPrefetchNonce
          ? publicClient.readContract({ address: forwarderAddress, abi: forwarderAbi, functionName: 'nonces', args: [burnerAddr] })
          : Promise.resolve(null),
      ])
      if (!ipfsResult?.cid) throw new Error('IPFS upload failed.')
      // Prime the nonce cache: getNextNonce will increment, so we store prefetched - 1.
      if (rawPrefetchedNonce !== null) currentNonce.current = rawPrefetchedNonce - 1n

      const uncompressedRawKey = latestPeerKey.startsWith('0x') ? latestPeerKey : `0x${latestPeerKey}`
      const receiverWrappedKey = ecies.encrypt(uncompressedRawKey, Buffer.from(ethers.getBytes(derivedKeySeed)))
      const success = await sendShroudedMessage(
        latestRoom.stealthAddress,
        latestRoom.topic,
        normalizeCID(ipfsResult.cid),
        receiverWrappedKey
      )

      if (!success) throw new Error('Transaction submission failed.')

      capturedMediaItems.forEach((item) => item.localUrl && URL.revokeObjectURL(item.localUrl))
      if (capturedReceiverAddress === activeReceiverRef.current) {
        // Mark as sent (shows checkmark) and refresh. The pending bubble is removed
        // only when polling sees the confirmed message on chain — prevents the flash
        // on slow chains (LUKSO) where the tx isn't mined before the first refresh.
        updateMessageStatus(pendingId, 'sent')
        mutate(['chat-history', capturedReceiverAddress])
        await viewChatWith(capturedReceiverAddress)
      } else {
        setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId))
      }
    } catch (error) {
      console.error('Messaging engine error:', error)
      updateMessageStatus(pendingId, 'error', error.message)
    } finally {
      sendQueueRef.current.shift()
      isProcessingQueueRef.current = false
      processQueueRef.current?.()
    }
  }
  processQueueRef.current = processQueue

  async function sendEncryptedMessage(e) {
    if (e) e.preventDefault()
    const trimmed = messageText.trim()
    const hasMedia = mediaItems.length > 0
    if ((!trimmed && !hasMedia) || !receiverAddress) return

    const capturedMediaItems = [...mediaItems]
    const pendingId = `pending-${Date.now()}-${Math.random()}`

    setMessageText('')
    setMediaItems([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setPendingMessages((prev) => [
      ...prev,
      {
        id: pendingId,
        content: { elements: [{ type: 'text', data: { text: trimmed || 'Uploading secure payload...' } }] },
        timestamp: new Date().toLocaleString(),
        sender: address?.toLowerCase(),
        side: 'me',
        status: 'sending',
      },
    ])

    sendQueueRef.current.push({ pendingId, capturedReceiverAddress: receiverAddress, capturedMediaItems, trimmed })
    processQueueRef.current?.()
  }

  const handleTextareaChange = (e) => {
    setMessageText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendEncryptedMessage(e)
    }
  }
// mettingPoint = stealth address and topic is the thread topic id
  const sendShroudedMessage = async (meetingPoint, topic, metadataCid, receiverWrappedKey) => {
    const wrappedKeyHex = typeof receiverWrappedKey === 'string' ? receiverWrappedKey : bytesToHex(receiverWrappedKey)
    const functionData = encodeFunctionData({
      abi: abiChat,
      functionName: 'sendMessage',
      args: [ZERO_ADDRESS, meetingPoint, topic, metadataCid, wrappedKeyHex],
    })
    return relayMetaTransaction(functionData)
  }

  const newChat = async (inputAddress) => {
    const contactAddress = inputAddress?.trim()
    if (!contactAddress || !/^0x[a-fA-F0-9]{40}$/.test(contactAddress)) throw new Error('Please enter a valid wallet address.')
    try {
      const normalizedAddress = contactAddress.toLowerCase()
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')
      if (address && normalizedAddress === address.toLowerCase()) throw new Error('You cannot add your own wallet as a contact.')
      const alreadyExists = contacts.some((item) => item.contactAddress.toLowerCase() === normalizedAddress)
      if (alreadyExists) throw new Error('This contact is already in your list.')
      const peerPublicKey = await getRegisteredChatPublicKey(contactAddress)
      if (!peerPublicKey) throw new Error("This profile hasn't registered cryptographic chat keys yet.")
      const { stealthAddress, topic } = deriveRoomFromPeerKey(keys.privKeyHex, peerPublicKey)
      const nextContacts = [...contacts, { contactAddress: normalizedAddress, publicKey: peerPublicKey, topic, stealthAddress }]
      await persistContactsOnchain(nextContacts, keys)
      setContacts(nextContacts)
      setContactsRefreshKey((prev) => prev + 1)
      setReceiverAddress(normalizedAddress)
      activeReceiverRef.current = normalizedAddress
      await viewChatWith(normalizedAddress)
    } catch (e) {
      throw e
    }
  }

  const handleAddContactSubmit = async (e) => {
    e.preventDefault()
    setContactError('')
    setIsSubmittingContact(true)
    try {
      await newChat(contactInput)
      setContactInput('')
      setIsAddingContact(false)
    } catch (error) {
      setContactError(error.message || 'Failed to add contact.')
    } finally {
      setIsSubmittingContact(false)
    }
  }

  const deleteContact = async (contactAddress) => {
    setDeletingContact(contactAddress)
    try {
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')
      const nextContacts = contacts.filter((c) => c.contactAddress.toLowerCase() !== contactAddress.toLowerCase())
      await persistContactsOnchain(nextContacts, keys)
      setContacts(nextContacts)
      setContactsRefreshKey((prev) => prev + 1)
      if (receiverAddress?.toLowerCase() === contactAddress.toLowerCase()) {
        handleBack()
      } else {
        setChatHistory({ list: [], isLoading: false })
      }
    } catch (err) {
      setContactError(err.message || 'Failed to delete contact.')
    } finally {
      setDeletingContact(null)
    }
  }

  // ─── Registration Guards ─────────────────────────────────────────────────

  useEffect(() => {
    if (!isMounted) return
    const hasVault = !!localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)
    const hasBurner = !!localStorage.getItem(chatLocalStorageBurnerAddress)
    if (!hasVault || !hasBurner) router.replace('/register')
  }, [isMounted, router])

  useEffect(() => {
    if (!isMounted || !isConnected || !address || !publicClient || !tunnelAddress) return
    const checkOnChainRegistration = async () => {
      try {
        const [pk, session, latestBlock] = await Promise.all([
          pkRegistryAddress
            ? publicClient.readContract({ address: pkRegistryAddress, abi: abiPublicKeyRegistry, functionName: 'getKey', args: [address] })
            : publicClient.readContract({ address: tunnelAddress, abi: abiChat, functionName: 'publicKeyRegistry', args: [address] }),
          publicClient.readContract({ address: tunnelAddress, abi: abiChat, functionName: 'userSessions', args: [address] }),
          publicClient.getBlock({ blockTag: 'latest' }),
        ])

        const isPkRegistered = Boolean(pk && pk !== '0x')
        const burnerKey = String(session?.burnerKey ?? session?.[0] ?? ZERO_ADDRESS)
        const expiresAt = BigInt(session?.expiresAt ?? session?.[1] ?? 0)
        const networkTime = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000))
        const localBurnerAddress = localStorage.getItem(chatLocalStorageBurnerAddress)
        const isSessionValid =
          burnerKey !== ZERO_ADDRESS &&
          expiresAt > networkTime &&
          localBurnerAddress?.toLowerCase() === burnerKey.toLowerCase()

        if (!isPkRegistered || !isSessionValid) {
          router.replace('/register')
          return
        }

        // Verify vault private key matches the on-chain registered public key.
        // A mismatch means the vault was re-created without updating the on-chain PK,
        // which would make ECDH produce different topics for sender and receiver.
        const sessionPin = sessionStorage.getItem(APP_PASSWORD_SESSION_STORAGE)
        if (sessionPin && isPkRegistered) {
          try {
            const keys = await unlockAppKeyFromStorage()
            if (keys) {
              const vaultPubKey = new ethers.SigningKey(`0x${keys.privKeyHex}`).publicKey
              const onChainPubKey = String(pk)
              if (vaultPubKey.toLowerCase() !== onChainPubKey.toLowerCase()) {
                console.warn('[chat] Vault key mismatch with on-chain PK — redirecting to re-register')
                router.replace('/register')
              }
            }
          } catch {
            // Unlock failure handled by getUnlockedKey() elsewhere
          }
        }
      } catch {
        // Don't redirect on transient RPC errors
      }
    }
    void checkOnChainRegistration()
  }, [isMounted, isConnected, address, publicClient, tunnelAddress, router])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chatHistory.list, pendingMessages])

  useEffect(() => {
    if (!isConnected || !isMounted || !address || !publicClient || !tunnelAddress || contactsInitializedRef.current) return
    contactsInitializedRef.current = true
    setTimeout(() => {
      void loadMyContacts()
      void loadReactionTypes()
    }, 0)
    return () => {
      if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
    }
  }, [isConnected, isMounted, address, publicClient, tunnelAddress])

  useEffect(() => {
    if (!isConnected) contactsInitializedRef.current = false
  }, [isConnected])

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  // Close menus/pickers on outside click
  useEffect(() => {
    if (!activeMessageMenu && !reactionPickerMessageId) return
    const close = () => {
      setActiveMessageMenu(null)
      setReactionPickerMessageId(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [activeMessageMenu, reactionPickerMessageId])

  const handleToggleMenu = (e, msgId) => {
    e.stopPropagation()
    setActiveMessageMenu((prev) => (prev === msgId ? null : msgId))
    setReactionPickerMessageId(null)
  }

  const handleToggleReactionPicker = (e, msgId) => {
    e.stopPropagation()
    setReactionPickerMessageId((prev) => (prev === msgId ? null : msgId))
    setActiveMessageMenu(null)
  }

  const handleDeleteMessage = async (msg) => {
    if (msg.messageId == null || !msg.isMine) {
      console.warn('[delete] blocked — messageId:', msg.messageId, 'isMine:', msg.isMine)
      return
    }
    console.log('[delete] messageId:', msg.messageId?.toString(), 'owner:', address)
    setDeletingMessageId(msg.id)
    setActiveMessageMenu(null)
    try {
      const functionData = encodeFunctionData({
        abi: abiChat,
        functionName: 'deleteMessage',
        args: [resolveOwnerArg(msg), msg.messageId],
      })
      currentNonce.current = null
      await relayMetaTransaction(functionData)
      setChatHistory((prev) => ({
        ...prev,
        list: prev.list.filter((m) => m.id !== msg.id),
      }))
    } catch (err) {
      console.error('Delete message failed:', err)
      if (err.message === 'MessageDeletedError') {
        // Already deleted on-chain — sync the UI
        setChatHistory((prev) => ({
          ...prev,
          list: prev.list.filter((m) => String(m.messageId) !== String(msg.messageId)),
        }))
      } else {
        alert(`Delete failed: ${err.message}`)
      }
    } finally {
      setDeletingMessageId(null)
    }
  }

  const handleStartEdit = (msg) => {
    const textEl = msg.content?.elements?.find((el) => el.type === 'text')
    setEditText(textEl?.data?.text ?? '')
    setEditingMessageId(msg.id)
    setActiveMessageMenu(null)
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditText('')
  }

  // _resolveActor in the contract short-circuits when _owner == address(0) OR _owner == _msgSender()
  // (the burner), so no session check is required. Use ZERO_ADDRESS when the message was stored
  // under the burner wallet; use mainWallet when stored under mainWallet (requires valid session).
  const resolveOwnerArg = (msg) =>
    (msg.onChainSender ?? '').toLowerCase() === address?.toLowerCase() ? address : ZERO_ADDRESS

  const handleSaveEdit = async () => {
    const msg = chatHistory.list.find((m) => m.id === editingMessageId)
    if (!msg || !msg.topic || msg.messageId == null) {
      console.warn('[edit] blocked — msg:', msg, 'editingMessageId:', editingMessageId)
      return
    }
    console.log('[edit] messageId:', msg.messageId, 'topic:', msg.topic)
    const newText = editText.trim()
    if (!newText) return
    try {
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')
      const subtle = window.crypto.subtle
      const derivedKeySeed = ethers.keccak256(ethers.concat([msg.topic, ethers.toUtf8Bytes('content-encryption')]))
      const contentKey = await subtle.importKey('raw', ethers.getBytes(derivedKeySeed), 'AES-GCM', true, ['encrypt'])
      const payloadIv = window.crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv: payloadIv },
        contentKey,
        new TextEncoder().encode(JSON.stringify({ version: '1', elements: [{ type: 'text', data: { text: newText } }] }))
      )
      const ipfsResult = await uploadObjectToIPFS({
        version: '1',
        iv: ethers.hexlify(payloadIv),
        ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
        senderAddr: address,
      })
      if (!ipfsResult?.cid) throw new Error('IPFS upload failed.')
      const functionData = encodeFunctionData({
        abi: abiChat,
        functionName: 'updateMessage',
        args: [resolveOwnerArg(msg), msg.messageId, normalizeCID(ipfsResult.cid), msg.encryptedKey ?? '0x'],
      })
      currentNonce.current = null
      await relayMetaTransaction(functionData)
      setChatHistory((prev) => ({
        ...prev,
        list: prev.list.map((m) =>
          m.id === editingMessageId
            ? { ...m, content: { elements: [{ type: 'text', data: { text: newText } }] }, isEdited: true }
            : m
        ),
      }))
      setEditingMessageId(null)
      setEditText('')
    } catch (err) {
      console.error('Edit message failed:', err)
      alert(`Edit failed: ${err.message}`)
    }
  }

  const handleSetReaction = async (msg, reactionTypeId) => {
    if (msg.messageId == null) {
      console.warn('[reaction] blocked — messageId is null')
      return
    }
    setReactionPickerMessageId(null)
    setPendingReactionId(msg.messageId)
    try {
      const functionData = encodeFunctionData({
        abi: abiChat,
        functionName: 'setMessageReaction',
        args: [resolveOwnerArg(msg), msg.messageId, reactionTypeId],
      })
      currentNonce.current = null
      await relayMetaTransaction(functionData)
      setMyReactions((prev) => ({ ...prev, [String(msg.messageId)]: reactionTypeId }))
    } catch (err) {
      console.error('Reaction failed:', err)
    } finally {
      setPendingReactionId(null)
    }
  }

  // ■■■ Renderers ■■■

  const renderMessageElements = (elements, rawKeyHex, onLoad) => {
    return elements?.map((el, i) => {
      if (el.type === 'text') {
        return <p key={i}>{el.data.text}</p>
      }
      if (el.type === 'media') {
        return (
          <div key={i} className={clsx(styles['chat-message__media-grid'], 'mt-2')}>
            {el.data.items.map((item, idx) => (
              <EncryptedMediaItem key={idx} item={item} rawKeyHex={rawKeyHex} onLoad={onLoad} />
            ))}
          </div>
        )
      }
      return null
    })
  }

  if (!isMounted) return null

  return (
    <div className={clsx(styles.chat)}>
      <aside className={clsx(styles.aside, 'flex flex-column justify-content-start', showChat && styles['aside--mobile-hidden'])}>
        <header className={clsx(styles.aside__header, 'flex align-items-center justify-content-between')}>
          <h4 className="flex flex-row align-items-center justify-content-center">Messages</h4>
          <ul className="flex align-items-center justify-content-between">
            <li>
              <button onClick={() => setIsAddingContact((prev) => !prev)}>
                <MessageSquarePlus width={18} height={18} strokeWidth={1.5} />
              </button>
            </li>
            <li>
              <button>
                <EllipsisVertical width={18} height={18} strokeWidth={1.5} />
              </button>
            </li>
          </ul>
        </header>
        <div className={styles['aside__body']}>
          {isAddingContact && (
            <form onSubmit={handleAddContactSubmit} className={styles['add-contact']}>
              <input
                type="text"
                value={contactInput}
                onChange={(e) => setContactInput(e.target.value)}
                placeholder="0x... wallet address"
                autoFocus
              />
              <button type="submit" disabled={isSubmittingContact}>
                {isSubmittingContact ? <ContentSpinner /> : 'Add'}
              </button>
            </form>
          )}
          {contactError && <p className={styles['add-contact__error']}>{contactError}</p>}
          <ConversationList activeChat={receiverAddress} onSelect={viewChatWith} 
          onDelete={deleteContact} deletingContact={deletingContact} contacts={contacts} refreshKey={contactsRefreshKey} />
        </div>
        <div className={styles['aside__features']}>
          <p className={styles['aside__features__title']}>Why Tunnel</p>
          <ul className={styles['aside__features__list']}>
            <li>No email, phone, or real name needed</li>
            <li>Stealth address — your wallet stays hidden</li>
            <li>Only you and your contact can read messages</li>
            <li>Contacts and chats live onchain, not our servers</li>
            <li>Zero gas fees to send messages</li>
            <li>No one can block or delete your conversations</li>
            <li>No trail linking sender to receiver</li>
            <li>Hosted on blockchain and IPFS</li>
            <li>Works across multiple chains</li>
          </ul>
        </div>
      </aside>

      <main className={clsx(styles.main, !showChat && styles['main--mobile-hidden'], receiverAddress && styles['main--has-header'])}>
        {receiverAddress && (
          <div className={styles['main__header']}>
            <button className={styles['back-button']} onClick={handleBack} aria-label="Back to conversations">
              <ChevronLeft size={20} />
            </button>
            <div className={styles['main__header-profile']}>
              {receiverProfile?.name && (
                <strong className={styles['main__header-name']}>
                  {receiverProfile.fullName || receiverProfile.name}
                </strong>
              )}
              <span className={styles['main__header-address']}>
                {receiverAddress.slice(0, 6)}...{receiverAddress.slice(-4)}
              </span>
            </div>
          </div>
        )}
        {!receiverAddress ? (
          <div className={styles['main__empty']}>
            <p>Select a chat to start messaging</p>
          </div>
        ) : (
          <>
            <div className={clsx(styles.chatHistory)} ref={scrollRef}>
              {chatHistory.list.map((msg) => (
                <div key={msg.id} className={clsx(styles['chat-message__wrapper'], styles[`chat-message__wrapper--${msg.side}`])}>
                  <div className={styles['chat-message__actions']}>
                    {reactionTypes.length > 0 && (
                      <div className={styles['chat-message__menu-wrapper']}>
                        <button
                          className={styles['chat-message__action-btn']}
                          onClick={(e) => handleToggleReactionPicker(e, msg.id)}
                          disabled={msg.messageId == null || pendingReactionId === msg.messageId}
                        >
                          <Smile size={14} />
                        </button>
                        {reactionPickerMessageId === msg.id && (
                          <div
                            className={clsx(styles['chat-message__reaction-picker'], styles[`chat-message__reaction-picker--${msg.side}`])}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {reactionTypes.map((rt) => (
                              <button key={rt.id} onClick={() => handleSetReaction(msg, rt.id)} title={rt.label}>
                                {rt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {msg.isMine && (
                      <div className={styles['chat-message__menu-wrapper']}>
                        <button
                          className={styles['chat-message__action-btn']}
                          onClick={(e) => handleToggleMenu(e, msg.id)}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {activeMessageMenu === msg.id && (
                          <ul className={styles['chat-message__menu']} onClick={(e) => e.stopPropagation()}>
                            <li>
                              <button onClick={() => handleStartEdit(msg)}>
                                <Pencil size={12} /> Edit
                              </button>
                            </li>
                            <li>
                              <button
                                className={styles['chat-message__menu-item--danger']}
                                onClick={() => handleDeleteMessage(msg)}
                                disabled={deletingMessageId === msg.id}
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </li>
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={clsx(styles['chat-message'], styles[`chat-message--${msg.side}`])}>
                    {editingMessageId != null && editingMessageId === msg.id ? (
                      <div className={styles['chat-message__edit']}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit() }
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                        />
                        <div className={styles['chat-message__edit__actions']}>
                          <button className={styles['chat-message__edit__btn']} onClick={handleCancelEdit}><X size={12} /></button>
                          <button className={styles['chat-message__edit__btn']} onClick={handleSaveEdit}><Check size={12} /></button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles['chat-message__content']}>
                        {renderMessageElements(msg.content?.elements, msg.rawKeyHex, scrollToBottom)}
                        {msg.isEdited && <span className={styles['chat-message__edited']}>(edited)</span>}
                      </div>
                    )}
                    <div className={styles['chat-message__timestamp']} title={msg.timestamp}>
                      <span className={'flex gap-025'}>
                        {msg.timestamp.split(',')[1]?.trim() || msg.timestamp}
                        <CheckCircle2 strokeWidth={2} size={12} />
                      </span>
                    </div>
                    {myReactions[String(msg.messageId)] && (
                      <div className={styles['chat-message__reaction-badge']}>
                        {reactionTypes.find((rt) => rt.id === myReactions[String(msg.messageId)])?.label}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {pendingMessages.map((msg) => (
                <div key={msg.id} className={clsx(styles['chat-message'], styles['chat-message--me'], styles['chat-message--pending'])}>
                  <div className={styles['chat-message__content']}>{renderMessageElements(msg.content?.elements, null)}</div>
                  <div className={styles['chat-message__timestamp']}></div>
                  <span className={styles['chat-message__sending']}>
                    {msg.status === 'sent' ? <Check size={12} /> : <MessageLoader />}
                  </span>
                </div>
              ))}

              {chatHistory.list.length === 0 && !pendingMessage && (
                <div className={styles['chat-history__empty']}>Start chatting securely!</div>
              )}
            </div>

            <footer className={styles.footer}>
              <form onSubmit={sendEncryptedMessage}>
                <input ref={fileInputRef} type="file" onChange={handleFileSelect} multiple={false} style={{ display: 'none' }} />
                {mediaItems.length > 0 && (
                  <div className={styles['footer__media-staging']}>
                    {mediaItems.map((item, index) => (
                      <figure key={`${item.localUrl || index}`} className={styles['footer__media-item']}>
                        {item.type === 'image' ? (
                          <img src={item.localUrl} alt={item.alt || ''} />
                        ) : (
                          <video src={item.localUrl} />
                        )}
                        <button type="button" className={styles['footer__media-remove']} onClick={() => handleRemoveMedia(index)}>
                          <X size={10} />
                        </button>
                      </figure>
                    ))}
                  </div>
                )}
                <div className={styles['footer__row']}>
                  <textarea
                    ref={textareaRef}
                    value={messageText}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Write a message…"
                    rows={1}
                  />
                  <div className={styles['footer__actions']}>
                    <button type="button" className={styles['footer__action-btn']} onClick={() => triggerFileInput('image')}>
                      <ImageIcon size={18} />
                    </button>
                    <button type="button" className={styles['footer__action-btn']} onClick={() => triggerFileInput('video')}>
                      <SquarePlay size={18} />
                    </button>
                    <button type="submit" className={styles['footer__send-btn']} disabled={!messageText.trim() && mediaItems.length === 0}>
                      <ArrowUp size={18} />
                    </button>
                  </div>
                </div>
              </form>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
