/**
 * @file lib/solana/relay.js
 * @description Sponsored Solana transactions, the counterpart of lib/relayGasless.js.
 *
 * There is no forwarder contract to go through on Solana: the relayer simply pays the network
 * fee by being the transaction's fee payer. The client builds the transaction with the
 * relayer's key as fee payer, the wallet signs it as the author/actor, and the relay route
 * checks it is one of the sponsored Hup instructions before adding the relayer's signature and
 * broadcasting. The user's gasless preference (Settings) is shared with the EVM relay.
 */
import { readGaslessPreference } from '@/lib/relayGasless'
import { solanaChainFor } from '@/config/solana'
import { signWithWallet } from './wallet'
import { buildSolanaTransaction, confirmSolanaSignature, sendWithSolanaWallet } from './hup'

const RELAY_ENDPOINT = '/api/v1/relay/solana'
const INFO_TTL_MS = 60_000

const infoCache = new Map()

/**
 * Whether the relay sponsors this network, and with which fee payer. Cached for a minute so a
 * feed full of hearts does not ask on every tap; a null answer is cached too.
 * @param {number} networkId
 * @returns {Promise<{feePayer: string, buckets: string[]}|null>}
 */
export const getSolanaRelayInfo = async (networkId) => {
  const id = Number(networkId)
  const cached = infoCache.get(id)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.value

  let value = null
  try {
    const response = await fetch(`${RELAY_ENDPOINT}?network_id=${id}`, { cache: 'no-store' })
    if (response.ok) {
      const payload = await response.json()
      if (payload?.feePayer) value = payload
    }
  } catch (error) {
    console.warn('Solana relay unavailable:', error.message)
  }

  infoCache.set(id, { at: Date.now(), value })
  return value
}

export const isSolanaGaslessEnabled = async (networkId) => readGaslessPreference() && Boolean(await getSolanaRelayInfo(networkId))

const toBase64 = (bytes) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Sends the instructions with the relayer paying the fee. Throws `RELAY_UNSUPPORTED` when the
 * relay does not serve the network and `RELAY_COOLDOWN` (with retryAfter) when the caller is
 * throttled — callers decide whether that falls back to the wallet.
 * @param {{networkId: number, signer: {wallet: object, account: object}, instructions: Array}} params
 * @returns {Promise<string>} base58 signature
 */
export const relaySolanaInstructions = async ({ networkId, signer, instructions }) => {
  const info = await getSolanaRelayInfo(networkId)
  if (!info) throw Object.assign(new Error('The relayer does not sponsor this network'), { code: 'RELAY_UNSUPPORTED' })

  const { wallet, account } = signer
  const transaction = await buildSolanaTransaction({ networkId, instructions, feePayer: info.feePayer })
  const signed = await signWithWallet(wallet, account, transaction, solanaChainFor(networkId).walletChain)

  const response = await fetch(RELAY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ networkId: Number(networkId), transaction: toBase64(signed) }),
  })
  const payload = await response.json().catch(() => ({}))

  if (response.status === 429) {
    throw Object.assign(new Error(payload.error || 'Slow down — try again in a moment.'), {
      code: 'RELAY_COOLDOWN',
      retryAfter: Number(payload.retryAfter) || 0,
    })
  }
  if (!response.ok) throw new Error(payload.error || 'The relayer rejected the transaction')

  return payload.signature
}

/**
 * The one call every Solana write path makes: sponsored when the relay serves the network and
 * the user has not turned gasless off, otherwise signed and paid by the wallet. Confirms before
 * returning so callers can treat the result like a mined receipt.
 * @param {object} params
 * @param {number} params.networkId
 * @param {{wallet: object, account: object}} params.signer
 * @param {Array} params.instructions
 * @param {'throw'|'fallback'} [params.onCooldown='fallback'] - Posting rethrows a cooldown (the author was told to wait); hearts fall through to the wallet, where the prompt is consent to pay.
 * @param {boolean} [params.sponsor=true] - False for actions the relay never covers (edits, deletes), which skips the round trip.
 * @param {boolean} [params.confirm=true]
 * @returns {Promise<{signature: string, sponsored: boolean}>}
 */
export const sendHupAction = async ({ networkId, signer, instructions, onCooldown = 'fallback', sponsor = true, confirm = true }) => {
  let signature = null
  let sponsored = false

  if (sponsor && (await isSolanaGaslessEnabled(networkId))) {
    try {
      signature = await relaySolanaInstructions({ networkId, signer, instructions })
      sponsored = true
    } catch (error) {
      if (error.code === 'RELAY_COOLDOWN' && onCooldown === 'throw') throw error
      // A relayer hiccup is never fatal — the wallet path still works, so this only decides
      // who pays
      console.warn('Solana relay unavailable:', error.message)
    }
  }

  if (!signature) signature = await sendWithSolanaWallet({ networkId, signer, instructions })
  if (confirm) await confirmSolanaSignature(networkId, signature)

  return { signature, sponsored }
}
