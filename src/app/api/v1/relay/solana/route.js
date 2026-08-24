import { NextResponse } from 'next/server'
import bs58 from 'bs58'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { formatWait, gaslessPolicyFor } from '@/config/gasless'
import { HUP_SOLANA_DISCRIMINATORS, HUP_SOLANA_KIND, MAX_SOLANA_BATCH_LIKE, solanaChainFor } from '@/config/solana'

export const runtime = 'nodejs'

// --- Relay policy ---
// The relayer's key is the fee payer of everything that lands here, so a transaction may only
// carry instructions of the Hup program on that network, and only the sponsored ones: create
// (post, comment, repost), like and unlike — the same set the EVM relay covers. Delete stays
// unsponsored for the same reason un-repost is on EVM. A `create` must name the author as the
// program-fee payer, so the relayer never funds more than the network fee. Every program
// instruction in one transaction has to come from the same signer, which is who the throttle
// counts against.

const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111')

const SPONSORED = new Map(
  ['create', 'like', 'unlike'].map((name) => [Buffer.from(HUP_SOLANA_DISCRIMINATORS[name]).toString('hex'), name]),
)

// The kind byte of `create` picks the bucket: a repost is create(kind = 2) with no metadata
const bucketFor = (name, data) => (name === 'create' && data[8] === HUP_SOLANA_KIND.REPOST ? 'repost' : name)

let relayer = null
let relayerLoaded = false

// JSON array (solana-keygen / Playground export) or base58, both without quotes
const loadRelayer = () => {
  if (relayerLoaded) return relayer
  relayerLoaded = true

  const raw = process.env.SOLANA_RELAYER_SECRET?.trim()
  if (!raw) return null

  try {
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw)
    relayer = Keypair.fromSecretKey(bytes)
  } catch (error) {
    console.error('SOLANA_RELAYER_SECRET is not a valid keypair:', error.message)
  }
  return relayer
}

// --- Throttle ---
// Same policy the EVM relay applies (config/gasless.js): a cooldown between consecutive calls
// plus a ceiling per window, per bucket, per network, per signer. In-memory, like the EVM one.
const relayHits = new Map()

const throttleKey = (bucket, networkId, owner) => `${bucket}:${networkId}:${owner}`

const recentHits = (bucket, networkId, owner) => {
  const { windowMs } = gaslessPolicyFor(bucket)
  const key = throttleKey(bucket, networkId, owner)
  const now = Date.now()

  if (relayHits.size > 5000) {
    for (const [entryKey, stamps] of relayHits) {
      if (stamps.every((stamp) => now - stamp >= windowMs)) relayHits.delete(entryKey)
    }
  }

  const hits = (relayHits.get(key) ?? []).filter((stamp) => now - stamp < windowMs)
  relayHits.set(key, hits)
  return hits
}

const peekThrottle = (bucket, networkId, owner) => {
  const { cooldownMs, windowMs, max } = gaslessPolicyFor(bucket)
  const hits = recentHits(bucket, networkId, owner)
  const now = Date.now()

  const last = hits[hits.length - 1]
  if (cooldownMs > 0 && last !== undefined && now - last < cooldownMs) {
    return { allowed: false, retryAfter: Math.ceil((cooldownMs - (now - last)) / 1000) }
  }
  if (hits.length >= max) {
    return { allowed: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) }
  }
  return { allowed: true }
}

// Counted only once the transaction actually goes out — a rejected one never starts a cooldown
const recordThrottleHit = (bucket, networkId, owner) => {
  recentHits(bucket, networkId, owner).push(Date.now())
}

const connections = new Map()
const connectionFor = (chain) => {
  if (!connections.has(chain.id)) connections.set(chain.id, new Connection(chain.rpcUrl, { commitment: 'confirmed' }))
  return connections.get(chain.id)
}

const reject = (status, error, extra = {}) => NextResponse.json({ error, ...extra }, { status })

/**
 * Reads what the relay would sponsor on a network: the fee payer the client must build its
 * transaction against, or 404 when the relay is not configured for it.
 */
export async function GET(request) {
  const networkId = Number(new URL(request.url).searchParams.get('network_id'))
  const chain = solanaChainFor(networkId)
  const keypair = loadRelayer()

  if (!chain?.hupProgramId || !keypair) return reject(404, 'The relayer does not sponsor this network.')

  return NextResponse.json({
    feePayer: keypair.publicKey.toBase58(),
    buckets: ['create', 'repost', 'like', 'unlike'],
  })
}

export async function POST(request) {
  const keypair = loadRelayer()
  if (!keypair) return reject(503, 'The Solana relayer is not configured.')

  let body
  try {
    body = await request.json()
  } catch (error) {
    return reject(400, 'Malformed request.')
  }

  const networkId = Number(body?.networkId)
  const chain = solanaChainFor(networkId)
  if (!chain?.hupProgramId) return reject(403, 'The relayer does not sponsor this network.')

  let transaction
  try {
    transaction = Transaction.from(Buffer.from(String(body.transaction ?? ''), 'base64'))
  } catch (error) {
    return reject(400, 'Could not decode the transaction.')
  }

  if (!transaction.feePayer?.equals(keypair.publicKey)) return reject(400, 'The relayer must be the fee payer.')
  if (transaction.instructions.length === 0 || transaction.instructions.length > MAX_SOLANA_BATCH_LIKE + 2) {
    return reject(400, 'Unexpected instruction count.')
  }

  const programId = new PublicKey(chain.hupProgramId)
  let bucket = null
  let owner = null
  let programInstructions = 0

  for (const instruction of transaction.instructions) {
    if (instruction.programId.equals(COMPUTE_BUDGET_PROGRAM)) continue
    if (!instruction.programId.equals(programId)) {
      console.error('SOLANA_RELAY_TARGET_REJECTED:', { networkId, program: instruction.programId.toBase58() })
      return reject(403, 'This call is not sponsored by the relayer.')
    }

    const name = SPONSORED.get(Buffer.from(instruction.data.subarray(0, 8)).toString('hex'))
    if (!name) return reject(403, 'This call is not sponsored by the relayer.')

    // create: [config, creator, payer, treasury, system] — everything else: [config, actor]
    const actor = instruction.keys[1]
    if (!actor?.isSigner) return reject(400, 'The actor must sign.')

    if (name === 'create') {
      const payer = instruction.keys[2]
      if (!payer || payer.pubkey.equals(keypair.publicKey)) return reject(403, 'The author must be the program-fee payer.')
    }

    const instructionBucket = bucketFor(name, instruction.data)
    if (bucket && bucket !== instructionBucket) return reject(400, 'One transaction, one kind of action.')
    if (owner && !owner.equals(actor.pubkey)) return reject(400, 'One transaction, one signer.')

    bucket = instructionBucket
    owner = actor.pubkey
    programInstructions += 1
  }

  if (!bucket || !owner) return reject(400, 'Nothing to sponsor.')
  // Only hearts batch; a transaction carrying several posts is not a shape the app produces
  if (bucket !== 'like' && programInstructions > 1) return reject(400, 'Only likes may be batched.')

  // Whoever is asking us to pay must have signed for it — the signature is checked here, not
  // left to the cluster, so a forged request never costs a simulation
  const ownerSignature = transaction.signatures.find((entry) => entry.publicKey.equals(owner))?.signature
  if (!ownerSignature) return reject(400, 'Missing the signer’s signature.')
  try {
    if (!transaction.verifySignatures(false)) return reject(400, 'Invalid signature.')
  } catch (error) {
    return reject(400, 'Invalid signature.')
  }

  const ownerAddress = owner.toBase58()
  const throttle = peekThrottle(bucket, networkId, ownerAddress)
  if (!throttle.allowed) {
    console.warn('SOLANA_RELAY_THROTTLED:', bucket, ownerAddress, `${throttle.retryAfter}s`)
    return reject(429, `Slow down — you can do that again in ${formatWait(throttle.retryAfter)}.`, { retryAfter: throttle.retryAfter })
  }

  try {
    transaction.partialSign(keypair)
    const signature = await connectionFor(chain).sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    recordThrottleHit(bucket, networkId, ownerAddress)
    return NextResponse.json({ signature, bucket })
  } catch (error) {
    console.error('SOLANA_RELAY_SEND_FAILED:', error.message)
    return reject(502, 'The network rejected the transaction. Please try again.')
  }
}
