'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import CryptoJS from 'crypto-js'
import { ethers } from 'ethers'
import ecies from 'eciesjs'
import { useConnection, usePublicClient } from 'wagmi'
import { getIPFS } from '@/lib/ipfs'
import clsx from 'clsx'
import { ArrowUp, EllipsisVertical, MessageSquarePlus, Image as ImageIcon, SquarePlay, X } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import { bytesToHex, encodeFunctionData } from 'viem'
import { ContentSpinner, MessageLoader } from '@/components/Loading'
import { chatLocalStorageBurnerKey, chatLocalStorageBurnerAddress, chatSessionStorageUnlockedKey, CHAT_ZERO_ADDRESS as ZERO_ADDRESS } from '@/lib/chatBurnerSession'
import { APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE, unlockAppKeyFromStorage } from '@/lib/appVault'
import { getActiveChain } from '@/lib/communication'
import { resolveIPFSUrl } from '@/lib/storageHelper'
import { ConversationList } from './ConversationList'
import styles from './Chat.module.scss'
import abiChat from '@/abis/Chat.json'
import abiPublicKeyRegistry from '@/abis/PublicKeyRegistry.json'
import { Buffer } from 'buffer'
import { useChatHistory } from '@/hooks/useChatHistory'
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
  const [pendingMessage, setPendingMessage] = useState(null)

  const [mediaItems, setMediaItems] = useState([])
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  const fileInputRef = useRef(null)

  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const [activeChainConfig, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat
  const forwarderAddress = activeChainContracts?.forwarder
  const pkRegistryAddress = activeChainContracts?.publicKeyRegistry
  const relayRpcUrl = activeChainConfig?.rpcUrls?.default?.http?.[0]
  const [chatHistory, setChatHistory] = useState({ list: [], isLoading: false })
  const isMounted = useClientMounted()

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

  const deriveRoomFromPeerKey = (myAddress, peerAddress) => {
    // Both topic and stealthAddress are derived from sorted wallet addresses so that
    // both parties always compute the same values, independent of ECDH direction.
    // Content privacy is maintained by ECIES (receiver's public key) for delivery of
    // the per-message AES key — the topic only lets the sender re-derive their own key.
    const [addrA, addrB] = [myAddress.toLowerCase(), peerAddress.toLowerCase()].sort()
    const pairHash = ethers.keccak256(ethers.solidityPacked(['address', 'address'], [addrA, addrB]))
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
    const storedBurnerKey = localStorage.getItem(chatLocalStorageBurnerKey)
    const burnerKey = normalizePrivateKey(unlockedKey) || normalizePrivateKey(storedBurnerKey)
    if (!burnerKey) throw new Error('Session expired or burner key is missing.')
    const burner = new ethers.Wallet(burnerKey)
    const { request, signature } = await signMetaTransactionSessionMode(burner, functionData)

    const res = await fetch('/api/v1/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, signature, rpcUrl: relayRpcUrl, forwarderAddress }, (_, value) =>
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

  const persistContactsOnchain = async (nextContacts, keys) => {
    if (!publicClient || !tunnelAddress || !address) throw new Error('Wallet or chain not ready for contacts sync.')
    const normalizedContacts = nextContacts.map((c) => ({
      contactAddress: c.contactAddress,
      topic: c.topic,
      stealthAddress: c.stealthAddress,
    }))
    const encryptedData = CryptoJS.AES.encrypt(JSON.stringify(normalizedContacts), keys.privKeyHex).toString()
    const ipfsResult = await uploadObjectToIPFS(JSON.stringify({ version: '1', encrypted_data: encryptedData }))
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

      const symmetricKey = keys.privKeyHex.toLowerCase()
      let decoded
      try {
        const bytes = CryptoJS.AES.decrypt(rawBlob, symmetricKey)
        decoded = bytes.toString(CryptoJS.enc.Utf8)
        if (!decoded) throw new Error('Empty decryption buffer.')
      } catch (decryptErr) {
        console.error('Cryptographic Fault:', decryptErr)
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
      if (!friend) return []

      // Peer's current registered public key
      const latestPeerKey = await getRegisteredChatPublicKey(contactAddress)

      // All possible topics:
      // 1. Stored topic when I added the contact (derived with peer's key at that time)
      // 2. Topic derived with peer's CURRENT key (may differ if they re-registered)
      // 3. Topic from peer's perspective using MY current key (for messages they sent to me)
      const topicsToCheck = new Set([friend.topic])

      // Symmetric meeting point: sort addresses so both parties derive the same inbox
      const [addrA, addrB] = [myAddress, contactAddress.toLowerCase()].sort()
      const symmetricStealthAddress = ethers.getAddress(
        ethers.dataSlice(ethers.keccak256(ethers.solidityPacked(['address', 'address'], [addrA, addrB])), 12)
      )

      if (latestPeerKey) {
        const myDerivation = deriveRoomFromPeerKey(address, contactAddress)
        topicsToCheck.add(myDerivation.topic)
      }

      // Also pull topics from the stored stealthAddress inbox (backward compat for contacts
      // added before the symmetric stealthAddress fix)
      if (friend.stealthAddress && friend.stealthAddress.toLowerCase() !== symmetricStealthAddress.toLowerCase()) {
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

      // Primary inbox: symmetric meeting point (same for both parties)
      try {
        const [inboxTopics] = await publicClient.readContract({
          address: tunnelAddress,
          abi: abiChat,
          functionName: 'getPaginatedTopics',
          args: [symmetricStealthAddress, 0n, 50n],
        })
        if (Array.isArray(inboxTopics)) {
          inboxTopics.forEach((t) => topicsToCheck.add(t))
        }
      } catch (e) {
        console.warn('Symmetric meeting point inbox fetch failed:', e)
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
            return Array.isArray(response?.[0]) ? response[0].map((msg) => ({ topic, msg })) : []
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
              side: isMine ? 'me' : 'them',
              rawTimestamp: msgTimestamp,
              rawKeyHex,
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

  const viewChatWith = async (contactAddress, clearPending = false, pendingIdToRemove = null) => {
    if (!contactAddress) return
    if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
    setReceiverAddress(contactAddress)
    activeReceiverRef.current = contactAddress

    const performSync = async (opts = {}) => {
      // Skip background polls while the send queue is active. The queue calls
      // viewChatWith itself after each confirm, so polling here would race and
      // show a confirmed message alongside its still-visible optimistic bubble.
      if (isProcessingQueueRef.current && !opts.pendingIdToRemove) return
      try {
        const freshMessages = await readHistoryChat(contactAddress)
        if (contactAddress !== activeReceiverRef.current) return
        // Both setState calls are synchronous here — React 18 batches them into
        // one render so the swap from optimistic to confirmed is atomic.
        setChatHistory((prev) => {
          if (prev.list.length === freshMessages.length) return { ...prev, isLoading: false }
          return { list: freshMessages, isLoading: false }
        })
        if (opts.pendingIdToRemove) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== opts.pendingIdToRemove))
        }
        if (opts.clearPending) setPendingMessage(null)
      } catch (err) {
        console.error('Background message sync failure:', err)
        setChatHistory((prev) => ({ ...prev, isLoading: false }))
        if (opts.pendingIdToRemove) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== opts.pendingIdToRemove))
        }
        if (opts.clearPending) setPendingMessage(null)
      }
    }
    setChatHistory((prev) => ({ ...prev, isLoading: prev.list.length === 0 }))
    await performSync({ clearPending, pendingIdToRemove })
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

      const latestRoom = deriveRoomFromPeerKey(address, capturedReceiverAddress)
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

      const ipfsResult = await uploadObjectToIPFS({
        version: '1',
        iv: ethers.hexlify(payloadIv),
        ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
        senderAddr: address,
      })
      if (!ipfsResult?.cid) throw new Error('IPFS upload failed.')

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
        mutate(['chat-history', capturedReceiverAddress])
        await viewChatWith(capturedReceiverAddress, false, pendingId)
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendEncryptedMessage(e)
    }
  }

  const sendShroudedMessage = async (meetingPoint, topic, metadataCid, receiverWrappedKey) => {
    const wrappedKeyHex = typeof receiverWrappedKey === 'string' ? receiverWrappedKey : bytesToHex(receiverWrappedKey)
    const functionData = encodeFunctionData({
      abi: abiChat,
      functionName: 'sendMessage',
      args: [address || ZERO_ADDRESS, meetingPoint, topic, metadataCid, wrappedKeyHex],
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
      const { stealthAddress, topic } = deriveRoomFromPeerKey(address, normalizedAddress)
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
      if (receiverAddress.toLowerCase() === contactAddress.toLowerCase()) {
        setReceiverAddress('')
        activeReceiverRef.current = null
        setChatHistory({ list: [], isLoading: false })
        if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
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

        if (!isPkRegistered || !isSessionValid) router.replace('/register')
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
      <aside className={clsx(styles.aside, 'flex flex-column justify-content-start')}>
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
        <ConversationList activeChat={receiverAddress} onSelect={viewChatWith} onDelete={deleteContact} deletingContact={deletingContact} contacts={contacts} refreshKey={contactsRefreshKey} />
      </aside>

      <main className={clsx(styles.main)}>
        <div className={clsx(styles.chatHistory)} ref={scrollRef}>
          {chatHistory.list.map((msg) => (
            <div key={msg.id} className={clsx(styles['chat-message'], styles[`chat-message--${msg.side}`])}>
              <div className={styles['chat-message__content']}>{renderMessageElements(msg.content?.elements, msg.rawKeyHex, scrollToBottom)}</div>
              <div className={styles['chat-message__timestamp']} title={msg.timestamp}>
                <span className={'flex gap-025'}>
                  {msg.timestamp.split(',')[1]?.trim() || msg.timestamp}
                  <CheckCircle2 strokeWidth={2} size={12}/>
                </span>
              </div>
            </div>
          ))}

          {pendingMessages.map((msg) => (
            <div key={msg.id} className={clsx(styles['chat-message'], styles['chat-message--me'], styles['chat-message--pending'])}>
              <div className={styles['chat-message__content']}>{renderMessageElements(msg.content?.elements, null)}</div>
              <div className={styles['chat-message__timestamp']}></div>
              <span className={styles['chat-message__sending']}>
                <MessageLoader />
              </span>
            </div>
          ))}

          {chatHistory.list.length === 0 && !pendingMessage && (
            <div className={styles['chat-history__empty']}>Start chatting securely!</div>
          )}
        </div>

        <footer className={clsx(styles.footer, 'mt-20')}>
          {mediaItems.length > 0 && (
            <div className={clsx(styles['chat-composer__media-staging'], 'flex gap-2 mb-2')}>
              {mediaItems.map((item, index) => {
                return (
                  <figure key={`${item.localUrl || index}`} className="relative">
                    {item.type === 'image' ? (
                      <img src={item.localUrl} alt={item.alt || ''} className="h-16 w-16 object-cover rounded" />
                    ) : (
                      <video src={item.localUrl} className="h-16 w-16 object-cover rounded" />
                    )}
                    <button
                      type="button"
                      className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 text-white"
                      onClick={() => handleRemoveMedia(index)}
                    >
                      <X size={12} />
                    </button>
                  </figure>
                )
              })}
            </div>
          )}

          <form onSubmit={sendEncryptedMessage}>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              multiple={false}
              style={{ display: 'none' }}
            />

            <div className="flex align-items-center justify-content-between gap-1">
              <div className="flex gap-2 mr-2">
                <button type="button" onClick={() => triggerFileInput('image')}>
                  <ImageIcon size={20} />
                </button>
                <button type="button" onClick={() => triggerFileInput('video')}>
                  <SquarePlay size={20} />
                </button>
              </div>

              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a message…"
              />

              <button type="submit" disabled={!messageText.trim() && mediaItems.length === 0}>
                <ArrowUp width={18} height={18} />
              </button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  )
}
