/**
 * @file lib/keyDerivationV2.mjs
 * @description Key Vault v2: the derivation behind recoverable agent wallets and the v2 in-app
 * wallet. Pure and isomorphic on purpose — the browser derives, and node:test pins the vectors so
 * a refactor can never quietly move anyone's keys.
 *
 *   sig     = signTypedData(KeyDerivation)            fixed, so it reproduces on every device
 *   seed    = HKDF-SHA256(sig, "hup:seed:v2")
 *   master  = Argon2id(passphrase, salt = seed)
 *   child   = HKDF-SHA256(master, label)
 *
 * Nothing is stored anywhere: the wallet and the passphrase are the whole key, so Hup can neither
 * lose it nor be made to hand it over. The cost is that nothing rate-limits guesses — whoever
 * phishes the fixed signature can try passphrases offline, checking each against a public agent
 * address. The passphrase rules and the Argon2id cost below are what stand against that.
 */

import { argon2idAsync } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

// --- Parameters ---

export const KEY_VAULT_VERSION = 2

/** With no server to count wrong guesses, the passphrase alone has to outlast an offline attack. */
export const PASSPHRASE_MIN_LENGTH = 12

/* 64 MiB and 3 passes: under a second on a laptop, a few on a phone, and about three times the
   cost per guess of OWASP's floor. Changing any of these moves every v2 key, which is why the
   test pins them through the vectors. */
export const ARGON2_PARAMS = Object.freeze({ t: 3, m: 65536, p: 1, dkLen: 32 })

export const KEY_LABELS = Object.freeze({
  inAppWallet: 'hup:in-app-wallet:v2',
  verifier: 'hup:verifier:v2',
  legacyWrap: 'hup:legacy-master-wrap:v2',
  agent: (index) => `hup:agent:${Number(index)}:v2`,
  // Encrypts the agent's workspace snapshots onchain; a separate key from its wallet's
  agentWorkspace: (index) => `hup:agent:${Number(index)}:workspace:v2`,
  // Encrypts the keys of agents made from an existing wallet, which cannot be derived
  importedAgentKeys: 'hup:imported-agent-keys:v2',
})

// secp256k1 group order: a private key must sit in [1, n), and a signature's s is normalized to
// the lower half so two wallets that disagree on high-s still derive the same keys
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_HALF_N = SECP256K1_N >> 1n

// --- Typed data ---

const KEY_DERIVATION_TYPES = {
  KeyDerivation: [
    { name: 'app', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'version', type: 'uint256' },
    { name: 'warning', type: 'string' },
  ],
}

export const KEY_APP_ORIGIN = 'https://hup.social'

/**
 * The fixed message whose signature seeds every v2 key. No nonce, no deadline and no chainId by
 * design — any of them would change the signature, and with it every derived address.
 * @param {string} address The connected wallet.
 */
export const keyDerivationTypedData = (address) => ({
  domain: { name: 'Hup Key Derivation', version: String(KEY_VAULT_VERSION) },
  types: KEY_DERIVATION_TYPES,
  primaryType: 'KeyDerivation',
  message: {
    app: KEY_APP_ORIGIN,
    signer: address,
    purpose: 'hup-security-master',
    version: BigInt(KEY_VAULT_VERSION),
    warning: 'Only sign this on hup.social. Anyone holding this signature can try to guess your Hup passphrase.',
  },
})

// --- Passphrase ---

const COMMON_PASSPHRASES = new Set([
  'password1234',
  'passwordpassword',
  'qwertyuiopasdf',
  'iloveyouiloveyou',
  'correcthorsebatterystaple',
  'letmeinletmein',
  'welcome123456',
])

/** Whether every step between neighbours is the same small one: "abcdef", "987654", "aaaa". */
const isRun = (text) => {
  if (text.length < 4) return false
  const step = text.charCodeAt(1) - text.charCodeAt(0)
  if (Math.abs(step) > 1) return false
  for (let i = 2; i < text.length; i += 1) if (text.charCodeAt(i) - text.charCodeAt(i - 1) !== step) return false
  return true
}

/** Whether the text is one shorter piece repeated: "abcabcabcabc". */
const isRepeat = (text) => {
  for (let size = 1; size <= text.length / 2; size += 1) {
    if (text.length % size === 0 && text.slice(0, size).repeat(text.length / size) === text) return true
  }
  return false
}

/** A rough upper bound on guessing work, in bits: length × log2 of the character pool used. */
const estimateBits = (text) => {
  let pool = 0
  if (/[a-z]/.test(text)) pool += 26
  if (/[A-Z]/.test(text)) pool += 26
  if (/[0-9]/.test(text)) pool += 10
  if (/[^a-zA-Z0-9]/.test(text)) pool += 33
  return text.length * Math.log2(Math.max(pool, 1))
}

/**
 * Why a passphrase is too weak to stand alone, or null when it will do. A screen, not a proof:
 * it turns away the guesses an attacker tries first (short, repeated, sequential, famous) and
 * anything whose character pool cannot reach ~60 bits at that length.
 * @param {string} passphrase
 * @returns {string|null}
 */
export const passphraseProblem = (passphrase) => {
  const text = typeof passphrase === 'string' ? passphrase.normalize('NFKC') : ''
  const folded = text.toLowerCase().replace(/[\s\-_.]/g, '')

  if (text.length < PASSPHRASE_MIN_LENGTH) return `Use at least ${PASSPHRASE_MIN_LENGTH} characters.`
  if (new Set(folded).size < 6 || isRepeat(folded) || isRun(folded)) return 'Too predictable. Avoid repeats and sequences.'
  if (COMMON_PASSPHRASES.has(folded)) return 'That one is well known. Choose another.'
  if (estimateBits(text) < 60) return 'Too easy to guess. Make it longer, or mix in capitals, digits or symbols.'
  return null
}

// --- Derivation ---

const toBytes = (value) => (typeof value === 'string' ? hexToBytes(value.replace(/^0x/, '')) : value)

/**
 * The part of a signature that is stable for one key and one message. A 65-byte ECDSA signature
 * keeps r and the low-s form of s and drops v, whose encoding (0/1 vs 27/28) differs between
 * wallets. Anything else — a contract account's signature — is taken whole.
 * @param {string|Uint8Array} signature
 */
export const normalizeSignature = (signature) => {
  const bytes = toBytes(signature)
  if (bytes.length !== 65) return bytes

  const r = bytes.slice(0, 32)
  let s = BigInt(`0x${bytesToHex(bytes.slice(32, 64))}`)
  if (s > SECP256K1_HALF_N) s = SECP256K1_N - s
  return concatBytes(r, hexToBytes(s.toString(16).padStart(64, '0')))
}

/**
 * The v2 master secret. Length is enforced here; strength is the caller's screen
 * (passphraseProblem), so a rule tightened later never locks anyone out of existing keys.
 * @param {{signature: string|Uint8Array, passphrase: string}} inputs
 * @returns {Promise<Uint8Array>} 32 bytes.
 */
export const deriveMasterV2 = async ({ signature, passphrase }) => {
  if (typeof passphrase !== 'string' || passphrase.normalize('NFKC').length < PASSPHRASE_MIN_LENGTH) {
    throw new Error(`Passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters`)
  }

  const seed = hkdf(sha256, normalizeSignature(signature), undefined, utf8ToBytes('hup:seed:v2'), 32)
  // NFKC so the same passphrase typed on two keyboards (full-width digits, composed accents) is one
  return argon2idAsync(utf8ToBytes(passphrase.normalize('NFKC')), seed, { ...ARGON2_PARAMS, asyncTick: 10 })
}

/** A 32-byte child secret for one purpose. One-way: a leaked child says nothing of the master. */
export const deriveChildV2 = (master, label) => hkdf(sha256, toBytes(master), undefined, utf8ToBytes(label), 32)

/**
 * An EVM private key for one purpose. HKDF output lands outside [1, n) about once in 2^128 draws;
 * the counter makes that case deterministic instead of fatal.
 * @returns {string} 0x-prefixed hex private key.
 */
export const deriveEvmKeyV2 = (master, label) => {
  for (let counter = 0; counter < 256; counter += 1) {
    const candidate = deriveChildV2(master, counter === 0 ? label : `${label}#${counter}`)
    const scalar = BigInt(`0x${bytesToHex(candidate)}`)
    if (scalar > 0n && scalar < SECP256K1_N) return `0x${bytesToHex(candidate)}`
  }
  throw new Error('Could not derive a valid key')
}

/** What this device keeps to spot a mistyped passphrase. Derives nothing without the signature. */
export const passphraseVerifierV2 = (master) => bytesToHex(deriveChildV2(master, KEY_LABELS.verifier))

export const masterToHex = (master) => bytesToHex(toBytes(master))
