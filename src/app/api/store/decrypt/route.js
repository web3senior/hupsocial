// app/api/store/decrypt/route.js
//
// Reveals a seller's gated content. Authorization is a timestamped, signed-message proof plus a
// live on-chain read (against the chain's own default RPC — never a client-supplied one) confirming
// the signer is either the listing's seller or has actually purchased it. Without this check, the
// CID from getListing() is public, so anyone could otherwise read paid content for free.
//
// Signature verification mirrors app/api/v1/notifications/route.js: tries ERC-1271 first (for
// smart-contract accounts like LUKSO Universal Profiles), falling back to plain EOA recovery.

import { NextResponse } from 'next/server'
import { createPublicClient, http, hashMessage, recoverMessageAddress, isAddress, isAddressEqual, getAddress } from 'viem'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia } from 'wagmi/chains'
import storeAbi from '@/abis/HupStore.json'
import { decryptContent, isConfigured } from '@/lib/storeCrypto'
import { STORE_ADDRESSES } from '@/lib/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SUPPORTED_CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia, lineaSepolia]
const SIG_MAX_AGE_MS = 5 * 60 * 1000
const ERC1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
]
const ERC1271_MAGIC_VALUE = '0x1626ba7e'

async function verifyERC1271(publicClient, contractAddress, message, signature) {
  try {
    const hash = hashMessage(message)
    const result = await publicClient.readContract({
      address: contractAddress,
      abi: ERC1271_ABI,
      functionName: 'isValidSignature',
      args: [hash, signature],
    })
    return result?.toLowerCase() === ERC1271_MAGIC_VALUE
  } catch {
    return false
  }
}

export async function POST(request) {
  try {
    if (!isConfigured()) {
      return NextResponse.json({ error: 'Server is not configured for gated content decryption' }, { status: 500 })
    }

    const { postId, chainId, cid, message, signature, up_address } = await request.json()

    if (!postId || !chainId || !cid || !message || !signature) {
      return NextResponse.json({ error: 'postId, chainId, cid, message, and signature are required' }, { status: 400 })
    }

    // Resolve the store contract server-side — never from the client, which could
    // otherwise point us at a fake contract that claims any purchase it likes
    const storeAddress = STORE_ADDRESSES[Number(chainId)]
    if (!storeAddress || !isAddress(storeAddress)) {
      return NextResponse.json({ error: 'Store is not available on this chain' }, { status: 400 })
    }
    if (!message.startsWith(`Reveal gated content for post ${postId}`)) {
      return NextResponse.json({ error: 'Message does not match the expected action' }, { status: 400 })
    }

    const timestampMatch = message.match(/Timestamp:\s*(\d+)/)
    if (!timestampMatch) {
      return NextResponse.json({ error: 'Invalid message format' }, { status: 400 })
    }
    if (Date.now() - Number(timestampMatch[1]) > SIG_MAX_AGE_MS) {
      return NextResponse.json({ error: 'Signature expired' }, { status: 400 })
    }

    const chain = SUPPORTED_CHAINS.find((c) => c.id === Number(chainId))
    if (!chain) {
      return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 })
    }
    const publicClient = createPublicClient({ chain, transport: http() })

    let resolvedAddress
    if (up_address && isAddress(up_address)) {
      const isValidERC1271 = await verifyERC1271(publicClient, up_address, message, signature)
      if (isValidERC1271) {
        resolvedAddress = getAddress(up_address)
      } else {
        // Not a smart account (or plain EOA sharing the same field) — fall back to EOA recovery
        try {
          const recovered = await recoverMessageAddress({ message, signature })
          if (!isAddressEqual(recovered, getAddress(up_address))) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
          }
          resolvedAddress = recovered
        } catch {
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
      }
    } else {
      try {
        resolvedAddress = await recoverMessageAddress({ message, signature })
      } catch {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const [listing, amountPurchased] = await Promise.all([
      publicClient.readContract({ address: storeAddress, abi: storeAbi, functionName: 'getListing', args: [BigInt(postId)] }),
      publicClient.readContract({ address: storeAddress, abi: storeAbi, functionName: 'amountPurchased', args: [BigInt(postId), resolvedAddress] }),
    ])

    const isSeller = isAddressEqual(listing.seller, resolvedAddress)
    const hasPurchased = amountPurchased > 0n

    if (!isSeller && !hasPurchased) {
      return NextResponse.json({ error: 'You have not purchased this item' }, { status: 403 })
    }
    if (listing.metadata !== cid) {
      return NextResponse.json({ error: 'CID does not match this listing' }, { status: 400 })
    }

    const gatewayUrl = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
    const rawCid = cid.replace('ipfs://', '')
    const ipfsRes = await fetch(`${gatewayUrl}${rawCid}`)
    if (!ipfsRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch content from IPFS' }, { status: 502 })
    }

    const blob = Buffer.from(await ipfsRes.arrayBuffer())
    const plaintext = await decryptContent(Number(chainId), postId, blob)
    const envelope = JSON.parse(plaintext.toString('utf8'))

    return NextResponse.json(envelope, { status: 200 })
  } catch (e) {
    console.error('Gated content decryption error:', e)
    return NextResponse.json({ error: 'Internal Server Error during decryption' }, { status: 500 })
  }
}
