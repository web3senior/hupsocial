'use client'

import { useEffect, useState, useRef } from 'react'
import CryptoJS from 'crypto-js'
import { CID } from 'multiformats/cid'
import { ethers } from 'ethers'
import ecies from 'eciesjs'
import { useConnection, useSignMessage } from 'wagmi'
import { getIPFS } from '@/lib/ipfs'
import clsx from 'clsx'
import { ArrowUp, EllipsisVertical, MessageSquarePlus } from 'lucide-react'
import { useClientMounted } from '@/hooks/useClientMount'
import { bytesToHex } from 'viem'
import { ContentSpinner } from '@/components/Loading'
import { localStorageBurnerKey, sessionStorageUnlockedKey } from '@/lib/burnerSession'
import { ConversationList } from './ConversationList'
import styles from './Chat.module.scss'

function normalizeCID(cidValue) {
  if (!cidValue || typeof cidValue !== 'string') return ''
  return cidValue
    .trim()
    .replace(/^ipfs:\/\//i, '')
    .replace(/^\/ipfs\//i, '')
}

function resolveCIDDigestHash(cidValue, messageText) {
  const normalized = normalizeCID(cidValue)
  if (!normalized) {
    return ethers.keccak256(ethers.toUtf8Bytes(messageText || ''))
  }

  try {
    if (normalized.startsWith('0x') && normalized.length === 66) {
      return normalized
    }

    if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
      return `0x${normalized}`
    }

    const parsed = CID.parse(normalized)
    return ethers.hexlify(parsed.multihash.digest)
  } catch {
    // Fallback for CIDv0/base58 values without multibase parser support.
    try {
      const decoded = ethers.decodeBase58(normalized)
      const hexBytes = ethers.hexlify(decoded)
      if (hexBytes.startsWith('0x1220') && hexBytes.length >= 70) {
        return `0x${hexBytes.slice(6)}`
      }
    } catch {
      // Intentionally ignored; we fall back to deterministic hash below.
    }

    return ethers.keccak256(ethers.toUtf8Bytes(normalized))
  }
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
  const [messageText, setMessageText] = useState('')
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

  const [isLoading, setIsLoading] = useState(false)
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [chatHistory, setChatHistory] = useState({ list: [], isLoading: false })
  const isMounted = useClientMounted()

  const getRegisteredChatPublicKey = async (walletAddress) => {
    if (!walletAddress) return null
    try {
      const res = await fetch(`/api/chat/join?address=${walletAddress.toLowerCase()}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload?.public_key) return null
      const key = String(payload.public_key).trim()
      return key.startsWith('0x') ? key : `0x${key}`
    } catch {
      return null
    }
  }

  const deriveRoomFromPeerKey = (myPrivateKeyHex, peerPublicKey) => {
    // 1. Ensure Private Key is a clean, properly prefixed 0x hex string
    let cleanPriv = myPrivateKeyHex.trim()
    if (!cleanPriv.startsWith('0x')) {
      cleanPriv = `0x${cleanPriv}`
    }

    // 2. Ensure Public Key is a clean, properly prefixed 0x hex string
    let cleanPub = peerPublicKey.trim()
    if (!cleanPub.startsWith('0x')) {
      cleanPub = `0x${cleanPub}`
    }
    console.log(cleanPriv)
    // 3. Initialize the key directly using the hex string format (avoiding broken Buffers)
    const signingKey = new ethers.SigningKey(cleanPriv)

    // 4. Compute the Shared Secret (Diffie-Hellman: Alice_priv * Bob_pub === Bob_priv * Alice_pub)
    const sharedSecret = signingKey.computeSharedSecret(cleanPub)

    // 5. Generate matching room topics and meeting points
    const topic = ethers.keccak256(sharedSecret)
    const stealthAddress = ethers.getAddress(ethers.dataSlice(ethers.keccak256(sharedSecret), 12))

    return { topic, stealthAddress }
  }

  const getUnlockedKey = async () => {
    const encryptedKey = localStorage.getItem('encryptedAppKey')
    const storedPassCipher = sessionStorage.getItem('localPassword')

    if (!encryptedKey || !storedPassCipher) return null

    try {
      // 1. Decrypt the password using the master application key
      const bytesPass = CryptoJS.AES.decrypt(storedPassCipher, process.env.NEXT_PUBLIC_ENCRYPTION_KEY)
      const originalPassword = bytesPass.toString(CryptoJS.enc.Utf8)

      // 2. Decrypt the Private Key using the user's password
      const bytesKey = CryptoJS.AES.decrypt(encryptedKey, originalPassword)
      const decryptedKeyHex = bytesKey.toString(CryptoJS.enc.Utf8)

      // 3. Clean the private key hex string to ensure safe parsing (strip '0x' if present)
      const cleanPrivateKey = decryptedKeyHex.startsWith('0x') ? decryptedKeyHex.slice(2) : decryptedKeyHex

      // 4. Re-instantiate the ECIES object exactly like the original app
      const privKey = new ecies.PrivateKey(Buffer.from(cleanPrivateKey, 'hex'))

      // 5. Extract the 132-character uncompressed key format (65 bytes -> 130 chars + '04' prefix)
      const pubKeyHex = privKey.publicKey.toHex(false)

      // 6. Enforce '0x' prefix uniformity for perfect cross-platform compatibility
      const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`

      // Returns the clean, three-item payload matching your application layout
      return {
        pubKey: formattedPubKey, // 132-character string with '0x04' prefix
        privKey: privKey, // ECIES instance needed for cryptographic actions
        privKeyHex: cleanPrivateKey, // Pure 64-character raw hex string for standard Ethers utils
      }
    } catch (error) {
      console.error('Decryption of stored key failed:', error)
      return null
    }
  }
  // Load verified contacts from MySQL Room Registry
  const loadMyContacts = async () => {
    try {
      const keys = await getUnlockedKey()
      if (!keys) return

      const myPrivateKeyHex = keys.privKeyHex
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const signature = await signMessageAsync({ message: `Fetch My Contacts Log: ${timestamp}` })

      const res = await fetch(`/api/chat/contacts?signature=${signature}&timestamp=${timestamp}`)
      const data = await res.json()

      if (data.success) {
        const decrypted = data.contacts
          .map((item) => {
            try {
              const bytes = CryptoJS.AES.decrypt(item.encrypted_data, myPrivateKeyHex)
              const payload = JSON.parse(bytes.toString(CryptoJS.enc.Utf8))
              return {
                stealthAddress: item.stealth_address,
                topic: item.topic,
                contactAddress: payload.contactAddress,
                publicKey: payload.publicKey,
              }
            } catch (e) {
              return null
            }
          })
          .filter(Boolean)
        setContacts(decrypted)
      }
    } catch (err) {
      console.error('Failed loading contacts:', err)
    }
  }

  const uploadObjectToIPFS = async (json) => {
    // setIsUploading(true)

    try {
      const uploadRequest = await fetch('/api/ipfs/object', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
      // setIsUploading(false)
    }
  }

  const readHistoryChat = async (contactAddress) => {
    const keys = await getUnlockedKey()
    if (!keys) return []

    const subtle = window.crypto.subtle
    const myAddress = address.toLowerCase()

    try {
      const friend = contacts.find((c) => c.contactAddress.toLowerCase() === contactAddress.toLowerCase())
      if (!friend) return []

      const latestPeerKey = await getRegisteredChatPublicKey(contactAddress)
      const derivedRoom = latestPeerKey ? deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey) : null
      const candidateTopics = Array.from(new Set([friend.topic, derivedRoom?.topic].filter(Boolean)))
      if (candidateTopics.length === 0) return []

      // Fetch message histories for known/stale + latest derived room IDs and merge.
      const historyResponses = await Promise.all(
        candidateTopics.map(async (topic) => {
          const response = await fetch(`/api/chat/history?topic=${topic}`)
          const historyData = await response.json().catch(() => ({}))
          return historyData?.success ? historyData.messages || [] : []
        }),
      )
      const flatMessages = historyResponses.flat()
      const seenIds = new Set()
      const mergedMessages = flatMessages.filter((msg) => {
        if (seenIds.has(msg.id)) return false
        seenIds.add(msg.id)
        return true
      })

      const decryptedList = await Promise.all(
        mergedMessages.map(async (msg) => {
          try {
            let ipfsPayload
            // Support both direct database cached JSON string fields and IPFS pointer channels
            if (msg.content) {
              ipfsPayload = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content
            } else if (msg.cid) {
              ipfsPayload = await getIPFS(msg.cid)
            } else {
              return null
            }

            const senderAddress = ipfsPayload.senderAddr?.toLowerCase?.() || ''
            const isIncoming = senderAddress !== myAddress
            let decryptionKey = null

            const messageTopic = typeof msg.topic === 'string' && msg.topic ? msg.topic : friend.topic
            if (messageTopic) {
              const perTopicSeed = ethers.keccak256(ethers.concat([messageTopic, ethers.toUtf8Bytes('content-encryption')]))
              const perTopicKeyRaw = ethers.getBytes(perTopicSeed)
              decryptionKey = await subtle.importKey('raw', perTopicKeyRaw, 'AES-GCM', true, ['decrypt'])
            }

            if (isIncoming) {
              const wrappedKeyBlob = decodeEncryptedKeyBlob(msg.encrypted_key)
              if (wrappedKeyBlob) {
                try {
                  const unwrappedRawKey = ecies.decrypt(Buffer.from(keys.privKeyHex, 'hex'), Buffer.from(wrappedKeyBlob))
                  decryptionKey = await subtle.importKey('raw', new Uint8Array(unwrappedRawKey), 'AES-GCM', true, ['decrypt'])
                } catch {
                  // Deterministic topic key fallback stays active.
                }
              }
            }
            if (!decryptionKey) return null

            const iv = ethers.getBytes(ipfsPayload.iv)
            const ciphertext = ethers.getBytes(ipfsPayload.ciphertext)
            const decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, decryptionKey, ciphertext)
            const plaintext = new TextDecoder().decode(decryptedBuffer)

            const msgTimestamp = msg.created_at ? Math.floor(new Date(msg.created_at).getTime() / 1000) : msg.timestamp

            return {
              id: msg.id || msgTimestamp + ipfsPayload.senderAddr + msg.cid,
              message: plaintext,
              timestamp: new Date(msgTimestamp * 1000).toLocaleString(),
              sender: ipfsPayload.senderAddr,
              side: senderAddress === myAddress ? 'me' : 'them',
              rawTimestamp: msgTimestamp,
            }
          } catch (msgErr) {
            return null
          }
        }),
      )

      return decryptedList.filter((m) => m !== null).sort((a, b) => a.rawTimestamp - b.rawTimestamp)
    } catch (error) {
      console.error('Retrieval processing dropped:', error)
      return []
    }
  }

  // Inside your Chat() component structure...

  const viewChatWith = async (contactAddress) => {
    if (!contactAddress) return

    // Clean up any stale active poll interval references instantly
    if (chatIntervalRef.current) {
      clearInterval(chatIntervalRef.current)
    }

    setReceiverAddress(contactAddress)
    activeReceiverRef.current = contactAddress

    const performSync = async () => {
      try {
        // Direct database history call: Requires NO wallet signatures
        const freshMessages = await readHistoryChat(contactAddress)

        if (contactAddress !== activeReceiverRef.current) return

        setChatHistory((prev) => {
          if (prev.list.length === freshMessages.length) return { ...prev, isLoading: false }
          return {
            list: freshMessages,
            isLoading: false,
          }
        })
      } catch (err) {
        console.error('Background message sync failure:', err)
        setChatHistory((prev) => ({ ...prev, isLoading: false }))
      }
    }

    // Set loading layout only if opening this chat context for the first time
    setChatHistory((prev) => ({ ...prev, isLoading: prev.list.length === 0 }))
    await performSync()

    // Safe polling background loop running silently off-chain
    chatIntervalRef.current = setInterval(performSync, 5000)
  }

  async function sendEncryptedMessage(e) {
    e.preventDefault()
    if (!messageText.trim() || !receiverAddress) return

    try {
      setIsLoading(true)
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')

      let friend = contacts.find((c) => c.contactAddress.toLowerCase() === receiverAddress.toLowerCase())
      if (!friend) throw new Error('Contact room entry missing.')

      const latestPeerKey = await getRegisteredChatPublicKey(friend.contactAddress)
      if (!latestPeerKey) throw new Error('Receiver has no registered chat public key.')
      const latestRoom = deriveRoomFromPeerKey(keys.privKeyHex, latestPeerKey)
      const activeTopic = latestRoom.topic
      const activeStealthAddress = latestRoom.stealthAddress

      const subtle = window.crypto.subtle
      const derivedKeySeed = ethers.keccak256(ethers.concat([activeTopic, ethers.toUtf8Bytes('content-encryption')]))

      const contentKeyRawBytes = ethers.getBytes(derivedKeySeed)
      const contentKey = await subtle.importKey('raw', contentKeyRawBytes, 'AES-GCM', true, ['encrypt'])

      const iv = window.crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, new TextEncoder().encode(messageText))

      const encryptedTextPayload = {
        version: '1',
        iv: ethers.hexlify(iv),
        ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
        senderAddr: address,
      }

      const ipfsResult = await uploadObjectToIPFS(JSON.stringify(encryptedTextPayload))

      const normalizedCID = normalizeCID(ipfsResult?.cid)
      const cidHash = resolveCIDDigestHash(normalizedCID, messageText)

      const uncompressedRawKey = latestPeerKey.startsWith('0x') ? latestPeerKey : `0x${latestPeerKey}`
      const receiverWrappedKey = ecies.encrypt(uncompressedRawKey, Buffer.from(contentKeyRawBytes))

      const success = await sendShroudedMessage(
        activeStealthAddress,
        activeTopic,
        cidHash,
        normalizedCID || 'inline_cache',
        receiverWrappedKey,
        encryptedTextPayload,
      )

      if (success) {
        setMessageText('')
        await viewChatWith(receiverAddress)
      }
    } catch (error) {
      console.error('Messaging engine crashed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const sendShroudedMessage = async (meetingPoint, topic, cidHash, fullCID, receiverWrappedKey, contentPayload) => {
    const unlockedKey = sessionStorage.getItem(sessionStorageUnlockedKey)
    const storedBurnerKey = localStorage.getItem(localStorageBurnerKey)
    const burnerKey = normalizePrivateKey(unlockedKey) || normalizePrivateKey(storedBurnerKey)
    const wrappedKeyHex = typeof receiverWrappedKey === 'string' ? receiverWrappedKey : bytesToHex(receiverWrappedKey)
    const textToSign = JSON.stringify({
      stealth_address: meetingPoint.toLowerCase(),
      content: JSON.stringify(contentPayload),
    })
    let signature = null
    if (burnerKey) {
      const burner = new ethers.Wallet(burnerKey)
      signature = await burner.signMessage(textToSign)
    } else {
      if (!isConnected || !address) {
        throw new Error('Connect your wallet to sign this message.')
      }
      signature = await signMessageAsync({ message: textToSign })
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encrypted_key: wrappedKeyHex,
        topic,
        stealth_address: meetingPoint,
        content: contentPayload,
        cid: fullCID,
        cid_hash: cidHash,
        signature,
      }),
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok || payload.result !== true) {
      throw new Error(payload.error || 'Message relay failed.')
    }
    return true
  }

  const newChat = async (inputAddress) => {
    const contactAddress = inputAddress?.trim()
    if (!contactAddress || !/^0x[a-fA-F0-9]{40}$/.test(contactAddress)) {
      throw new Error('Please enter a valid wallet address.')
    }

    try {
      const normalizedAddress = contactAddress.toLowerCase()
      const keys = await getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')

      if (address && normalizedAddress === address.toLowerCase()) {
        throw new Error('You cannot add your own wallet as a contact.')
      }

      const alreadyExists = contacts.some((item) => item.contactAddress.toLowerCase() === normalizedAddress)
      if (alreadyExists) {
        throw new Error('This contact is already in your list.')
      }

      const peerPublicKey = await getRegisteredChatPublicKey(contactAddress)
      if (!peerPublicKey) throw new Error("This profile hasn't registered cryptographic chat keys yet.")

      const myPriv = keys.privKeyHex

      // 1. Calculate standard room variables
      const { stealthAddress, topic } = deriveRoomFromPeerKey(myPriv, peerPublicKey)

      // 2. 🔐 THE PRIVACY FIX: Create a Blind Lookup Key unique ONLY to this user
      // The server gets a random-looking string and cannot match it to Bob's row
      const blindLookupKey = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [topic, ethers.keccak256(`0x${myPriv}`)]))

      // 3. Move EVERYTHING sensitive inside the encrypted bundle
      const encryptedData = CryptoJS.AES.encrypt(
        JSON.stringify({
          contactAddress: normalizedAddress,
          publicKey: peerPublicKey,
          topic: topic, // Safely hidden inside the vault
          stealthAddress: stealthAddress, // Safely hidden inside the vault
        }),
        myPriv,
      ).toString()

      // 4. Sign the authorization payload using the blind lookup key
      const signature = await signMessageAsync({
        message: `Sync Contact Room Hash: ${blindLookupKey}`,
      })

      // 5. Send to your Web2 backend route
      const saveContactRes = await fetch('/api/chat/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          blind_lookup_key: blindLookupKey, // Replaces stealth_address
          encrypted_data: encryptedData,
        }),
      })

      const saveContactPayload = await saveContactRes.json().catch(() => ({}))
      if (!saveContactRes.ok || !saveContactPayload.success) {
        throw new Error(saveContactPayload.error || 'Failed to add contact.')
      }

      await loadMyContacts()
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chatHistory.list])

  useEffect(() => {
    if (!isConnected || !isMounted || contactsInitializedRef.current) return
    contactsInitializedRef.current = true
    setTimeout(() => {
      void loadMyContacts()
    }, 0)

    return () => {
      if (chatIntervalRef.current) clearInterval(chatIntervalRef.current)
    }
  }, [isConnected, isMounted])

  useEffect(() => {
    if (!isConnected) {
      contactsInitializedRef.current = false
    }
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
          {chatHistory.list.length === 0 && <div className={styles['chat-history__empty']}>Start chatting securely!</div>}
        </div>
        <footer className={clsx(styles.footer, 'mt-20')}>
          <form onSubmit={sendEncryptedMessage}>
            <div className="flex align-items-center justify-content-between gap-1">
              <textarea
                value={messageText}
                disabled={isLoading}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Write an encrypted message..."
              />
              {isLoading && <ContentSpinner />}
              <button type="submit" disabled={!receiverAddress || !messageText || isLoading}>
                <ArrowUp width={18} height={18} />
              </button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  )
}
