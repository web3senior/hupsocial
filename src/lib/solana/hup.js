/**
 * @file lib/solana/hup.js
 * @description Client for the Hup program on Solana: the config account, instruction encoding
 * and sending/confirming through a Wallet Standard wallet.
 *
 * Instructions are encoded by hand (8-byte Anchor discriminator + Borsh args) against the
 * layouts in src/contracts/solana/hup/programs/hup/src/lib.rs, so the app carries no Anchor
 * runtime. The account order of each instruction is the contract with the program and with
 * the relay route, which reads the actor and payer back out by index.
 */
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { HUP_SOLANA_CONFIG_SEED, HUP_SOLANA_DISCRIMINATORS, solanaChainFor } from '@/config/solana'
import { signAndSendWithWallet, signWithWallet } from './wallet'

const CONFIG_TTL_MS = 5 * 60 * 1000

const connections = new Map()
const configCache = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toKey = (value) => (value instanceof PublicKey ? value : new PublicKey(value))

/** One connection per cluster, shared by every caller. */
export const getSolanaConnection = (networkId) => {
  const chain = solanaChainFor(networkId)
  if (!chain) throw new Error(`Unknown Solana network ${networkId}`)

  if (!connections.has(chain.id)) connections.set(chain.id, new Connection(chain.rpcUrl, { commitment: 'confirmed' }))
  return connections.get(chain.id)
}

export const hupProgramIdFor = (networkId) => {
  const chain = solanaChainFor(networkId)
  if (!chain?.hupProgramId) throw new Error('Hup is not deployed on this Solana network yet')
  return new PublicKey(chain.hupProgramId)
}

export const hupConfigPdaFor = (networkId) =>
  PublicKey.findProgramAddressSync([new TextEncoder().encode(HUP_SOLANA_CONFIG_SEED)], hupProgramIdFor(networkId))[0]

/**
 * The program's config account: 8-byte discriminator, admin, treasury, fee_lamports, next_id,
 * max_metadata_bytes, paused, bump. Cached briefly — the treasury it carries is needed on every
 * create, and it changes only by admin action.
 * @param {number} networkId
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{admin: string, treasury: string, feeLamports: bigint, nextId: bigint, maxMetadataBytes: number, paused: boolean}>}
 */
export const readHupConfig = async (networkId, { force = false } = {}) => {
  const id = Number(networkId)
  const cached = configCache.get(id)
  if (!force && cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value

  const info = await getSolanaConnection(id).getAccountInfo(hupConfigPdaFor(id))
  if (!info) throw new Error('Hup is not initialized on this Solana network yet')

  const data = info.data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const value = {
    admin: new PublicKey(data.subarray(8, 40)).toBase58(),
    treasury: new PublicKey(data.subarray(40, 72)).toBase58(),
    feeLamports: view.getBigUint64(72, true),
    nextId: view.getBigUint64(80, true),
    maxMetadataBytes: view.getUint16(88, true),
    paused: data[90] === 1,
  }

  configCache.set(id, { at: Date.now(), value })
  return value
}

// --- Borsh encoding ---

const concat = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const u8 = (value) => Uint8Array.of(Number(value) & 0xff)
const bool = (value) => Uint8Array.of(value ? 1 : 0)
const u64 = (value) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return bytes
}
const string = (value) => {
  const utf8 = new TextEncoder().encode(value ?? '')
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, utf8.length, true)
  return concat([length, utf8])
}

const meta = (pubkey, { signer = false, writable = false } = {}) => ({ pubkey: toKey(pubkey), isSigner: signer, isWritable: writable })

const build = (networkId, keys, parts) =>
  new TransactionInstruction({
    programId: hupProgramIdFor(networkId),
    keys,
    data: Buffer.from(concat([Uint8Array.from(HUP_SOLANA_DISCRIMINATORS[parts[0]]), ...parts.slice(1)])),
  })

// update / delete / like / unlike all read the config and take one signer
const actKeys = (networkId, actor) => [meta(hupConfigPdaFor(networkId)), meta(actor, { signer: true })]

/**
 * Instruction builders. Addresses may be base58 strings or PublicKeys; ids are numbers,
 * strings or bigints.
 */
export const hupInstruction = {
  /**
   * `creator` is who the content is attributed to; `payer` funds the program fee (0 today) and
   * defaults to the creator — a sponsored post keeps the creator as payer so the relayer only
   * ever covers the network fee.
   */
  create: ({ networkId, creator, payer = creator, treasury, kind, parentId = 0, metadata = '', allowComments = true }) =>
    build(
      networkId,
      [
        meta(hupConfigPdaFor(networkId), { writable: true }),
        meta(creator, { signer: true }),
        meta(payer, { signer: true, writable: true }),
        meta(treasury, { writable: true }),
        meta(SystemProgram.programId),
      ],
      ['create', u8(kind), u64(parentId), string(metadata), bool(allowComments)],
    ),

  update: ({ networkId, actor, id, metadata, allowComments }) =>
    build(networkId, actKeys(networkId, actor), ['update', u64(id), string(metadata), bool(allowComments)]),

  delete: ({ networkId, actor, id }) => build(networkId, actKeys(networkId, actor), ['delete', u64(id)]),

  like: ({ networkId, actor, id }) => build(networkId, actKeys(networkId, actor), ['like', u64(id)]),

  unlike: ({ networkId, actor, id }) => build(networkId, actKeys(networkId, actor), ['unlike', u64(id)]),
}

/**
 * A legacy transaction with a fresh blockhash, ready for a wallet to sign.
 * @param {{networkId: number, instructions: TransactionInstruction[], feePayer: string|PublicKey}} params
 * @returns {Promise<Transaction>}
 */
export const buildSolanaTransaction = async ({ networkId, instructions, feePayer }) => {
  const { blockhash, lastValidBlockHeight } = await getSolanaConnection(networkId).getLatestBlockhash('confirmed')
  const transaction = new Transaction({ feePayer: toKey(feePayer), blockhash, lastValidBlockHeight })
  transaction.add(...instructions)
  return transaction
}

/**
 * Signs through the connected wallet, which pays the network fee, and broadcasts from here.
 *
 * The wallet only signs: a wallet that broadcasts on the user's behalf routes by its own network
 * setting (Phantom refuses devnet unless its "testnet mode" is on), while a plain signature works
 * everywhere — and it is the same call the relay path already relies on. Wallets without
 * `solana:signTransaction` fall back to sending themselves.
 * @param {{networkId: number, signer: {wallet: object, account: object}, instructions: TransactionInstruction[]}} params
 * @returns {Promise<string>} base58 signature
 */
export const sendWithSolanaWallet = async ({ networkId, signer, instructions }) => {
  const { wallet, account } = signer
  const chain = solanaChainFor(networkId)
  const transaction = await buildSolanaTransaction({ networkId, instructions, feePayer: account.address })

  if (!wallet.features?.['solana:signTransaction']) {
    return signAndSendWithWallet(wallet, account, transaction, chain.walletChain)
  }

  const signed = await signWithWallet(wallet, account, transaction, chain.walletChain)
  return getSolanaConnection(networkId).sendRawTransaction(signed, { skipPreflight: false, preflightCommitment: 'confirmed' })
}

/**
 * Waits until the cluster reports the signature confirmed (or finalized), and throws if the
 * transaction failed onchain.
 * @param {number} networkId
 * @param {string} signature
 * @param {{timeoutMs?: number, intervalMs?: number}} [options]
 */
export const confirmSolanaSignature = async (networkId, signature, { timeoutMs = 90_000, intervalMs = 2_000 } = {}) => {
  const connection = getSolanaConnection(networkId)
  const deadline = Date.now() + timeoutMs

  for (;;) {
    // The public RPCs rate-limit aggressively (429); a failed poll is not a failed transaction,
    // so it is retried until the deadline rather than surfaced as one
    let status = null
    try {
      const { value } = await connection.getSignatureStatuses([signature])
      status = value?.[0] ?? null
    } catch (error) {
      console.warn('Solana status poll failed, retrying:', error.message)
    }

    // Both exits throw, so the code is what lets a caller tell "the cluster refused this" from
    // "the cluster never answered" — only the first is evidence the transaction failed
    if (status?.err) throw Object.assign(new Error(`Transaction failed onchain: ${JSON.stringify(status.err)}`), { code: 'TX_REVERTED' })
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return status
    if (Date.now() > deadline) throw Object.assign(new Error('Timed out waiting for the Solana transaction to confirm'), { code: 'TX_TIMEOUT' })

    await sleep(intervalMs)
  }
}
