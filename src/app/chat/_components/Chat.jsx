'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import CryptoJS from 'crypto-js'
import { ethers } from 'ethers'
import ecies from 'eciesjs'
import { useConnection, usePublicClient } from 'wagmi'
import { getIPFS } from '@/lib/ipfs'
import clsx from 'clsx'
import { ArrowUp, EllipsisVertical, MessageSquarePlus } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import { bytesToHex, encodeFunctionData } from 'viem'
import { ContentSpinner } from '@/components/Loading'
import { chatLocalStorageBurnerKey, chatSessionStorageUnlockedKey, CHAT_ZERO_ADDRESS as ZERO_ADDRESS } from '@/lib/chatBurnerSession'
import { APP_PASSWORD_SESSION_STORAGE, unlockAppKeyFromStorage } from '@/lib/appVault'
import { getActiveChain } from '@/lib/communication'
import { ConversationList } from './ConversationList'
import styles from './Chat.module.scss'
import abiChat from '@/abis/Chat.json'
import { useProfile } from '@/hooks/useProfile'
import { Buffer } from 'buffer'
import { useChatHistory } from '@/hooks/useChatHistory';
import { useSWRConfig } from 'swr';
const CHAT_PAGE_SIZE = 200

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

export default function Chat() {
  const { mutate } = useSWRConfig();
  const router = useRouter()
  const [messageText, setMessageText] = useState('')
  const [pendingMessages, setPendingMessages] = useState([])
  const [receiverAddress, setReceiverAddress] = useState('')
  const [contacts, setContacts] = useState([])
  const [contactsRefreshKey, setContactsRefreshKey] = useState(0)
  const [isAddingContact, setIsAddingContact] = useState(false)
  const [contactInput, setContactInput] = useState('')
  const [contactError, setContactError] = useState('')
  const contactsInitializedRef = useRef(false)
  const activeReceiverRef = useRef(null)
  const chatIntervalRef = useRef(null)
  const scrollRef = useRef(null)
  const currentNonce = useRef(null)
  // isSending: only blocks the send button, never the textarea
  const [isSending, setIsSending] = useState(false)
  // pendingMessage: optimistic bubble shown while TX is in flight
  const [pendingMessage, setPendingMessage] = useState(null)

  const { address, isConnected } = useConnection()
  const publicClient = usePublicClient()
  const [activeChainConfig, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat
  const forwarderAddress = activeChainContracts?.forwarder
  const relayRpcUrl = activeChainConfig?.rpcUrls?.default?.http?.[0]
  const [chatHistory, setChatHistory] = useState({ list: [], isLoading: false })
  const isMounted = useClientMounted()
const { data: chatList, isLoading } = useChatHistory(receiverAddress, contacts, {
    publicClient,
    tunnelAddress,
    address,
  });
  async function getNextNonce(from) {
    if (currentNonce.current === null) {
      // Only fetch from chain if we don't have one cached
      currentNonce.current = await publicClient.readContract({
        address: forwarderAddress,
        abi: forwarderAbi,
        functionName: 'nonces',
        args: [from],
      })
    } else {
      // If we have one, just return it and increment for next time
      currentNonce.current += 1n
    }
    return currentNonce.current
  }

  const getRegisteredChatPublicKey = async (walletAddress) => {
    if (!walletAddress || !publicClient || !tunnelAddress) return null
    try {
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

  const deriveRoomFromPeerKey = (myPrivateKeyHex, peerPublicKey) => {
    let cleanPriv = myPrivateKeyHex.trim()
    if (!cleanPriv.startsWith('0x')) cleanPriv = `0x${cleanPriv}`
    let cleanPub = peerPublicKey.trim()
    if (!cleanPub.startsWith('0x')) cleanPub = `0x${cleanPub}`
    const signingKey = new ethers.SigningKey(cleanPriv)
    const sharedSecret = signingKey.computeSharedSecret(cleanPub)
    const topic = ethers.keccak256(sharedSecret)
    const stealthAddress = ethers.getAddress(ethers.dataSlice(ethers.keccak256(sharedSecret), 12))
    return { topic, stealthAddress }
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
    console.log('DEBUG 2: Final object payload:', { request, signature })
    const payloadString = JSON.stringify({ request, signature, rpcUrl: relayRpcUrl, forwarderAddress }, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )

    // ADD THIS:
    console.log('DEBUG 3: The exact JSON string sent to server:', payloadString)
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
    console.log(nonce)
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
    console.log('DEBUG 1: Message object before signing:', message)
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
      const payload = await getIPFS(cid)
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
      const latestPeerKey = await getRegisteredChatPublicKey(contactAddress)
      const derivedRoom = latestPeerKey ? deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey) : null
      const candidateTopics = Array.from(new Set([friend.topic, derivedRoom?.topic].filter(Boolean)))
      if (candidateTopics.length === 0) return []
      const historyResponses = await Promise.all(
        candidateTopics.map(async (topic) => {
          const response = await publicClient.readContract({
            address: tunnelAddress,
            abi: abiChat,
            functionName: 'getTopicHistory',
            args: [topic, 0n, BigInt(CHAT_PAGE_SIZE)],
          })
          return Array.isArray(response?.[0]) ? response[0].map((msg) => ({ topic, msg })) : []
        })
      )
      const flatMessages = historyResponses.flat().filter(Boolean)
      const seenIds = new Set()
      const mergedMessages = flatMessages.filter((entry) => {
        const meta = entry?.msg?.metadata ?? entry?.msg?.[2] ?? ''
        const sender = entry?.msg?.sender ?? entry?.msg?.[0] ?? ''
        const timestamp = String(entry?.msg?.timestamp ?? entry?.msg?.[1] ?? '')
        const id = `${entry?.topic || ''}-${sender}-${timestamp}-${meta}`
        if (seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })
      const decryptedList = await Promise.all(
        mergedMessages.map(async (entry) => {
          try {
            const msg = entry.msg
            const msgSender = String(msg.sender ?? msg[0] ?? '').toLowerCase()
            const msgTimestamp = Number(msg.timestamp ?? msg[1] ?? 0)
            const msgMetadata = normalizeCID(msg.metadata ?? msg[2] ?? '')
            const msgEncryptedKey = msg.encryptedKey ?? msg[3]
            const msgDeleted = Boolean(msg.isDeleted ?? msg[5])
            if (!msgMetadata || msgDeleted) return null
            const ipfsPayloadRaw = await getIPFS(msgMetadata)
            const ipfsPayload = typeof ipfsPayloadRaw === 'string' ? JSON.parse(ipfsPayloadRaw) : ipfsPayloadRaw
            const senderAddress = ipfsPayload?.senderAddr?.toLowerCase?.() || msgSender
            const isIncoming = senderAddress !== myAddress
            let decryptionKey = null
            const messageTopic = entry.topic || friend.topic
            if (messageTopic) {
              const perTopicSeed = ethers.keccak256(ethers.concat([messageTopic, ethers.toUtf8Bytes('content-encryption')]))
              decryptionKey = await subtle.importKey('raw', ethers.getBytes(perTopicSeed), 'AES-GCM', true, ['decrypt'])
            }
            if (isIncoming) {
              const wrappedKeyBlob = decodeEncryptedKeyBlob(msgEncryptedKey)
              if (wrappedKeyBlob) {
                try {
                  const unwrappedRawKey = ecies.decrypt(Buffer.from(keys.privKeyHex.replace(/^0x/, ''), 'hex'), Buffer.from(wrappedKeyBlob))
                  decryptionKey = await subtle.importKey('raw', new Uint8Array(unwrappedRawKey), 'AES-GCM', true, ['decrypt'])
                } catch {
                  /* topic key fallback stays active */
                }
              }
            }
            if (!decryptionKey) return null
            const iv = ethers.getBytes(ipfsPayload.iv)
            const ciphertext = ethers.getBytes(ipfsPayload.ciphertext)
            const decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, decryptionKey, ciphertext)
            const plaintext = new TextDecoder().decode(decryptedBuffer)
            return {
              id: `${entry.topic}-${msgTimestamp}-${senderAddress}-${msgMetadata}`,
              message: plaintext,
              timestamp: new Date(msgTimestamp * 1000).toLocaleString(),
              sender: senderAddress,
              side: senderAddress === myAddress ? 'me' : 'them',
              rawTimestamp: msgTimestamp,
            }
          } catch {
            return null
          }
        })
      )
      return decryptedList.filter((m) => m !== null).sort((a, b) => a.rawTimestamp - b.rawTimestamp)
    } catch (error) {
      console.error('Retrieval processing dropped:', error)
      return []
    }
  }

  const viewChatWith = async (contactAddress, clearPending = false) => {
    if (!contactAddress) return
    if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
    setReceiverAddress(contactAddress)
    activeReceiverRef.current = contactAddress

    const performSync = async (opts = {}) => {
      try {
        const freshMessages = await readHistoryChat(contactAddress)
        if (contactAddress !== activeReceiverRef.current) return
        setChatHistory((prev) => {
          if (prev.list.length === freshMessages.length) return { ...prev, isLoading: false }
          return { list: freshMessages, isLoading: false }
        })
        // Clear the optimistic bubble only once the confirmed message is in history
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

  // --- Helper to manage message state ---
  const updateMessageStatus = (id, status, error = null) => {
    setPendingMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, status, error } : msg)))
  }

  async function sendEncryptedMessage(e) {
    e.preventDefault()
    const trimmed = messageText.trim()
    if (!trimmed || !receiverAddress) return

    const pendingId = `pending-${Date.now()}-${Math.random()}`
    const optimisticMsg = {
      id: pendingId,
      message: trimmed,
      timestamp: new Date().toLocaleString(),
      sender: address?.toLowerCase(),
      side: 'me',
      status: 'sending', // Track lifecycle
    }

    setMessageText('')
    setPendingMessages((prev) => [...prev, optimisticMsg])

    try {
      // 1. Setup & Keys
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault is locked.')

      const friend = contacts.find((c) => c.contactAddress.toLowerCase() === receiverAddress.toLowerCase())
      if (!friend) throw new Error('Contact not found.')

      const latestPeerKey = await getRegisteredChatPublicKey(friend.contactAddress)
      if (!latestPeerKey) throw new Error('Receiver public key not registered.')

      // 2. Encryption
      const latestRoom = deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey)
      const subtle = window.crypto.subtle
      const derivedKeySeed = ethers.keccak256(ethers.concat([latestRoom.topic, ethers.toUtf8Bytes('content-encryption')]))

      const contentKey = await subtle.importKey('raw', ethers.getBytes(derivedKeySeed), 'AES-GCM', true, ['encrypt'])
      const iv = window.crypto.getRandomValues(new Uint8Array(12))

      const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, new TextEncoder().encode(trimmed))

      // 3. Upload
      const encryptedPayload = {
        version: '1',
        iv: ethers.hexlify(iv),
        ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
        senderAddr: address,
      }

      const ipfsResult = await uploadObjectToIPFS(JSON.stringify(encryptedPayload))
      if (!ipfsResult?.cid) throw new Error('IPFS upload failed.')

      // 4. Transaction
      const uncompressedRawKey = latestPeerKey.startsWith('0x') ? latestPeerKey : `0x${latestPeerKey}`
      const receiverWrappedKey = ecies.encrypt(uncompressedRawKey, Buffer.from(ethers.getBytes(derivedKeySeed)))

      const success = await sendShroudedMessage(
        latestRoom.stealthAddress,
        latestRoom.topic,
        normalizeCID(ipfsResult.cid),
        receiverWrappedKey
      )

      if (success) {
        // Success: Remove pending bubble and refresh chat
        //setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId))
        setPendingMessages([])
        mutate(['chat-history', receiverAddress])
        await viewChatWith(receiverAddress)
      } else {
        throw new Error('Transaction submission failed.')
      }
    } catch (error) {
      console.error('Messaging engine error:', error)
      // UI Feedback: Don't destroy the user's hard work; mark it as error
      updateMessageStatus(pendingId, 'error', error.message)

      // Optional: Keep the text in input if you want them to fix/retry
      // setMessageText(trimmed);
    }
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
    try {
      await newChat(contactInput)
      setContactInput('')
      setIsAddingContact(false)
    } catch (error) {
      setContactError(error.message || 'Failed to add contact.')
    }
  }

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
            <button type="submit">Add</button>
          </form>
        )}
        {contactError && <p className={styles['add-contact__error']}>{contactError}</p>}
        <ConversationList activeChat={receiverAddress} onSelect={viewChatWith} contacts={contacts} refreshKey={contactsRefreshKey} />
      </aside>

      <main className={clsx(styles.main)}>
        <div className={clsx(styles.chatHistory)} ref={scrollRef}>
          {chatHistory.list.map((msg) => (
            <div key={msg.id} className={clsx(styles['chat-message'], styles[`chat-message--${msg.side}`])}>
              <div className={styles['chat-message__content']}>{msg.message}</div>
              <div className={styles['chat-message__timestamp']}>
                <small>{msg.timestamp.split(',')[1]?.trim() || msg.timestamp}</small>
              </div>
            </div>
          ))}

          {pendingMessages.map((msg) => (
            <div key={msg.id} className={clsx(styles['chat-message'], styles['chat-message--me'], styles['chat-message--pending'])}>
              <div className={styles['chat-message__content']}>{msg.message}</div>
              <div className={styles['chat-message__timestamp']}>
                <small className={styles['chat-message__sending']}>Sending…</small>
              </div>
            </div>
          ))}

          {chatHistory.list.length === 0 && !pendingMessage && (
            <div className={styles['chat-history__empty']}>Start chatting securely!</div>
          )}
        </div>

        <footer className={clsx(styles.footer, 'mt-20')}>
          <form onSubmit={sendEncryptedMessage}>
            <div className="flex align-items-center justify-content-between gap-1">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a message…"
              />
              <button type="submit">{isSending ? <ContentSpinner /> : <ArrowUp width={18} height={18} />}</button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  )
}
