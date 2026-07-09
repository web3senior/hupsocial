// Unified security vault: ONE wallet signature + ONE PIN unlock the master secret, and every
// PIN-protected feature derives its own child key from that master with a domain label — so a
// new encrypted feature never needs its own PIN prompt or signature again, it just picks a label.
//
// Master:  PBKDF2(pin, signature("Hup Security Key" message))          -> 32 bytes, cached per tab
// Child:   PBKDF2(masterHex, "hup:<feature>:v1")                       -> 32 bytes, derived on demand
//
// Child derivation is one-way: leaking one child key reveals nothing about the master or its
// sibling keys. Chat's identity key is deliberately NOT part of this system — it's signature-only,
// already live for every existing Chat user, and re-keying it would break their message history.

import { ethers } from 'ethers'
import { Buffer } from 'buffer'
import { deriveRawBits } from './cryptoHelper'

const MASTER_MESSAGE_VERSION = 'v1'

export const CHILD_KEY_LABELS = {
  communityVault: 'hup:community-vault:v1',
  inAppWallet: 'hup:in-app-wallet:v1',
}

export const masterSecretSessionKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''}security_vault_master`

function buildMasterMessage(address) {
  return [
    'Hup - Security Key Authorization',
    '',
    'By signing this message, you are generating the master encryption key that protects your',
    'Hup features (private communities, in-app wallet, ...). This signature does not authorize',
    'any token transfers or on-chain actions.',
    '',
    `Wallet: ${address.toLowerCase()}`,
    `Version: ${MASTER_MESSAGE_VERSION}`,
  ].join('\n')
}

export function getCachedMasterHex() {
  return sessionStorage.getItem(masterSecretSessionKey)
}

export function clearMasterSecret() {
  sessionStorage.removeItem(masterSecretSessionKey)
}

/**
 * Returns the master secret hex, deriving and caching it if not already unlocked this session.
 * Only prompts for a signature when nothing is cached — a vault unlocked by any feature stays
 * unlocked for all of them.
 * @param {string} address - the connected wallet address
 * @param {string} pin - the user's security PIN (min 6 chars, enforced by caller's UI)
 * @param {(args: { message: string }) => Promise<string>} signMessageAsync - wagmi's useSignMessage().signMessageAsync
 */
export async function unlockMaster(address, pin, signMessageAsync) {
  const cached = getCachedMasterHex()
  if (cached) return cached

  const message = buildMasterMessage(address)
  const signature = await signMessageAsync({ message })
  const masterBytes = await deriveRawBits(pin, ethers.getBytes(signature))
  const masterHex = Buffer.from(masterBytes).toString('hex')

  sessionStorage.setItem(masterSecretSessionKey, masterHex)
  return masterHex
}

/**
 * Derives a feature's 32-byte child key from the master secret. Same PBKDF2 primitive as the
 * master derivation, with the feature's domain label as the salt.
 * @param {string} masterHex - unlocked master secret (from unlockMaster/getCachedMasterHex)
 * @param {string} label - one of CHILD_KEY_LABELS
 */
export async function deriveChildKeyBytes(masterHex, label) {
  const enc = new TextEncoder()
  return deriveRawBits(masterHex, enc.encode(label))
}
