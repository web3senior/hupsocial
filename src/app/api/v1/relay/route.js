import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import forwarderAbi from '../../../../abis/Forwarder.json'
import chatAbi from '../../../../abis/Chat.json'
import hupAbi from '../../../../abi/post.json'
import pollsAbi from '../../../../abis/HupPolls.json'
import { CONTRACTS } from '../../../../config/contracts'
import { GASLESS_BUCKETS, GASLESS_POLL_BUCKETS, formatWait, gaslessBucketFor, gaslessPolicyFor, isGaslessChainId } from '../../../../config/gasless'
import { forgetServerRpc, getServerProvider, isTransportError } from '../../../../lib/serverRpc'

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY

// --- Relay policy ---
// The relayer's key pays for everything that lands here, so a request may only target a
// contract this app deployed on that chain. The Hup contract is narrowed further to the
// sponsored selectors in config/gasless.js — `create`, `batchLike` and `unlike` only, since
// it also carries paid, owner-only and admin functions that must never run on our key.
// Unlike has its own small window, which is what caps heart-toggle farming: every
// like→unlike→like cycle spends one sponsored unlike, so cycles stop at that bucket's max.
// Un-repost is deliberately unsponsored: it rides deleteContent, which deletes any of the
// caller's content, and sponsoring deletions is a different decision.
const hupInterface = new ethers.Interface(hupAbi)
const pollsInterface = new ethers.Interface(pollsAbi)

const SPONSORED_SELECTORS = new Map(
  Object.entries(GASLESS_BUCKETS).map(([name, bucket]) => [hupInterface.getFunction(name).selector, bucket]),
)

// The polls contract gets its own narrow list for the same reason Hup does: it also carries
// createPoll (which writes a CID to storage) and admin functions, and only the ballot is a tap
// the trial exists to make free.
const POLL_SELECTORS = new Map(
  Object.entries(GASLESS_POLL_BUCKETS).map(([name, bucket]) => [pollsInterface.getFunction(name).selector, bucket]),
)

// The relayer sends `execute` to whatever forwarder the caller names, so that address has to
// be one of ours too — otherwise a crafted request points us at an arbitrary contract and we
// pay the gas for whatever it does. A chain can have two: the chat forwarder and, where Hup
// was deployed against its own, `hupForwarder`.
const isConfiguredForwarder = (chainId, forwarderAddress) => {
  const contracts = CONTRACTS[`chain${chainId}`]
  if (!contracts || !forwarderAddress) return false

  const target = forwarderAddress.toLowerCase()
  return [contracts.forwarder, contracts.hupForwarder].filter(Boolean).some((address) => address.toLowerCase() === target)
}

// Returns the rate-limit bucket a request belongs to, or null when we will not pay for it.
const sponsoredBucket = (chainId, to, data) => {
  const contracts = CONTRACTS[`chain${chainId}`]
  if (!contracts || !to) return null

  const target = to.toLowerCase()
  const configured = Object.values(contracts)
    .filter((value) => typeof value === 'string' && value.startsWith('0x') && value.length === 42)
    .map((value) => value.toLowerCase())

  if (!configured.includes(target)) return null

  if (contracts.hup && target === contracts.hup.toLowerCase()) {
    const bucket = SPONSORED_SELECTORS.get((data || '').slice(0, 10).toLowerCase()) ?? null
    if (bucket !== 'create') return bucket

    // A repost rides the create selector (ContentType.Repost, empty metadata), so the
    // bucket splits on the decoded type argument — same resolver the client uses.
    // Calldata that carries create's selector but will not decode is refused outright
    // rather than carried to simulation on our key.
    try {
      return gaslessBucketFor('create', hupInterface.decodeFunctionData('create', data))
    } catch {
      return null
    }
  }

  // Polls are narrowed the same way Hup is, and BEFORE the chat fallback below: without this
  // branch, adding the address to config/contracts.js would quietly sponsor every function on
  // the contract at chat limits.
  if (contracts.polls && target === contracts.polls.toLowerCase()) {
    return POLL_SELECTORS.get((data || '').slice(0, 10).toLowerCase()) ?? null
  }

  return 'chat'
}

// --- Throttle ---
// In-memory and per-instance on purpose: a spend brake for the gasless trial, not a security
// boundary. Serverless instances each keep their own window. Limits live in config/gasless.js
// so the client can pre-check against the same numbers.
const relayHits = new Map()

const throttleKey = (bucket, chainId, from) => `${bucket}:${chainId}:${from.toLowerCase()}`

// Live hits for a key, pruned to the policy window.
const recentHits = (bucket, chainId, from) => {
  const { windowMs } = gaslessPolicyFor(bucket)
  const key = throttleKey(bucket, chainId, from)
  const now = Date.now()

  // Cheap sweep so a long-lived instance never grows the map without bound
  if (relayHits.size > 5000) {
    for (const [entryKey, stamps] of relayHits) {
      if (stamps.every((stamp) => now - stamp >= windowMs)) relayHits.delete(entryKey)
    }
  }

  const hits = (relayHits.get(key) ?? []).filter((stamp) => now - stamp < windowMs)
  relayHits.set(key, hits)
  return hits
}

// Authoritative check: a cooldown between consecutive calls, plus a ceiling per window.
// Returns how long the caller must wait rather than a bare boolean, so the UI can say it.
const peekThrottle = (bucket, chainId, from) => {
  const { cooldownMs, max } = gaslessPolicyFor(bucket)
  const hits = recentHits(bucket, chainId, from)
  const now = Date.now()

  const last = hits[hits.length - 1]
  if (cooldownMs > 0 && last !== undefined && now - last < cooldownMs) {
    return { allowed: false, retryAfter: Math.ceil((cooldownMs - (now - last)) / 1000) }
  }

  if (hits.length >= max) {
    const { windowMs } = gaslessPolicyFor(bucket)
    return { allowed: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) }
  }

  return { allowed: true }
}

// Counted only once the request is actually going out, so a rejected signature or a failed
// simulation never starts someone's cooldown — the clock tracks what we spend, not what we saw.
const recordThrottleHit = (bucket, chainId, from) => {
  recentHits(bucket, chainId, from).push(Date.now())
}

// --- Send queue ---
// Two concurrent sends from the relayer race on its account nonce, which surfaces as
// "nonce too low" / "replacement underpriced". Each chain's sends run one after another.
const sendQueues = new Map()

const enqueueSend = (chainId, task) => {
  const previous = sendQueues.get(chainId) ?? Promise.resolve()
  const next = previous.then(task, task)

  sendQueues.set(
    chainId,
    next.catch(() => {}),
  )

  return next
}

// The EIP-712 name a forwarder was actually deployed with, read from the contract itself.
// Returns null when the call fails, leaving the caller's own error to surface.
const readForwarderDomainName = async (provider, forwarderAddress) => {
  try {
    const iface = new ethers.Interface(['function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])'])
    const raw = await provider.call({ to: forwarderAddress, data: iface.encodeFunctionData('eip712Domain') })
    const [, name] = iface.decodeFunctionResult('eip712Domain', raw)
    return name || null
  } catch (err) {
    console.warn('RELAY_DOMAIN_READ_FAILED:', err.message)
    return null
  }
}

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
  // Kept out here so the catch can tell the resolver which chain went bad
  let relayChainId = null

  // Decode a revert error into a human-readable string.
  // Checks forwarder custom errors, then Chat and Hup custom errors, then falls back
  // to the ethers short message.  If the error is FailedCall it also simulates the
  // inner EIP-2771 call (appending `from`) to recover the target contract's reason.
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
      try {
        const decoded = new ethers.Interface(hupAbi).parseError(err.data)
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
          try {
            const decoded = new ethers.Interface(hupAbi).parseError(simErr.data)
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
    const { request: forwardRequest, signature, forwarderAddress: fwdAddr, chainId: bodyChainId, forwarderName } = body
    forwarderAddress = fwdAddr

    // The chain id now has to come from the body: the endpoint is resolved from it, so there
    // is no provider to ask first. All three call sites already send it.
    const chainId = Number(bodyChainId)
    if (!Number.isInteger(chainId) || chainId <= 0) {
      return NextResponse.json({ error: 'Missing chain id.' }, { status: 400 })
    }

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

    // Spend gates — all of them local, and all of them ahead of any RPC work that could cost
    // us gas.
    const bucket = sponsoredBucket(chainId, fullRequest.to, fullRequest.data)

    if (!bucket) {
      console.error('RELAY_TARGET_REJECTED:', { chainId, to: fullRequest.to, selector: (fullRequest.data || '').slice(0, 10) })
      return NextResponse.json({ error: 'This call is not sponsored by the relayer.' }, { status: 403 })
    }

    // The gasless trial is per-chain, and the client cannot be the one enforcing that — a
    // crafted request would otherwise spend our key on a chain we never opted into (an L1
    // post being the expensive case). Chat predates the trial and keeps its own chains.
    if (bucket !== 'chat' && !isGaslessChainId(chainId)) {
      console.error('RELAY_CHAIN_REJECTED:', chainId)
      return NextResponse.json({ error: 'The relayer does not sponsor this network.' }, { status: 403 })
    }

    if (!isConfiguredForwarder(chainId, forwarderAddress)) {
      console.error('RELAY_FORWARDER_REJECTED:', { chainId, forwarderAddress })
      return NextResponse.json({ error: 'Unknown forwarder for this network.' }, { status: 403 })
    }

    const throttle = peekThrottle(bucket, chainId, fullRequest.from)

    if (!throttle.allowed) {
      console.warn('RELAY_THROTTLED:', bucket, fullRequest.from, `${throttle.retryAfter}s`)
      return NextResponse.json(
        { error: `Slow down — you can do that again in ${formatWait(throttle.retryAfter)}.`, retryAfter: throttle.retryAfter },
        { status: 429, headers: { 'Retry-After': String(throttle.retryAfter) } },
      )
    }

    // The endpoint used to come from the request body, and the relayer's provider was built
    // from it — which let a crafted request point our key at a node of the caller's choosing.
    // That node answers getFeeData(), so it would have set the gas price on a transaction we
    // sign and pay for. Resolved from the chain id here instead; body.rpcUrl is ignored.
    relayChainId = chainId
    provider = await getServerProvider(chainId)

    if (!provider) {
      console.error('RELAY_RPC_UNREACHABLE:', chainId)
      return NextResponse.json({ error: 'Could not reach this network right now. Please try again shortly.' }, { status: 503 })
    }

    const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider)
    const forwarder = new ethers.Contract(forwarderAddress, forwarderAbi, relayer)

    const message = {
      from: fullRequest.from,
      to: fullRequest.to,
      value: fullRequest.value,
      gas: fullRequest.gas,
      nonce: fullRequest.nonce,
      deadline: fullRequest.deadline,
      data: fullRequest.data,
    }

    // Runs all three signature checks against one candidate signing domain. The digest is
    // computed once per candidate and reused by every step.
    const verifyWithDomainName = async (name) => {
      const candidate = { name, version: '1', chainId, verifyingContract: forwarderAddress }
      const digest = ethers.TypedDataEncoder.hash(candidate, FORWARD_REQUEST_TYPES, message)
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

      return { domain: candidate, digest, sigValid, sigStep }
    }

    // The signing domain name differs per deployment (HupForwarder / HupChatForwarder), so
    // callers send their own. When that name doesn't verify, ask the forwarder which name it
    // actually uses and try once more — a mismatch here is a config drift, not a bad signer.
    let verification = await verifyWithDomainName(forwarderName || 'HupChatForwarder')

    if (!verification.sigValid) {
      const onChainName = await readForwarderDomainName(provider, forwarderAddress)
      if (onChainName && onChainName !== verification.domain.name) {
        console.warn('RELAY_DOMAIN_RETRY: forwarder reports', onChainName)
        verification = await verifyWithDomainName(onChainName)
      }
    }

    const domain = verification.domain

    if (!verification.sigValid) {
      console.error('RELAY_SIG_MISMATCH:', { from: fullRequest.from, chainId: domain.chainId, digest: verification.digest })
      return NextResponse.json({ error: 'Invalid Signature' }, { status: 400 })
    }
    console.log('RELAY_SIG_OK via', verification.sigStep)

    // Check the on-chain nonce to decide whether simulation is meaningful.
    // When the client sends messages faster than blocks are mined, previous txs
    // sit in the mempool with a lower nonce. Simulating against the confirmed state
    // will always fail with InvalidSigner/nonce-mismatch even though the request is
    // perfectly valid — so we only simulate when the nonce matches the confirmed state.
    const onChainNonce = BigInt(await forwarder.nonces(fullRequest.from))
    if (fullRequest.nonce < onChainNonce) {
      console.error('RELAY_NONCE_REPLAY:', { requested: fullRequest.nonce.toString(), onChain: onChainNonce.toString() })
      return NextResponse.json({ error: 'Nonce already used (replay).' }, { status: 400 })
    }

    // Pre-flight simulation: catch reverts before spending gas and return a
    // human-readable reason instead of a silent on-chain failure.
    // Skip when nonce > onChainNonce — a pending tx is already in the mempool ahead
    // of this one; simulation against confirmed state would report a false nonce error.
    if (fullRequest.nonce === onChainNonce) {
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
    } else {
      console.log(`RELAY_SIM_SKIP: nonce=${fullRequest.nonce} > onChain=${onChainNonce} (pending tx path)`)
    }

    // eth_estimateGas on LUKSO returns no revert data and is unreliable.
    // Skip auto-estimation by providing an explicit gasLimit (inner gas + forwarder overhead).
    // EIP-1559: maxFeePerGas must be >= maxPriorityFeePerGas; clamp to whichever is larger
    // so low-base-fee chains (e.g. LUKSO) don't reject the tx with "priorityFee > maxFee".
    const maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei')
    const feeData = await provider.getFeeData()
    const networkMax = feeData.maxFeePerGas ?? 0n
    const maxFeePerGas = networkMax >= maxPriorityFeePerGas ? networkMax : maxPriorityFeePerGas
    recordThrottleHit(bucket, chainId, fullRequest.from)

    const tx = await enqueueSend(chainId, () =>
      forwarder.execute(fullRequest, {
        gasLimit: BigInt(fullRequest.gas) + 100000n,
        maxPriorityFeePerGas,
        maxFeePerGas,
      }),
    )

    return NextResponse.json({
      success: true,
      txHash: tx.hash,
    })
  } catch (error) {
    // The endpoint, not the request, is what failed — drop it so the next attempt starts
    // further down the list instead of re-picking the same bad host for the rest of the TTL.
    // A revert is left alone: it arrived intact, and the answer was simply no.
    if (relayChainId !== null && isTransportError(error)) forgetServerRpc(relayChainId)

    const errorMessage = await decodeRevert(error).catch(() => error.message)
    console.error('RELAY_ERROR:', errorMessage, error.code)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
