import useSWR from 'swr'
import { ethers } from 'ethers'
import { getIPFS } from '@/lib/ipfs'
import { unlockAppKeyFromStorage } from '@/lib/appVault'
import { usePublicClient, useAccount } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import abiChat from '@/abis/Chat.json'
import ecies from 'eciesjs'
import { Buffer } from 'buffer'

function decodeEncryptedKeyBlob(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const clean = value.replace(/^0x/, '')
    if (!clean || clean.length % 2 !== 0) return null
    return Uint8Array.from(Buffer.from(clean, 'hex'))
  }
  if (value instanceof Uint8Array) return value
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data)
  }
  return null
}

function resolveIpfsData(raw) {
  let parsed = raw
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  if (!parsed || typeof parsed !== 'object') return null
  return parsed
}

export const useLastMessage = (topic) => {
  const publicClient = usePublicClient()
  const { address } = useAccount()
  const [, activeChainContracts] = getActiveChain()
  const tunnelAddress = activeChainContracts?.chat

  const { data, isLoading } = useSWR(
    topic && tunnelAddress && publicClient ? `last-msg-${topic}` : null,
    async () => {
      try {
        const keys = await unlockAppKeyFromStorage()
        if (!keys?.privKeyHex) return null

        const myAddress = address?.toLowerCase()

        const response = await publicClient.readContract({
          address: tunnelAddress,
          abi: abiChat,
          functionName: 'getTopicHistory',
          args: [topic, 0n, 1n],
        })

        const allMsgs = response?.[0]
        if (!allMsgs?.length) return null

        const rawMsg = allMsgs[0]
        const deleted = Boolean(rawMsg.isDeleted ?? rawMsg[5])
        const metadataCid = rawMsg.metadata ?? rawMsg[2]
        if (deleted || !metadataCid) return null

        const msgEncryptedKey = rawMsg.encryptedKey ?? rawMsg[3]
        const sender = String(rawMsg.sender ?? rawMsg[0] ?? '').toLowerCase()
        const timestamp = Number(rawMsg.timestamp ?? rawMsg[1] ?? 0)

        const payloadRaw = await getIPFS(metadataCid)
        const ipfsData = resolveIpfsData(payloadRaw)
        if (!ipfsData?.iv || !ipfsData?.ciphertext) return null

        const subtle = window.crypto.subtle
        const isIncoming = sender !== myAddress

        const perTopicSeed = ethers.keccak256(
          ethers.concat([topic, ethers.toUtf8Bytes('content-encryption')])
        )

        let decryptionKey = await subtle.importKey(
          'raw',
          ethers.getBytes(perTopicSeed),
          'AES-GCM',
          true,
          ['decrypt']
        )

        if (isIncoming) {
          const wrappedKeyBlob = decodeEncryptedKeyBlob(msgEncryptedKey)
          if (wrappedKeyBlob) {
            try {
              const privKeyBuf = Buffer.from(keys.privKeyHex.replace(/^0x/, ''), 'hex')
              const unwrapped = ecies.decrypt(privKeyBuf, Buffer.from(wrappedKeyBlob))
              decryptionKey = await subtle.importKey(
                'raw',
                new Uint8Array(unwrapped),
                'AES-GCM',
                true,
                ['decrypt']
              )
            } catch {
              // topic key fallback stays active
            }
          }
        }

        const decrypted = await subtle.decrypt(
          { name: 'AES-GCM', iv: ethers.getBytes(ipfsData.iv) },
          decryptionKey,
          ethers.getBytes(ipfsData.ciphertext)
        )

        return {
          message: new TextDecoder().decode(decrypted),
          timestamp: timestamp * 1000,
        }
      } catch (err) {
        console.error('[useLastMessage] failed for topic', topic, err)
        return null
      }
    },
    { revalidateOnFocus: true, refreshInterval: 15000 }
  )

  return { latestMessage: data, isLoading }
}