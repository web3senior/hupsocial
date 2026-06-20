import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import abiForwarder from '@/lib/abi/forwarder.json'

// ■■■ Configuration ■■■
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY
const FORWARDER_ABI = abiForwarder

export async function POST(request) {
  try {
    const body = await request.json()
    const { request: forwardRequest, signature, rpcUrl, forwarderAddress } = body
    console.log(`Received relay request with RPC URL: ${rpcUrl}`)
    // ■■■ RPC Configuration with API Key ■■■
    const fetchRequest = new ethers.FetchRequest(rpcUrl)
    //fetchRequest.setHeader('api-key', process.env.NOWNODES_API_KEY || `12017ea9-128b-4b44-b248-a39908aa2a47`); // Use env variable!

    const provider = new ethers.JsonRpcProvider(fetchRequest)
    const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider)
    const forwarder = new ethers.Contract(forwarderAddress, FORWARDER_ABI, relayer)

    // ... (rest of your formatting and verify logic)
    const fullRequest = {
      from: forwardRequest.from,
      to: forwardRequest.to,
      value: BigInt(forwardRequest.value || 0),
      gas: BigInt(forwardRequest.gas),
      deadline: Number(forwardRequest.deadline),
      data: forwardRequest.data,
      signature: signature,
    }

    // 1. Verify off-chain
    const isValid = await forwarder.verify(fullRequest)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 })
    }

    // 2. Execute on LUKSO
    const tx = await forwarder.execute(fullRequest)

    const receipt = await tx.wait()

    return NextResponse.json({
      success: true,
      txHash: receipt.hash,
    })
  } catch (error) {
    console.error('RELAY_ERROR:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
