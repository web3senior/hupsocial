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
      name: 'HupChatForwarder',
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
    // Compute the EIP-712 digest once; reused by all three verification steps below.
    const digest = ethers.TypedDataEncoder.hash(domain, FORWARD_REQUEST_TYPES, message)
    let sigValid = false
    let sigStep = null

    // Step 1 — raw ECDSA of EIP-712 digest (regular EOAs via eth_signTypedData_v4).
    try {
      const recovered = ethers.recoverAddress(digest, signature)
      if (recovered.toLowerCase() === fullRequest.from.toLowerCase()) { sigValid = true; sigStep = 'ecdsa' }
    } catch (e1) { console.warn('RELAY_SIG_S1:', e1.message) }

    // Step 2 — personal_sign / eth_sign of EIP-712 digest (LUKSO controller EOAs or wallets
    //           that don't support typed-data signing; eth_sign adds the Ethereum prefix).
    if (!sigValid) {
      try {
        const recovered = ethers.verifyMessage(ethers.getBytes(digest), signature)
        if (recovered.toLowerCase() === fullRequest.from.toLowerCase()) { sigValid = true; sigStep = 'personal_eoa' }
      } catch (e2) { console.warn('RELAY_SIG_S2:', e2.message) }
    }

    // Step 3 — ERC-1271 for smart-contract wallets (LUKSO Universal Profiles).
    //           personal_sign produces a sig over personal_hash(digest). LUKSO UP's
    //           isValidSignature does ECDSA.recover(dataHash, sig) directly, so we must
    //           pass the already-prefixed personal hash — same pattern as the notifications API.
    if (!sigValid) {
      try {
        const code = await provider.getCode(fullRequest.from)
        console.log('RELAY_ERC1271: from', fullRequest.from, 'codeLen', code?.length)
        if (code && code !== '0x') {
          const personalHash = ethers.hashMessage(ethers.getBytes(digest))
          const iface = new ethers.Interface(['function isValidSignature(bytes32,bytes) view returns (bytes4)'])
          const raw = await provider.call({ to: fullRequest.from, data: iface.encodeFunctionData('isValidSignature', [personalHash, signature]) })
          console.log('RELAY_ERC1271: raw', raw)
          if (raw && raw.length >= 10 && raw.slice(0, 10).toLowerCase() === '0x1626ba7e') { sigValid = true; sigStep = 'erc1271' }
        }
      } catch (e3) { console.error('RELAY_SIG_S3:', e3.message) }
    }

    if (!sigValid) {
      console.error('RELAY_SIG_MISMATCH:', { from: fullRequest.from, chainId: domain.chainId, digest })
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 })
    }
    console.log('RELAY_SIG_OK via', sigStep)

    // Pre-flight simulation: catch reverts before spending gas and return a
    // human-readable reason instead of a silent on-chain failure.
    try {
      await forwarder.execute.staticCall(fullRequest, {
        gasLimit: BigInt(fullRequest.gas) + 100000n,
      })
    } catch (simErr) {
      let reason = simErr.shortMessage || simErr.message || 'unknown revert'
      if (simErr.data) {
        try { reason = new ethers.Interface(forwarderAbi).parseError(simErr.data)?.name ?? reason } catch {}
        try { reason = new ethers.Interface(chatAbi).parseError(simErr.data)?.name ?? reason } catch {}
      }

      // For InvalidSigner: read the forwarder's actual EIP-712 domain to surface mismatches.
      if (reason === 'ERC2771ForwarderInvalidSigner') {
        try {
          const eip712Iface = new ethers.Interface(['function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])'])
          const raw = await provider.call({ to: forwarderAddress, data: eip712Iface.encodeFunctionData('eip712Domain') })
          const [, fwdName, fwdVer, fwdChainId] = eip712Iface.decodeFunctionResult('eip712Domain', raw)
          if (fwdName !== domain.name) {
            reason = `ERC2771ForwarderInvalidSigner — domain name mismatch: forwarder="${fwdName}" but signed with "${domain.name}"`
          } else if (fwdChainId.toString() !== domain.chainId.toString()) {
            reason = `ERC2771ForwarderInvalidSigner — chainId mismatch: forwarder=${fwdChainId} but signed with ${domain.chainId}`
          } else if (fwdVer !== domain.version) {
            reason = `ERC2771ForwarderInvalidSigner — version mismatch: forwarder="${fwdVer}" but signed with "${domain.version}"`
          } else {
            reason = `ERC2771ForwarderInvalidSigner — domain matches (name="${fwdName}" chainId=${fwdChainId}), nonce or deadline mismatch`
          }
        } catch (diagErr) {
          reason = `ERC2771ForwarderInvalidSigner (domain read failed: ${diagErr.message})`
        }
      }

      console.error('RELAY_SIM_FAIL:', reason)
      return NextResponse.json({ error: `Simulation failed: ${reason}` }, { status: 400 })
    }

    // eth_estimateGas on LUKSO returns no revert data and is unreliable.
    // Skip auto-estimation by providing an explicit gasLimit (inner gas + forwarder overhead).
    // EIP-1559: maxFeePerGas must be >= maxPriorityFeePerGas; clamp to whichever is larger
    // so low-base-fee chains (e.g. LUKSO) don't reject the tx with "priorityFee > maxFee".
    const maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei')
    const feeData = await provider.getFeeData()
    const networkMax = feeData.maxFeePerGas ?? 0n
    const maxFeePerGas = networkMax >= maxPriorityFeePerGas ? networkMax : maxPriorityFeePerGas
    const tx = await forwarder.execute(fullRequest, {
      gasLimit: BigInt(fullRequest.gas) + 100000n,
      maxPriorityFeePerGas,
      maxFeePerGas,
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
