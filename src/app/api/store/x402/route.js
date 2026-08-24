// app/api/store/x402/route.js
//
// x402 (HTTP 402) purchase endpoint for gated store content, settled in USDC via EIP-3009.
//
//   GET /api/store/x402?chainId=8453&postId=763
//     no X-PAYMENT header  → 402 + payment requirements (x402 "exact" scheme)
//     with X-PAYMENT header → verify + settle transferWithAuthorization (USDC, buyer → seller,
//                             no custody, no platform fee), record access on-chain via
//                             grantPurchase (OPERATOR_ROLE), return the decrypted content.
//
// Self-facilitated: the operator wallet submits the buyer's signed authorization itself — the
// token contract is what verifies the signature, so an invalid payment simply fails simulation.
// Requires STORE_OPERATOR_PRIVATE_KEY (wallet holding OPERATOR_ROLE on HupBazaar, funded for gas).
// Only listings priced in the chain's canonical USDC can be bought over x402.

import { NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http, isAddress, isAddressEqual, parseSignature, erc20Abi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia } from 'wagmi/chains'
import storeAbi from '@/abis/HupBazaar.json'
import { STORE_ADDRESSES, USDC, X402_NETWORKS } from '@/lib/tokens'
import { decryptContent, isConfigured } from '@/lib/storeCrypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SUPPORTED_CHAINS = [lukso, celo, sepolia, base, monad, bsc, monadTestnet, arbitrumSepolia, somniaTestnet, unichainSepolia, optimismSepolia]

const TRANSFER_WITH_AUTHORIZATION_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
]

function json402(accepts, error) {
  return NextResponse.json({ x402Version: 1, error, accepts }, { status: 402 })
}

export async function GET(request) {
  try {
    if (!isConfigured()) {
      return NextResponse.json({ error: 'Server is not configured for gated content' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const chainId = Number(searchParams.get('chainId'))
    const postId = searchParams.get('postId')

    if (!chainId || !postId) {
      return NextResponse.json({ error: 'chainId and postId query params are required' }, { status: 400 })
    }

    const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId)
    const storeAddress = STORE_ADDRESSES[chainId]
    const usdc = USDC[chainId]
    const network = X402_NETWORKS[chainId]

    if (!chain || !storeAddress) {
      return NextResponse.json({ error: 'Store is not available on this chain' }, { status: 400 })
    }
    if (!usdc?.eip3009 || !network) {
      return NextResponse.json({ error: 'x402 payments are not supported on this chain' }, { status: 400 })
    }

    const publicClient = createPublicClient({ chain, transport: http() })
    const listing = await publicClient.readContract({
      address: storeAddress,
      abi: storeAbi,
      functionName: 'getListing',
      args: [BigInt(postId)],
    })

    if (!listing.isActive || listing.quantity === 0n) {
      return NextResponse.json({ error: 'Listing is not active' }, { status: 404 })
    }
    if (!isAddressEqual(listing.paymentToken, usdc.address)) {
      return NextResponse.json({ error: 'This listing is not priced in USDC — buy it on-chain instead' }, { status: 400 })
    }
    if (!listing.metadata) {
      return NextResponse.json({ error: 'This listing has no gated content to deliver' }, { status: 404 })
    }

    const tokenName = await publicClient.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'name' })

    // Same payout routing as buyItem onchain: the listing's vault when set, else the seller
    const payoutAddress = listing.vault && !isAddressEqual(listing.vault, zeroAddress) ? listing.vault : listing.seller

    const requirements = {
      scheme: 'exact',
      network,
      maxAmountRequired: listing.price.toString(),
      resource: request.url,
      description: `Unlock gated content for Hup post ${postId}`,
      mimeType: 'application/json',
      payTo: payoutAddress,
      maxTimeoutSeconds: 300,
      asset: usdc.address,
      extra: { name: tokenName, version: '2' },
    }

    const paymentHeader = request.headers.get('x-payment')
    if (!paymentHeader) {
      return json402([requirements], 'X-PAYMENT header is required')
    }

    // --- Decode and validate the payment payload ---

    let payment
    try {
      payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'))
    } catch {
      return json402([requirements], 'Malformed X-PAYMENT header')
    }

    const auth = payment?.payload?.authorization
    const signature = payment?.payload?.signature
    if (payment?.scheme !== 'exact' || !auth || !signature) {
      return json402([requirements], 'Unsupported payment scheme or missing payload')
    }
    if (!isAddress(auth.from) || !isAddressEqual(auth.to, payoutAddress)) {
      return json402([requirements], "Payment must be addressed to the seller's payout wallet")
    }
    if (BigInt(auth.value) < listing.price) {
      return json402([requirements], 'Payment amount is below the listing price')
    }
    const nowSec = Math.floor(Date.now() / 1000)
    if (Number(auth.validAfter) > nowSec || Number(auth.validBefore) < nowSec + 6) {
      return json402([requirements], 'Payment authorization is not currently valid')
    }

    if (!process.env.STORE_OPERATOR_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Server is not configured for x402 settlement' }, { status: 500 })
    }

    const operator = privateKeyToAccount(process.env.STORE_OPERATOR_PRIVATE_KEY)
    const walletClient = createWalletClient({ account: operator, chain, transport: http() })
    const { v, r, s } = parseSignature(signature)

    const settleArgs = [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s]

    // --- Settle: the token contract itself verifies the buyer's signature ---

    let settleHash
    try {
      const { request: settleRequest } = await publicClient.simulateContract({
        account: operator,
        address: usdc.address,
        abi: TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: 'transferWithAuthorization',
        args: settleArgs,
      })
      settleHash = await walletClient.writeContract(settleRequest)
      await publicClient.waitForTransactionReceipt({ hash: settleHash })
    } catch (e) {
      console.error('x402 settlement failed:', e.shortMessage || e.message)
      return json402([requirements], 'Payment settlement failed — invalid or already-used authorization')
    }

    // --- Record access on-chain, then deliver the content ---

    const { request: grantRequest } = await publicClient.simulateContract({
      account: operator,
      address: storeAddress,
      abi: storeAbi,
      functionName: 'grantPurchase',
      args: [BigInt(postId), auth.from, 1n, '0x'],
    })
    const grantHash = await walletClient.writeContract(grantRequest)
    await publicClient.waitForTransactionReceipt({ hash: grantHash })

    // A sell-out (auto-deactivation) needs no handling here: grantPurchase emits ItemBought,
    // and the cidex indexer derives remaining stock/active state into store_listings from it.

    const gatewayUrl = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL
    const ipfsRes = await fetch(`${gatewayUrl}${listing.metadata.replace('ipfs://', '')}`)
    if (!ipfsRes.ok) {
      return NextResponse.json({ error: 'Payment settled but content fetch failed — contact support', settlement: settleHash }, { status: 502 })
    }

    const blob = Buffer.from(await ipfsRes.arrayBuffer())
    const envelope = JSON.parse((await decryptContent(chainId, postId, blob)).toString('utf8'))

    const paymentResponse = Buffer.from(
      JSON.stringify({ success: true, transaction: settleHash, network, payer: auth.from }),
    ).toString('base64')

    return NextResponse.json(envelope, { status: 200, headers: { 'X-PAYMENT-RESPONSE': paymentResponse } })
  } catch (e) {
    console.error('x402 purchase error:', e)
    return NextResponse.json({ error: 'Internal Server Error during x402 purchase' }, { status: 500 })
  }
}
