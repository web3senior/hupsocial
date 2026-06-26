import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import forwarderAbi from '../../../../abis/Forwarder.json'

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY
const FORWARDER_ABI = forwarderAbi

export async function POST(request) {
  try {
    const body = await request.json()
    const { request: forwardRequest, signature, rpcUrl, forwarderAddress } = body
    console.log(`Received relay request with RPC URL: ${rpcUrl}`)
    const fetchRequest = new ethers.FetchRequest(rpcUrl)
    const provider = new ethers.JsonRpcProvider(fetchRequest)
    const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider)
    const forwarder = new ethers.Contract(forwarderAddress, FORWARDER_ABI, relayer)

    // ... (rest of your formatting and verify logic)
    const fullRequest = {
      from: forwardRequest.from,
      to: forwardRequest.to,
      value: BigInt(forwardRequest.value || 0),
      gas: BigInt(forwardRequest.gas),
      nonce: BigInt(forwardRequest.nonce),
      deadline: Number(forwardRequest.deadline),
      data: forwardRequest.data,
      signature: signature,
    }

    // 1. Verify offchain
    const isValid = await forwarder.verify(fullRequest)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 })
    }

    // 2. Broadcast — don't wait for mining, the client shows optimistic UI.
    const tx = await forwarder.execute(fullRequest, {
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    })

    return NextResponse.json({
      success: true,
      txHash: tx.hash,
    })
  } catch (error) {
    console.error('RELAY_ERROR:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
