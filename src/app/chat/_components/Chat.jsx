'use client'

import { useEffect, useState, useRef } from 'react'
import { getProfile, getUniversalProfile } from '@/lib/api'
//import { getActiveChain } from '@/lib/communication'
// , getPaginatedContactList, getPaginatedConversationHistory, getConversationList, getUserSessions, initChatContract
//import { getPublicKeyRegistry } from '@/lib/communication'
const getPublicKeyRegistry = ()=>false
import CryptoJS from 'crypto-js'
//import * as crypto from 'ethers/crypto'
// // OR depending on your setup:
// import { Wallet } from 'ethers';
// import { computePublicKey } from 'ethers/utils';
import { CID } from 'multiformats/cid'
import { ethers, Wallet, SigningKey, toNumber } from 'ethers'
import Web3 from 'web3'
import ecies, { PrivateKey, decrypt, encrypt } from 'eciesjs'
import abiChat from '@/abis/chat.json'
const abiForwarder =[]

import { useConnection, useWaitForTransactionReceipt, usePublicClient, useWalletClient, useWriteContract, useReadContract } from 'wagmi'
import { useRouter } from 'next/navigation'
import { getIPFS } from '@/lib/ipfs'
import clsx from 'clsx'
import { ConnectWallet } from '@/components/ConnectWallet'
import { ArrowUp, Box, Check, EllipsisVertical, MessageCircle, MessageSquareMore, MessageSquarePlus, MessageSquareText, Radio, Send, Settings, Users } from 'lucide-react'
import Shimmer from '@/components/ui/Shimmer'
import { getAddress } from 'viem'
// import { db } from '@/lib/db'
import { useClientMounted } from '@/hooks/useClientMount'
import styles from './Chat.module.scss'
import { encodeFunctionData, bytesToHex } from 'viem'
import { ContentSpinner } from '@/components/Loading'
const moment = require('moment')
moment.defineLocale('en-short', {
  relativeTime: {
    future: 'in %s',
    past: '%s', //'%s ago'
    s: '1s',
    ss: '%ds',
    m: '1m',
    mm: '%dm',
    h: '1h',
    hh: '%dh',
    d: '1d',
    dd: '%dd',
    M: '1mo',
    MM: '%dmo',
    y: '1y',
    yy: '%dy',
  },
})

export default function Chat() {
  const [balance, setBalance] = useState()
  const [activeFilter, setActiveFilter] = useState(`All`)
  const [messageText, setMessageText] = useState('')
  const [receiverAddress, setReceiverAddress] = useState('')
  const activeReceiverRef = useRef(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const { address, isConnected } = useConnection()
  const [chatHistory, setChatHistory] = useState({ list: [] })
  const [isRelaying, setIsRelaying] = useState(false)
  const activeChain = getActiveChain()
  const router = useRouter()
  const { web3, contract } = initChatContract()
  const isMounted = useClientMounted()

  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError /* Error after mining (e.g., transaction reverted) */,
  } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: !!hash, // Only run the query once we have a transaction hash
      onSuccess: () => {
        console.log(`success`)
      },
      onError: () => {
        console.log(`error`)
      },
    },
  })

  const publicClient = usePublicClient() // Like ethers Provider
  const walletClient = useWalletClient() // Like ethers Signer

  /**
   * @dev Generates an ECIES key pair and formats the public key for the Solidity contract.
   * @returns {{privateKeyHex: string, publicKeyHex: string}} An object containing the
   * private key (raw secret hex) and the public key (uncompressed hex, including '0x').
   */
  function generateEciesKeyPairForContract() {
    // 1. Generate a new ECIES PrivateKey instance
    const sk = new PrivateKey()

    // 2. Extract the private key secret (32 bytes) as a hex string
    const privateKeyHex = sk.secret.toString('hex')

    // 3. Extract the public key in uncompressed format (65 bytes: 0x04 || X || Y)
    // The .toBytes() method returns the 65-byte uncompressed public key buffer.
    const publicKeyBytes = sk.publicKey.toBytes()

    // 4. Convert the public key buffer to a hex string prefixed with '0x'
    // This format matches the `bytes` type expected by the Solidity `publicKeyRegistry`.
    const publicKeyHex = '0x' + Buffer.from(publicKeyBytes).toString('hex')

    return {
      privateKeyHex: '0x' + privateKeyHex, // Typically stored locally by the user
      publicKeyHex: publicKeyHex, // Registered on the Solidity contract
    }
  }

  // --- ECIES Encryption and Decryption Test (Your provided code) ---

  /**
   * @dev Performs a self-test of the encryption/decryption process.
   * * @param {PrivateKey} sk - The ECIES private key instance to use.
   */
  function runEciesTest(sk) {
    const originalMessage = 'hello world🌍'
    const data = Buffer.from(originalMessage)

    console.log(`\n--- ECIES Self-Test: Encrypting "${originalMessage}" ---`)

    // Encryption: Encrypts the data using the recipient's public key (sk.publicKey.toBytes() in this test)
    const encrypted = encrypt(sk.publicKey.toBytes(), data)
    console.log(`Encrypted Ciphertext (Buffer length): ${encrypted.length}`)

    // Decryption: Uses the recipient's private key (sk.secret) to unlock the data.
    const decrypted = decrypt(sk.secret, encrypted)
    const recoveredMessage = Buffer.from(decrypted).toString()

    console.log('Decrypted Message:', recoveredMessage)
    if (recoveredMessage === originalMessage) {
      console.log('✅ ECIES test successful: Decrypted message matches original.')
    } else {
      console.error('❌ ECIES test failed: Message mismatch.')
    }
  }

  const handleCreatePost = async (e) => {
    // (chatContract, senderAddress, receiverAddress, plaintext)
    e.preventDefault()

    const formData = new FormData(e.target)
    const metadata = ''

    if (!formData.get(`content`).trim()) {
      console.warn('Message is empty.')
      return
    }

    try {
      console.log('1. Starting encryption and IPFS upload...')
      //const cidHash = await mockUploadToIpfs(encryptedData)

      /*
address _receiver,
bytes32 _cidHash,
bytes memory _senderEncryptedKey,
bytes memory _receiverEncryptedKey
*/

      writeContract({
        abi: abiChat,
        address: activeChain[1].chat,
        functionName: 'sendMessage',
        args: ['0x2B47dE780AC1bfFa8b121EE9C21026559499bA36', '0x0', ''],
      })

      // writeContract({
      //       abi: abiChat,
      //       address: activeChain[1].chat,
      //       functionName: 'registerPublicKey',
      //       args: [keyPair.publicKeyHex],
      //     })
    } catch (error) {
      console.error('❌ Failed to send private message:', error.message || error)
      // You might want to handle cleaning up IPFS data here if the transaction failed,
      // though IPFS data garbage collection (GC) usually handles unpinned content.
      throw error
    }
  }

  const createAccount = async () => {
    if (localStorage.getItem('encryptedWallet')) {
      console.log('An ECIES private key already exists in local storage. Please disconnect first.')
      return
    }

    const keyPair = generateEciesKeyPairForContract()
    console.log('--- Generated ECIES Key Pair for Chaingram ---')
    console.log('Private Key (for local decryption):', keyPair.privateKeyHex)
    console.log('Public Key (for contract registration):', keyPair.publicKeyHex)

    localStorage.setItem('encryptedWallet', keyPair.privateKeyHex)

    // // FIX: Convert the hex private key back to a Buffer before passing it to the PrivateKey constructor.
    // const privateKeyCleanHex = keyPair.privateKeyHex.replace('0x', '')
    // const privateKeyBuffer = Buffer.from(privateKeyCleanHex, 'hex')

    // // Instantiate the PrivateKey object using the correct Buffer format
    // const skTest = new PrivateKey(privateKeyBuffer)
    // runEciesTest(skTest)
  }

  const discounnectAccount = async () => {
    localStorage.removeItem('encryptedWallet')
    console.log('Private key removed from local storage.')
  }

  const getPublicKey = () => {
    const privateKeyHex = localStorage.getItem('encryptedWallet')
    if (!privateKeyHex) {
      console.error('No private key found in local storage. Please create or import an account first.')
      return
    }

    const privateKeyCleanHex = privateKeyHex.replace('0x', '')
    const privateKeyBuffer = Buffer.from(privateKeyCleanHex, 'hex')
    const sk = new PrivateKey(privateKeyBuffer)

    const publicKeyBytes = sk.publicKey.toBytes()

    // 4. Convert the public key buffer to a hex string prefixed with '0x'
    // This format matches the `bytes` type expected by the Solidity `publicKeyRegistry`.
    const publicKeyHex = '0x' + Buffer.from(publicKeyBytes).toString('hex')

    console.log(publicKeyHex)
  }

  //web3===========================================================

  async function runEciesTestWithWallet() {
    const wallet = await retrieveAndDecryptWallet()

    // Check if decryption failed
    if (!wallet) {
      console.error('Wallet decryption failed. Aborting ECIES test.')
      return
    }

    console.log(`Wallet Address: ${wallet.address}`)

    const originalMessage = 'hello world🌍'
    const data = Buffer.from(originalMessage, 'utf8')

    console.log(`\n--- Message to encrypt: "${originalMessage}" ---`)

    // --- 1. Get the Recipient's Public Key (for Encryption) ---
    // FIX: Using the instantiated 'web3' object as requested

    // Get the 65-byte uncompressed public key (0x04 + X + Y) as a hex string
    const recipientPublicKeyHex = wallet.signingKey.publicKey
    // Convert the hex string to a Buffer/Uint8Array, REMOVING the '0x' prefix
    // The ECIES library expects the raw byte data.
    const recipientPublicKey = Buffer.from(recipientPublicKeyHex.slice(2), 'hex')

    // --- 2. Encryption ---
    const encrypted = encrypt(recipientPublicKey, data)
    console.log(`Encrypted Ciphertext (Buffer length): ${encrypted.length}`)

    // --- 3. Decryption ---
    const decrypted = decrypt(wallet.privateKey, encrypted)

    const recoveredMessage = Buffer.from(decrypted).toString('utf8')

    console.log('Decrypted Message:', recoveredMessage)
    if (recoveredMessage === originalMessage) {
      console.log('✅ ECIES test successful: Decrypted message matches original.')
    } else {
      console.error('❌ ECIES test failed: Message mismatch.')
      console.error('Expected:', originalMessage, 'Received:', recoveredMessage)
    }
  }

  const createAccountWeb3 = async () => {
    // --- 1. Generate Wallet using Ethers for Mnemonic Support ---
    // Ethers Wallet.createRandom() generates a private key AND a mnemonic phrase
    const newWallet = Wallet.createRandom()

    const privateKey = newWallet.privateKey // 0x... (32 bytes)
    const address = newWallet.address // 0x... (Ethereum Address)
    const mnemonicPhrase = newWallet.mnemonic.phrase // The 12/21 word seed phrase

    // --- 2. Use web3 for related utilities (e.g., public key derivation) ---
    const web3 = new Web3() // or new Web3(provider);

    // The public key can be derived from the private key
    const publicKey = web3.eth.accounts.privateKeyToPublicKey(privateKey)

    // --- 3. Log ALL generated keys/phrases to the console ---
    console.table({
      address: address,
      privateKey: privateKey,
      publicKey: publicKey,
      // **SECURITY NOTE: NEVER LOG SEED PHRASES IN A REAL APPLICATION.**
      // **This is for educational/development purposes only.**
      seedPhrase: mnemonicPhrase,
    })

    // --- 4. Existing Keystore Encryption/Storage Logic ---

    if (localStorage.getItem('encryptedWallet')) {
      console.log('A private key already exists in local storage. Please disconnect first.')
      return
    }

    // Should be collected securely from user
    const password = '102030'

    try {
      // The Ethers Wallet instance is already available as newWallet

      // Encrypt the wallet using the password
      const encryptedJson = await newWallet.encrypt(password)

      // Store the encrypted JSON in localStorage
      localStorage.setItem('encryptedWallet', encryptedJson)

      console.log('Wallet successfully encrypted and stored.')
      // console.log('Encrypted JSON:', encryptedJson); // Uncomment if you want to see the Keystore JSON
    } catch (error) {
      console.error('Encryption failed:', error)
    }
  }

  async function retrieveAndDecryptWallet() {
    // Retrieve the encrypted JSON from localStorage
    const encryptedJson = localStorage.getItem('encryptedWallet')

    if (!encryptedJson) {
      console.log('No encrypted wallet found in localStorage.')
      return null
    }

    // Retrieve the encrypted password from localStorage and decrypt it
    const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY
    const cipherText = sessionStorage.getItem('localPassword')
    const bytes = CryptoJS.AES.decrypt(cipherText, secretKey)
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8)
    const password = decryptedText

    console.log(password)
    return
    try {
      // Decrypt the JSON string using the password
      const wallet = await Wallet.fromEncryptedJson(encryptedJson, password)

      // The wallet object now contains the decrypted private key
      const decryptedPrivateKey = wallet.privateKey

      // The Wallet object automatically provides the address.
      const address = wallet.address

      // The 12/21 word seed phrase
      const decryptedMnemonicPhrase = wallet.mnemonic.phrase

      // Use a utility function to derive the uncompressed public key from the private key
      // This is the 65-byte uncompressed key (0x04 + X + Y)
      const publicKey = web3.eth.accounts.privateKeyToPublicKey(decryptedPrivateKey)

      // console.log('---------------------------------------')
      // console.log('🔑 Decrypted Private Key:', decryptedPrivateKey.substring(0, 10) + '...')
      // console.log('👤 Ethereum Address:', address.substring(0, 10) + '...')
      // console.log('🌐 Derived Public Key:', publicKey.substring(0, 10) + '...')
      // console.log('🔑 Decrypted Mnemonic Phrase:', decryptedMnemonicPhrase)
      // console.log('---------------------------------------')

      // Optional: Return the fully functional Wallet object for transaction signing
      return wallet
    } catch (error) {
      console.error('Decryption failed. Incorrect password or corrupted JSON.', error)
      return null
    }
  }

  // Assuming you have an initialized contract instance from ethers
  // Example: const contract = new ethers.Contract(activeChain[1].chat, ABI, wallet);
  // We will call the function directly on the wallet-connected contract.

  // ■■■ Logic Control ■■■==================================================

  // Get the app key for encryption/ decryption
  const getUnlockedKey = () => {
    const encryptedKey = localStorage.getItem('encryptedAppKey')
    const storedPassCipher = sessionStorage.getItem('localPassword')

    if (!encryptedKey || !storedPassCipher) return null

    try {
      // 1. Decrypt the password
      const bytesPass = CryptoJS.AES.decrypt(storedPassCipher, process.env.NEXT_PUBLIC_ENCRYPTION_KEY)
      const originalPassword = bytesPass.toString(CryptoJS.enc.Utf8)

      // 2. Decrypt the Private Key
      const bytesKey = CryptoJS.AES.decrypt(encryptedKey, originalPassword)
      const decryptedKeyHex = bytesKey.toString(CryptoJS.enc.Utf8)

      // 3. Re-instantiate the ECIES object
      const privKey = new ecies.PrivateKey(Buffer.from(decryptedKeyHex, 'hex'))

      // To get the 132-character (uncompressed) key:
      // .toHex(false) returns the uncompressed version (65 bytes -> 130 chars + '04' prefix)
      const pubKeyHex = privKey.publicKey.toHex(false)

      // To match ethers exactly with the '0x' prefix:
      const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`

      //      console.log('publicKey:', formattedPubKey, formattedPubKey.length) // 132

      return {
        pubKey: formattedPubKey, // This will now be 130-132 chars long
        privKey: privKey,
      }
    } catch (error) {
      console.error('Decryption of stored key failed', error)
      return null
    }
  }

  const getPrivateWallet = async () => {
    // Generate a private key AND a mnemonic phrase
    // const newWallet = Wallet.createRandom()
    const newWallet = {
      address: '0x0644ab0716c3b1267bE40168982540d8355aBc32',
      publicKey: '0x0301df2deb816270b85b3d8fb0f6fe0149d7e354c6b2774a4880ad7c052cc0b412',
      mnemonic: {
        phrase: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
      },
      privateKey: ``,
    }
    console.log(newWallet)
    const privateKey = newWallet.privateKey // 0x... (32 bytes)
    const address = newWallet.address // 0x... (Ethereum Address)
    const mnemonicPhrase = newWallet.mnemonic.phrase // The 12/21 word seed phrase

    // The public key can be derived from the private key
    const publicKey = web3.eth.accounts.privateKeyToPublicKey(privateKey)

    const balance = web3.utils.fromWei(await web3.eth.getBalance(address), 'ether')

    return {
      address: address,
      privateKey: privateKey,
      publicKey: publicKey,
      seedPhrase: mnemonicPhrase,
      balance: balance,
    }
  }

  const walletBalance = async (address) => {
    if (!address) {
      console.error('Wallet not found.')
      return
    }
    const balance = await web3.eth.getBalance(address)
    setBalance(web3.utils.fromWei(balance, 'ether'))
    console.log(`Wallet Balance: ${web3.utils.fromWei(balance, 'ether')} ETH`)
  }

  // -------------------------------------------------------------
  /**
   * Converts a hex string (with or without '0x') to a Uint8Array.
   */
  function hexToUint8Array(hexString) {
    if (hexString.startsWith(HEX_PREFIX)) {
      hexString = hexString.slice(2)
    }
    return new Uint8Array(hexString.match(/[\da-f]{2}/gi).map((h) => parseInt(h, 16)))
  }

  // --- UTILITY FUNCTIONS (KEPT FOR OTHER CONVERSIONS) ---
  const HEX_PREFIX = '0x'

  /**
   * Converts an ArrayBuffer to a hex string (with '0x').
   */
  function arrayBufferToHex(buffer) {
    return (
      HEX_PREFIX +
      Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    )
  }

  const uploadFileToIPFS = async (file) => {
    setIsUploading(true)

    try {
      if (!file) {
        console.error('No file selected.')
        return
      }

      const data = new FormData()
      data.set('file', file)

      const uploadRequest = await fetch(`/api/ipfs/file`, {
        method: 'POST',
        body: data,
      })
      const signedUrl = await uploadRequest.json()
      setIsUploading(false)
      return signedUrl
    } catch (e) {
      setIsUploading(false)
      console.log(e)
      console.error('Trouble uploading file')
    }
  }

  const uploadObjectToIPFS = async (content) => {
    setIsUploading(true)
    try {
      const uploadRequest = await fetch(`/api/ipfs/object`, {
        method: 'POST',
        // Set the Content-Type header
        headers: {
          'Content-Type': 'application/json',
        },
        // Stringify the JSON object directly (no extra wrapper)
        body: content,
      })

      // Check for non-200 status codes
      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json()
        throw new Error(errorData.error || `HTTP error! Status: ${uploadRequest.status}`)
      }

      const responseData = await uploadRequest.json()
      setIsUploading(false)
      return responseData
    } catch (e) {
      setIsUploading(false)
      console.error('Trouble uploading file/object:', e)
      // Re-throw the error or return null/undefined depending on your error handling preference
      throw e
    }
  }

  // =============================================================
  //               1. SEND MESSAGE (ECIES + AES-GCM)
  // =============================================================
  /**
   * Extracts the raw 32-byte hash digest from the CID and formats it for Solidity bytes32.
   * This is the best practice for secure on-chain storage.
   * @param {string} cidString - The full IPFS CID string (e.g., 'bafy...').
   * @returns {string} The 0x-prefixed 66-character bytes32 hash digest.
   */
  function getRawDigestHash(cidString) {
    if (typeof CID === 'undefined') {
      throw new Error('The "CID" library (multiformats) is required for this method.')
    }

    const cid = CID.parse(cidString)
    const rawDigestBuffer = cid.multihash.digest

    if (rawDigestBuffer.length !== 32) {
      throw new Error(`Hash digest is ${rawDigestBuffer.length} bytes, expected 32 for bytes32.`)
    }

    // Convert the raw bytes to a 0x-prefixed hex string
    return web3.utils.toHex(rawDigestBuffer)
  }
  // ■■■ Logic Control ■■■
  const initializeEthers = async () => {
    if (window.ethereum) {
      // 1. Create the Provider (Injected provider like MetaMask or LUKSO UP)
      const provider = new ethers.BrowserProvider(window.ethereum)

      // 2. Request accounts and get the Signer
      const signer = await provider.getSigner()

      // 3. Initialize the Contract with the Signer
      const chatContract = new ethers.Contract(activeChain[1].chat, abiChat, signer)

      // 4. Initialize the Forwarder Contract (needed for gasless)
      const forwarderContract = new ethers.Contract(activeChain[1].forwarder, abiForwarder, signer)

      return { provider, signer, chatContract, forwarderContract }
    } else {
      throw new Error('No crypto wallet found. Please install MetaMask or a LUKSO Universal Profile.')
    }
  }

  async function sendEncryptedMessage(e) {
    e.preventDefault()
    if (!messageText.trim()) return

    try {
      const keys = getUnlockedKey()
      if (!keys) throw new Error('Vault locked.')

      const { chatContract } = await initializeEthers()
      const SENDER_ADDRESS = address
      // const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      // const SENDER_ADDRESS = accounts[0]

      // 1. Fetch friend data from Local DB (Optimized for Pure Stealth)
      let friend = await db.friends.get({ contactAddress: receiverAddress })

      // Fallback: If for some reason they aren't in DB, perform a quick handshake
      if (!friend) {
        const pubKey = await chatContract.publicKeyRegistry(receiverAddress)
        if (!pubKey || pubKey === '0x') throw new Error("Recipient hasn't registered a key")

        const myPriv = keys.privKey.toHex ? `0x${keys.privKey.toHex()}` : keys.privKey
        const signingKey = new ethers.SigningKey(myPriv)
        const secret = signingKey.computeSharedSecret(pubKey)

        const sAddr = ethers.getAddress(ethers.dataSlice(ethers.keccak256(secret), 12))
        const tId = ethers.keccak256(secret)

        const newFriendId = await db.friends.add({
          contactAddress: receiverAddress,
          publicKey: pubKey,
          stealthAddress: sAddr,
          topic: tId,
          name: receiverAddress,
        })
        friend = await db.friends.get(newFriendId)
      }

      // 2. Encryption Setup (AES-GCM)
      const subtle = window.crypto.subtle
      const derivedKeySeed = ethers.keccak256(
        ethers.concat([
          friend.topic, // Using topic (H(SharedSecret)) as a base for content key
          ethers.toUtf8Bytes('content-encryption'),
        ]),
      )

      const contentKeyRawBytes = ethers.getBytes(derivedKeySeed)
      const contentKey = await subtle.importKey('raw', contentKeyRawBytes, 'AES-GCM', true, ['encrypt'])

      const encodedMessage = new TextEncoder().encode(messageText)
      const iv = window.crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, encodedMessage)

      // 3. Prepare IPFS Payload
      const encryptedTextPayload = {
        version: `1`,
        iv: ethers.hexlify(iv),
        ciphertext: ethers.hexlify(new Uint8Array(ciphertext)),
        senderAddr: SENDER_ADDRESS,
      }
      setIsLoading(true)
      const ipfsResult = await uploadObjectToIPFS(JSON.stringify(encryptedTextPayload))
      const cidHash = getRawDigestHash(ipfsResult.cid)

      // 4. Wrap Key for Bob (Asymmetric backup)
      const receiverWrappedKey = ecies.encrypt(friend.publicKey, Buffer.from(contentKeyRawBytes))

      // 5. Local Optimistic Update
      const timestamp = Math.floor(Date.now() / 1000)
      const localMsgId = await db.messages.add({
        topic: friend.topic,
        sender: SENDER_ADDRESS,
        content: messageText,
        fullCID: ipfsResult.cid,
        timestamp,
        status: 'pending',
      })

      await db.threads.put({
        topic: friend.topic,
        contactAddress: receiverAddress,
        lastMessageAt: timestamp,
      })

      // 6. Relayer Transaction (Always to Stealth Address)
      const success = await sendShroudedMessage(
        friend.stealthAddress, // The Meeting Point
        friend.topic, // The Thread ID
        cidHash,
        ipfsResult.cid,
        receiverWrappedKey,
        SENDER_ADDRESS,
      )

      if (success) {
        await db.messages.update(localMsgId, { status: 'confirmed' })
        setMessageText('')
        setIsLoading(false)
      }
    } catch (error) {
      setIsLoading(false)
      console.error('Messaging Flow failed:', error)
      // toast(error.message, { type: 'error' })
    }
  }

  const sendShroudedMessage = async (meetingPoint, topic, cidHash, fullCID, receiverWrappedKey, SENDER_ADDRESS) => {
    if (!publicClient) {
      throw new Error('Public client not initialized')
    }

    const burnerKey = localStorage.getItem('chat_burner_key')
    if (!burnerKey) {
      throw new Error('Session expired or missing burner key')
    }

    const burner = new ethers.Wallet(burnerKey)

    // 🔑 CRITICAL FIX
    const wrappedKeyHex = typeof receiverWrappedKey === 'string' ? receiverWrappedKey : bytesToHex(receiverWrappedKey)

    const functionData = encodeFunctionData({
      abi: abiChat,
      functionName: 'sendMessage',
      args: [SENDER_ADDRESS, meetingPoint, topic, cidHash, fullCID, wrappedKeyHex],
    })

    const { request, signature } = await signMetaTransactionSessionMode(burner, functionData)

    const res = await fetch('/api/chat/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, signature, rpcUrl: activeChain[0].rpcUrls.default.http[0], forwarderAddress: activeChain[1].forwarder }, (_, v, r) => (typeof v === 'bigint' ? v.toString() : v)),
    })

    return res.ok
  }

  /**
   * Prepares and signs a gasless transaction request
   */
  async function signMetaTransaction(signer, forwarderContract, chatContract, functionData) {
    const from = await signer.getAddress()

    // v5 Forwarders use nonces() mapping internally
    const nonce = await forwarderContract.nonces(from)

    const chainId = activeChain[0].id

    const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour

    const domain = {
      name: 'TunnelForwarder',
      version: '1',
      chainId: chainId,
      verifyingContract: forwarderContract.target,
    }

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

    const message = {
      from: from,
      to: chatContract.target,
      value: 0,
      gas: 1000000,
      nonce: nonce, // ethers v6 handles BigInt automatically
      deadline: deadline,
      data: functionData,
    }

    // Browser wallets (Metamask/UP) will show a readable "TunnelForwarder" popup
    const signature = await signer.signTypedData(domain, types, message)

    return { request: message, signature }
  }

  async function signMetaTransactionSessionMode(signer, functionData) {
    const from = await signer.getAddress()

    // Read nonce via wagmi public client (READ ONLY)
    const nonce = await publicClient.readContract({
      address: activeChain[1].forwarder,
      abi: abiForwarder,
      functionName: 'nonces',
      args: [from],
    })

    const chainId = activeChain[0].id
    const deadline = Math.floor(Date.now() / 1000) + 3600

    const domain = {
      name: 'TunnelForwarder',
      version: '1',
      chainId,
      verifyingContract: activeChain[1].forwarder,
    }

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

    const message = {
      from,
      to: activeChain[1].chat,
      value: 0n,
      gas: 1_000_000n,
      nonce,
      deadline,
      data: functionData,
    }

    // Burner signs typed data locally
    const signature = await signer.signTypedData(domain, types, message)

    return {
      request: message,
      signature,
    }
  }

  const handleGaslessSend = async (cidHash, ipfsResult, senderWrappedKey, receiverWrappedKey, SENDER_ADDRESS) => {
    const { provider, signer, chatContract, forwarderContract } = await initializeEthers()

    if (!signer || !forwarderContract || !chatContract) return

    setIsRelaying(true)
    try {
      // Ensure chatContract is the ethers instance from above
      const functionData = chatContract.interface.encodeFunctionData('sendMessage', [
        receiverAddress,
        cidHash,
        ipfsResult.cid, //"fullCID",
        `0x${senderWrappedKey.toString('hex')}`, //sKey,
        `0x${receiverWrappedKey.toString('hex')}`, //rKey
      ])

      // signMetaTransaction now receives the ethers Signer object
      const { request, signature } = await signMetaTransaction(signer, forwarderContract, chatContract, functionData)

      const res = await fetch('/api/chat/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request, signature }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      })
      if (res.status) {
        console.log(`✅ Success! Hash: ${res.txHash}`)
        toast('Message sent securely!', { type: 'success' })
        return { result: true, data: res.txHash }
      }
      // ... rest of handling
    } catch (err) {
      console.error('Relay Failed:', err.message)
    } finally {
      setIsRelaying(false)
    }
  }

  // Helper to ensure ArrayBuffer or Uint8Array output, added for robustness
  function ensureUint8Array(data) {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      return data
    }
    // Handle Node.js Buffer (common in IPFS libraries)
    if (typeof Buffer !== 'undefined' && data instanceof Buffer) {
      return new Uint8Array(data.buffer, data.byteOffset, data.length)
    }
    if (Array.isArray(data)) {
      return new Uint8Array(data)
    }
    // If data is already a string, it might be the IPFS content itself (less likely in this setup)
    if (typeof data === 'string') {
      return new TextEncoder().encode(data)
    }
    throw new Error(`IPFS result is not a recognized binary type: ${typeof data}`)
  }

  // ■■■ Logic Control ■■■
  const readHistoryChat = async (contactAddress) => {
    const keys = getUnlockedKey()
    if (!keys) throw new Error('Vault locked.')

    const subtle = window.crypto.subtle
    const myAddress = address.toLowerCase()

    try {
      const friend = await db.friends.get({ contactAddress })
      if (!friend) throw new Error('Contact metadata not found.')

      const derivedKeySeed = ethers.keccak256(ethers.concat([friend.topic, ethers.toUtf8Bytes('content-encryption')]))
      const contentKeyRawBytes = ethers.getBytes(derivedKeySeed)
      const contentKey = await subtle.importKey('raw', contentKeyRawBytes, 'AES-GCM', true, ['decrypt'])

      const { messages: onChainMessages } = await getPaginatedConversationHistory(friend.topic, 0, 50)

      const decryptedList = await Promise.all(
        onChainMessages.map(async (msg) => {
          if (msg.isDeleted) return null
          try {
            const ipfsPayload = await getIPFS(msg.fullCID)
            const iv = ethers.getBytes(ipfsPayload.iv)
            const ciphertext = ethers.getBytes(ipfsPayload.ciphertext)

            const decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, contentKey, ciphertext)
            const plaintext = new TextDecoder().decode(decryptedBuffer)

            return {
              id: msg.timestamp + msg.sender + msg.fullCID, // Unique ID
              message: plaintext,
              timestamp: new Date(Number(msg.timestamp) * 1000).toLocaleString(),
              sender: msg.sender,
              side: msg.sender.toLowerCase() === myAddress ? 'me' : 'them',
              rawTimestamp: Number(msg.timestamp),
            }
          } catch (msgErr) {
            return null
          }
        }),
      )

      // Sorting Descending (Newest first) to work with CSS column-reverse
      return decryptedList.filter((m) => m !== null).sort((a, b) => b.rawTimestamp - a.rawTimestamp)
    } catch (error) {
      console.error('IPFS Retrieval failed:', error)
      return []
    }
  }

  // ■■■ Logic Control ■■■
  let chatInterval = null

  const viewChatWith = async (contactAddress) => {
    if (!contactAddress) return

    // 1. Stop any old polling
    if (chatInterval) {
      clearInterval(chatInterval)
      chatInterval = null
    }

    // 2. Update the target receiver immediately
    setReceiverAddress(contactAddress)

    const performSync = async () => {
      try {
        const freshMessages = await readHistoryChat(contactAddress)
        console.log(freshMessages)
        setChatHistory((prev) => {
          // Critical Fix: If the user switched contacts while we were fetching,
          // discard these results to prevent "wrong chat" data leaks.
          if (contactAddress !== activeReceiverRef.current) return prev

          // Only update if data is actually different to prevent scroll jumps/flicker
          if (prev.list.length === freshMessages.length) return { ...prev, isLoading: false }

          return {
            list: freshMessages,
            isLoading: false,
          }
        })
      } catch (err) {
        console.error('Sync error:', err)
        setChatHistory((prev) => ({ ...prev, isLoading: false }))
      }
    }

    // 3. Set loading ONLY if the list is currently empty (first time opening)
    setChatHistory((prev) => ({
      ...prev,
      isLoading: prev.list.length === 0,
    }))

    // 4. Initial fetch
    await performSync()

    // 5. Setup the background loop
    chatInterval = setInterval(performSync, 10000)
  }

  // IMPORTANT: Add this to your useEffect cleanup in the main component
  useEffect(() => {
    return () => {
      if (chatInterval) clearInterval(chatInterval)
    }
  }, [])
  // Corrected address validation function (replaces isAddress)
  const isValidEthereumAddress = (address) => {
    // Regular expression for Ethereum addresses
    const ethereumAddressRegex = /^(0x[a-fA-F0-9]{40})$/
    return ethereumAddressRegex.test(address)
  }

  /**
   * New chat
   * @returns
   */
  const newChat = async () => {
    const contactAddress = prompt('Enter the wallet address of the contact:')

    if (!contactAddress || !isValidEthereumAddress(contactAddress)) {
      alert('Invalid Ethereum address.')
      return
    }

    try {
      const keys = getUnlockedKey()
      if (!keys) throw new Error('Vault locked. Please unlock your vault first.')

      // 1. Fetch Bob's Public Key from the Smart Contract Registry
      const receiverPublicKeyHex = await getPublicKeyRegistry(contactAddress)

      if (!receiverPublicKeyHex || receiverPublicKeyHex === '0x') {
        throw new Error("This user hasn't registered a chat key yet.")
      }

      // 2. Calculate the Shared Secret (The mathematical "Link")
      const myPrivateKeyHex = keys.privKey.toHex ? `0x${keys.privKey.toHex()}` : keys.privKey
      const signingKey = new ethers.SigningKey(myPrivateKeyHex)
      const sharedSecret = signingKey.computeSharedSecret(receiverPublicKeyHex)

      // 3. Derive the Stealth Address (The "Meeting Point")
      const stealthAddress = ethers.getAddress(ethers.dataSlice(ethers.keccak256(sharedSecret), 12))

      // 4. Derive the Topic (The Thread ID)
      const topic = ethers.keccak256(sharedSecret)

      // 5. Save to local DB so the scanner starts watching this room
      const existing = await db.friends.get({ stealthAddress: stealthAddress })
      if (!existing) {
        await db.friends.add({
          contactAddress: contactAddress,
          publicKey: receiverPublicKeyHex,
          stealthAddress: stealthAddress,
          topic: topic,
          isAccepted: true,
        })
      }

      // 6. Navigate to the chat
      viewChatWith(contactAddress, stealthAddress)
    } catch (error) {
      console.error('Handshake failed:', error)
      alert(error.message)
    }
  }
  // Inside your main Chat Component:
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chatHistory.list]) // Scrolls down whenever the list updates

  useEffect(() => {
    activeReceiverRef.current = receiverAddress
  })

  useEffect(() => {
    if (!sessionStorage.getItem('localPassword')) {
      // Redirect to the lock page
      router.push('/unlock')
      return
    }

    console.log(publicClient) // Like ethers Provider publicClient.transport.url
    console.log(walletClient) // Like ethers Signer : window.ethereum

    // Log info
    // console.log(`publicClient:`, publicClient)
    // console.log(`walletClient:`, walletClient)
    // publicClient.getBlock().then((block) => console.log(block))
    // Do whatever low-level shit you want
    //const hash = await walletClient.sendTransaction({ ... })

    // getPrivateWallet().then((wallet) => {
    //   // console.log(`Private Wallet:`, wallet)

    // })

    // retrieveAndDecryptWallet().then((wallet) => {
    //   // setWallet(wallet)
    //   // walletBalance(address)
    //   // readHistoryChat(`0x743876775BaA4de6a07AeAAdc777C442bf1a35F2`).then((messages) => {
    //   //   console.log(messages)
    //   //   setChatHistory({ list: messages })
    //   // })
    // })
  }, [isConnected])

  return (
    <div className={clsx(styles.chat)}>
      <aside className={clsx(styles.aside, 'flex', 'flex-column', 'justify-content-start')}>
        <header className={clsx(styles.aside__header, 'flex', 'align-items-center', 'justify-content-between')}>
          <h1 className={clsx(styles.aside__logo, 'flex flex-row align-items-center justify-content-center')}>{process.env.NEXT_PUBLIC_NAME}</h1>

          <ul className={clsx('flex', 'align-items-center', 'justify-content-between')}>
            <li>
              <button onClick={(e) => newChat()}>
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

        <ul className={clsx(styles.aside__filter, 'flex', 'align-items-center', 'justify-content-between')}>
          {[`All`, `Unread`, `Groups`, `Favorites`].map((filter) => {
            const isActive = filter.toLocaleLowerCase() === activeFilter.toLocaleLowerCase()

            return (
              <li key={filter} className={styles.aside__filter__item}>
                <button
                  className={clsx(styles.aside__filter__button, {
                    [styles['aside__filter__button--active']]: isActive,
                  })}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}
                </button>
              </li>
            )
          })}
        </ul>

        <ConversationList activeChat={receiverAddress} onSelect={viewChatWith} />
      </aside>

      <main className={clsx(styles.main)}>
        <div className={clsx(styles.chatHistory)} ref={scrollRef}>
          {/* Show loading indicator as an overlay or at the top, don't hide the list */}
          {chatHistory.isLoading && chatHistory.list.length === 0 && <p>Loading...</p>}
          {chatHistory?.list?.length > 0 ? (
            chatHistory.list.map((msg) => (
              <div
                key={msg.id}
                className={clsx(styles['chat-message'], {
                  [styles['chat-message--me']]: msg.side === 'me',
                  [styles['chat-message--them']]: msg.side === 'them',
                })}
              >
                <div className={styles['chat-message__content']}>{msg.message}</div>
                <div className={clsx(styles['chat-message__timestamp'], 'flex align-items-center gap-025')} title={msg.timestamp}>
                  {/* Extracts just the time part from the locale string */}
                  <small>{msg.timestamp.split(',')[1]?.trim() || msg.timestamp}</small>

                  {msg.side === 'me' && <span className={styles['chat-message__status']}>✓</span>}
                </div>
              </div>
            ))
          ) : (
            <div className={styles['chat-history__empty']}>No messages yet. Send a greeting!</div>
          )}
        </div>
        <footer className={clsx(styles.footer, `mt-20`)}>
          <form onSubmit={(e) => sendEncryptedMessage(e)}>
            <div className={clsx(styles.footer__input, 'flex align-items-center justify-content-between gap-1')}>
              <textarea
                type="text"
                name="content"
                placeholder={`Write a message${receiverAddress ? ` to ${receiverAddress.substring(0, 6)}...` : '...'}`}
                value={messageText}
                disabled={isLoading}
                onChange={(e) => {
                  setMessageText(e.target.value)
                  e.target.style.height = e.target.value.length > 0 ? Math.min(e.target.scrollHeight, 100) + 'px' : '20px'
                }}
              />

              {isLoading && <ContentSpinner />}

              <button className={clsx('rounded-full', 'd-f-c')} type="submit" disabled={!receiverAddress || !messageText || isConfirming || isSigning || isLoading}>
                {isConfirming ? `Posting...` : isSigning ? `Signing...` : <ArrowUp width={18} height={18} strokeWidth={1.5} />}
              </button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  )
}

const ConversationList = ({ activeChat, onSelect }) => {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(false)
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      if (!isConnected || !address) return
      if (conversations.length === 0) setLoading(true)

      try {
        const chatData = await getConversationList(address, 0, 50)

        const enrichedConversations = await Promise.all(
          chatData.map(async (chat) => {
            let profileInfo = {
              name: null,
              image: `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiebl75dg4kbwh2ekkaq5zorr6vgkaoaordng5w623wqe7nwojhei4`,
            }

            try {
              const res = await getUniversalProfile(chat.contactAddress)
              if (res.data?.Profile?.[0]) {
                profileInfo.name = res.data.Profile[0].name
                profileInfo.image = res.data.Profile[0].profileImages[0]?.src || profileInfo.image
              } else {
                const fallback = await getProfile(chat.contactAddress)
                if (fallback.wallet) {
                  profileInfo.name = fallback.name
                  profileInfo.image = fallback.profileImage || profileInfo.image
                }
              }
            } catch (e) {
              console.warn(`Profile fetch failed for ${chat.contactAddress}`)
            }

            return { ...chat, profileInfo }
          }),
        )

        if (isMounted) setConversations(enrichedConversations)
      } catch (err) {
        console.error('Stealth sidebar sync failed:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 20000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [address, isConnected])

  return (
    <div className={styles['conversation-list']}>
      <h3 className={styles['conversation-list__title']}>Messages {conversations.length > 0 && `(${conversations.length})`}</h3>

      <div className={clsx(styles['conversation-list__container'], 'flex flex-column gap-1 mt-20')}>
        {loading && conversations.length === 0 && <p className={styles['conversation-list__loading']}>Scanning stealth rooms...</p>}

        {conversations.map((chat) => {
          const hasHistory = chat.lastMessage && chat.lastMessage.timestamp > 0
          const displayAddr = `${chat.contactAddress.slice(0, 6)}...${chat.contactAddress.slice(-4)}`
          const displayName = chat.profileInfo.name || displayAddr

          return (
            <button
              key={chat.topic}
              className={clsx(styles['conversation-item'], {
                [styles['conversation-item--active']]: activeChat === chat.contactAddress,
              })}
              onClick={() => onSelect(chat.contactAddress)}
            >
              <div className={styles['conversation-item__content']}>
                <div className={styles['conversation-item__user']}>
                  <img src={chat.profileInfo.image} alt={displayName} className={styles['conversation-item__avatar']} />
                  <div className={clsx(styles['conversation-item__info'])}>
                    <div className={clsx('flex align-items-center gap-025')}>
                      <strong className={styles['conversation-item__name']}>{displayName}</strong>
                      <span className={styles['conversation-item__chain-icon']} dangerouslySetInnerHTML={{ __html: activeChain[0].icon }} />
                    </div>
                    <div className={styles['conversation-item__chain']}>{hasHistory && <small className={styles['conversation-item__relative']}>{moment.unix(chat.lastMessage.timestamp).fromNow()}</small>}</div>
                  </div>
                </div>

                <div className={styles['conversation-item__meta']}>
                  {hasHistory ? (
                    <>
                      <span className={styles['conversation-item__time']}>
                        {new Date(chat.lastMessage.timestamp * 1000).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {/* <p className={styles['conversation-item__snippet']}>
                        {chat.lastMessage.snippet}
                      </p> */}
                    </>
                  ) : (
                    <p className={clsx(styles['conversation-item__snippet'], styles['conversation-item__snippet--empty'])}>Start chat</p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
