/**
 * @file mcp/src/taskCrypto.js
 * Sealed task submissions, byte-compatible with the app's lib/taskVault.js: the reply body is
 * AES-256-GCM encrypted under a fresh key, and that key is ECIES-wrapped to the task's public key.
 * The poster later publishes the raw key onchain to make an approved submission public.
 */

import { webcrypto } from 'node:crypto'
import * as ecies from 'eciesjs'
import { concat, keccak256, toBytes } from 'viem'

const subtle = webcrypto.subtle
const TASK_VAULT_LABEL = 'hup:task-vault:v1'

const hexToBytes = (hex) => Buffer.from(String(hex).replace(/^0x/, ''), 'hex')
const withPrefix = (hex) => (String(hex).startsWith('0x') ? hex : `0x${hex}`)

/** The agent's task identity, derived from its wallet key so it is reproducible anywhere. */
export function taskIdentityFromKey(privateKey) {
  const seed = hexToBytes(keccak256(concat([toBytes(TASK_VAULT_LABEL), toBytes(privateKey)])))
  const key = new ecies.PrivateKey(seed)
  return { privKeyHex: seed.toString('hex'), pubKeyHex: withPrefix(key.publicKey.toHex(false)) }
}

async function encryptJson(rawKey, value) {
  const key = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') }
}

async function decryptJson(rawKey, ivBase64, ciphertextBase64) {
  const key = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(ivBase64, 'base64') }, key, Buffer.from(ciphertextBase64, 'base64'))
  return JSON.parse(new TextDecoder().decode(plain))
}

/** @returns {Promise<{ v: 1, iv: string, ciphertext: string, wrappedKey: string }>} */
export async function sealSubmission(plainContent, taskPubKeyHex) {
  const contentKey = webcrypto.getRandomValues(new Uint8Array(32))
  const { iv, ciphertext } = await encryptJson(contentKey, plainContent)
  const wrapped = ecies.encrypt(withPrefix(taskPubKeyHex), Buffer.from(contentKey))
  return { v: 1, iv, ciphertext, wrappedKey: `0x${Buffer.from(wrapped).toString('hex')}` }
}

/** The raw content key of a sealed submission, as HupTasks publishes it on approval. */
export function submissionKeyHex(envelope, privKeyHex) {
  return `0x${Buffer.from(ecies.decrypt(hexToBytes(privKeyHex), hexToBytes(envelope.wrappedKey))).toString('hex')}`
}

export async function openSubmission(envelope, privKeyHex) {
  const key = ecies.decrypt(hexToBytes(privKeyHex), hexToBytes(envelope.wrappedKey))
  return decryptJson(new Uint8Array(key), envelope.iv, envelope.ciphertext)
}

export async function openRevealedSubmission(envelope, revealKeyHex) {
  return decryptJson(new Uint8Array(hexToBytes(revealKeyHex)), envelope.iv, envelope.ciphertext)
}
