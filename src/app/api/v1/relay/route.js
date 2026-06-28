import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import forwarderAbi from '../../../../abis/Forwarder.json'
import chatAbi from '../../../../abis/Chat.json'

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY

// Must match the types used in signMetaTransactionSessionMode on the client.
const FORWARD_REQUEST_TYPES = {
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

export async function POST(request) {
  let fullRequest = null
  let provider = null
  let forwarderAddress = null

  // Decode a revert error into a human-readable string.
  // Checks forwarder custom errors, then Chat custom errors, then falls back to
  // the ethers short message.  If the error is FailedCall it also simulates the
  // inner EIP-2771 call (appending `from`) to recover the Chat contract's reason.
  const decodeRevert = async (err) => {
    let msg = err.shortMessage || err.message
    if (err.data) {
      try {
        const decoded = new ethers.Interface(forwarderAbi).parseError(err.data)
        if (decoded) { msg = decoded.name; console.error('RELAY_FWD_REVERT:', decoded.name, decoded.args) }
      } catch {}
      try {
        const decoded = new ethers.Interface(chatAbi).parseError(err.data)
        if (decoded) { msg = decoded.name; console.error('RELAY_INNER_REVERT:', decoded.name, decoded.args) }
      } catch {}
    }
    if (fullRequest && provider && forwarderAddress && (msg === 'FailedCall' || (err.data && err.data !== '0x'))) {
      try {
        const innerData = ethers.concat([ethers.getBytes(fullRequest.data), ethers.getBytes(fullRequest.from)])
        await provider.call({ to: fullRequest.to, from: forwarderAddress, data: innerData })
      } catch (simErr) {
        if (simErr.data) {
          try {
            const decoded = new ethers.Interface(chatAbi).parseError(simErr.data)
            if (decoded) { msg = decoded.name; console.error('RELAY_INNER_REVERT_DECODED:', decoded.name, decoded.args) }
          } catch {}
        }
        if (msg === 'FailedCall') msg = simErr.shortMessage || simErr.message || 'FailedCall'
      }
    }
    return msg
  }

  try {
    const body = await request.json()
    const { request: forwardRequest, signature, rpcUrl, forwarderAddress: fwdAddr, chainId: bodyChainId } = body
    forwarderAddress = fwdAddr
    console.log(`Received relay request with RPC URL: ${rpcUrl}`)
    const fetchRequest = new ethers.FetchRequest(rpcUrl)
    provider = new ethers.JsonRpcProvider(fetchRequest)
    const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider)
    const forwarder = new ethers.Contract(forwarderAddress, forwarderAbi, relayer)

    fullRequest = {
      from: forwardRequest.from,
      to: forwardRequest.to,
      value: BigInt(forwardRequest.value || 0),
      gas: BigInt(forwardRequest.gas),
      nonce: BigInt(forwardRequest.nonce),
      deadline: Number(forwardRequest.deadline),
      data: forwardRequest.data,
      signature: signature,
    }

    // Off-chain EIP-712 verification using the client-provided nonce.
    // chainId is trusted from the client — the on-chain forwarder enforces it anyway.
    // Accepting it here eliminates the getNetwork() round-trip on every relay call.
    const chainId = bodyChainId ?? Number((await provider.getNetwork()).chainId)
    const domain = {
      name: 'HupForwarder',
      version: '1',
      chainId,
      verifyingContract: forwarderAddress,
    }
    const message = {
      from: fullRequest.from,
      to: fullRequest.to,
      value: fullRequest.value,
      gas: fullRequest.gas,
      nonce: fullRequest.nonce,
      deadline: fullRequest.deadline,
      data: fullRequest.data,
    }
    const recoveredSigner = ethers.verifyTypedData(domain, FORWARD_REQUEST_TYPES, message, signature)
    if (recoveredSigner.toLowerCase() !== fullRequest.from.toLowerCase()) {
      console.error('RELAY_SIG_MISMATCH:', {
        recovered: recoveredSigner,
        expected: fullRequest.from,
        chainId: domain.chainId,
        nonce: fullRequest.nonce?.toString(),
      })
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 })
    }

    // eth_estimateGas on LUKSO returns no revert data and is unreliable.
    // Skip auto-estimation by providing an explicit gasLimit (inner gas + forwarder overhead).
    const tx = await forwarder.execute(fullRequest, {
      gasLimit: BigInt(fullRequest.gas) + 100000n,
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    })

    return NextResponse.json({
      success: true,
      txHash: tx.hash,
    })
  } catch (error) {
    const errorMessage = await decodeRevert(error).catch(() => error.message)
    console.error('RELAY_ERROR:', errorMessage, error.code)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
