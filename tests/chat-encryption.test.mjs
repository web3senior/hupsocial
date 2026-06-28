/**
 * Tests for the ECDH-based chat room derivation and AES-GCM message encryption.
 *
 * Run:  node --test tests/chat-encryption.test.mjs
 *
 * These tests exercise the pure cryptographic logic extracted from
 * src/app/chat/_components/Chat.jsx (deriveRoomFromPeerKey + content key
 * derivation) without requiring React, Next.js, or any network calls.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ethers } from 'ethers'
import { webcrypto } from 'node:crypto'

const { subtle } = webcrypto

// ─── Test wallets ─────────────────────────────────────────────────────────────
// Hardhat/Anvil default private keys — well-known, never used on mainnet.

const ALICE_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const BOB_PRIV = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const CHARLIE_PRIV = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

const aliceSK = new ethers.SigningKey(ALICE_PRIV)
const bobSK = new ethers.SigningKey(BOB_PRIV)
const charlieSK = new ethers.SigningKey(CHARLIE_PRIV)

// Uncompressed public keys (04‖x‖y) — ethers v6 stores this directly in .publicKey
const ALICE_PUB = aliceSK.publicKey
const BOB_PUB = bobSK.publicKey
const CHARLIE_PUB = charlieSK.publicKey

// Wallet addresses (public information anyone can observe on-chain)
const ALICE_ADDR = ethers.computeAddress(aliceSK.publicKey)
const BOB_ADDR = ethers.computeAddress(bobSK.publicKey)

// ─── Functions under test ─────────────────────────────────────────────────────
// Extracted verbatim from Chat.jsx so the tests remain independent of React.

function deriveRoomFromPeerKey(privKeyHex, peerPublicKey) {
  const normalizedPrivKey = privKeyHex.startsWith('0x') ? privKeyHex : `0x${privKeyHex}`
  const signingKey = new ethers.SigningKey(normalizedPrivKey)
  const secret = signingKey.computeSharedSecret(peerPublicKey)
  const pairHash = ethers.keccak256(secret)
  return {
    topic: pairHash,
    stealthAddress: ethers.getAddress(ethers.dataSlice(pairHash, 12)),
  }
}

// The broken old approach (address-sorted hash) — kept to prove it is different.
function oldDeriveFromAddresses(addrA, addrB) {
  const [a, b] = [addrA.toLowerCase(), addrB.toLowerCase()].sort()
  const pairHash = ethers.keccak256(ethers.solidityPacked(['address', 'address'], [a, b]))
  return {
    topic: pairHash,
    stealthAddress: ethers.getAddress(ethers.dataSlice(pairHash, 12)),
  }
}

async function contentKeyFromTopic(topic) {
  const seed = ethers.keccak256(ethers.concat([topic, ethers.toUtf8Bytes('content-encryption')]))
  return subtle.importKey('raw', ethers.getBytes(seed), 'AES-GCM', true, ['encrypt', 'decrypt'])
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('deriveRoomFromPeerKey — ECDH room derivation', () => {
  test('Alice and Bob independently derive the same topic', () => {
    const aliceView = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const bobView = deriveRoomFromPeerKey(BOB_PRIV, ALICE_PUB)

    assert.equal(aliceView.topic, bobView.topic, 'ECDH(alice_priv, bob_pub) must equal ECDH(bob_priv, alice_pub)')
  })

  test('Alice and Bob derive the same stealthAddress', () => {
    const aliceView = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const bobView = deriveRoomFromPeerKey(BOB_PRIV, ALICE_PUB)

    assert.equal(aliceView.stealthAddress, bobView.stealthAddress)
  })

  test('ECDH topic differs from old address-sorted hash', () => {
    const ecdhRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const addrRoom = oldDeriveFromAddresses(ALICE_ADDR, BOB_ADDR)

    assert.notEqual(
      ecdhRoom.topic,
      addrRoom.topic,
      'ECDH must not equal keccak256(sort(addrA, addrB)) — the old method leaked the relationship'
    )
    assert.notEqual(ecdhRoom.stealthAddress, addrRoom.stealthAddress)
  })

  test('Charlie cannot guess Alice-Bob room from their public addresses', () => {
    // Charlie knows both wallet addresses — they are visible on-chain.
    // Attempt to reconstruct the meeting point using only that public info.
    const charlieGuess = oldDeriveFromAddresses(ALICE_ADDR, BOB_ADDR)
    const realRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)

    assert.notEqual(charlieGuess.topic, realRoom.topic, 'public addresses must not reveal the private ECDH room')
    assert.notEqual(charlieGuess.stealthAddress, realRoom.stealthAddress)
  })

  test('Alice-Bob room is isolated from Alice-Charlie room', () => {
    const aliceBob = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const aliceCharlie = deriveRoomFromPeerKey(ALICE_PRIV, CHARLIE_PUB)

    assert.notEqual(aliceBob.topic, aliceCharlie.topic, 'different peers must produce different rooms')
    assert.notEqual(aliceBob.stealthAddress, aliceCharlie.stealthAddress)
  })

  test('stealthAddress is a valid EIP-55 checksummed address', () => {
    const { stealthAddress } = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)

    assert.match(stealthAddress, /^0x[0-9a-fA-F]{40}$/)
    assert.equal(stealthAddress, ethers.getAddress(stealthAddress), 'must be EIP-55 checksummed')
  })

  test('topic is a 32-byte hex string', () => {
    const { topic } = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)

    assert.match(topic, /^0x[0-9a-f]{64}$/)
  })
})

describe('content encryption — AES-GCM with ECDH-derived key', () => {
  test('Alice encrypts, Bob decrypts the same plaintext', async () => {
    const aliceRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const bobRoom = deriveRoomFromPeerKey(BOB_PRIV, ALICE_PUB)

    const encKey = await contentKeyFromTopic(aliceRoom.topic)
    const decKey = await contentKeyFromTopic(bobRoom.topic)

    const payload = JSON.stringify({ version: '1', elements: [{ type: 'text', data: { text: 'Hello Bob!' } }] })
    const plaintext = new TextEncoder().encode(payload)
    const iv = webcrypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, plaintext)
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ciphertext)

    assert.deepEqual(new Uint8Array(decrypted), plaintext, "Bob must recover Alice's plaintext exactly")
  })

  test('Bob encrypts, Alice decrypts (reverse direction)', async () => {
    const aliceRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const bobRoom = deriveRoomFromPeerKey(BOB_PRIV, ALICE_PUB)

    const encKey = await contentKeyFromTopic(bobRoom.topic)
    const decKey = await contentKeyFromTopic(aliceRoom.topic)

    const plaintext = new TextEncoder().encode('Hey Alice!')
    const iv = webcrypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, plaintext)
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ciphertext)

    assert.equal(new TextDecoder().decode(decrypted), 'Hey Alice!')
  })

  test('Charlie cannot decrypt Alice-Bob messages', async () => {
    const aliceRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const charlieRoom = deriveRoomFromPeerKey(CHARLIE_PRIV, ALICE_PUB)

    const aliceKey_ = await contentKeyFromTopic(aliceRoom.topic)
    const charlieKey_ = await contentKeyFromTopic(charlieRoom.topic)

    const plaintext = new TextEncoder().encode('private message')
    const iv = webcrypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, aliceKey_, plaintext)

    await assert.rejects(
      () => subtle.decrypt({ name: 'AES-GCM', iv }, charlieKey_, ciphertext),
      "Charlie's wrong key must cause AES-GCM authentication to fail"
    )
  })

  test('round-trip preserves structured message payload', async () => {
    const aliceRoom = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const bobRoom = deriveRoomFromPeerKey(BOB_PRIV, ALICE_PUB)

    const encKey = await contentKeyFromTopic(aliceRoom.topic)
    const decKey = await contentKeyFromTopic(bobRoom.topic)

    const original = {
      version: '1',
      elements: [
        { type: 'text', data: { text: 'Meeting at noon' } },
        { type: 'text', data: { text: 'Bring the docs' } },
      ],
    }

    const iv = webcrypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, new TextEncoder().encode(JSON.stringify(original)))
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ciphertext)
    const recovered = JSON.parse(new TextDecoder().decode(decrypted))

    assert.deepEqual(recovered, original)
  })

  test('same key reused across multiple messages (IV uniqueness)', async () => {
    // The content key is static per-conversation; safety relies on unique IVs per message.
    const room = deriveRoomFromPeerKey(ALICE_PRIV, BOB_PUB)
    const key = await contentKeyFromTopic(room.topic)

    const messages = ['msg one', 'msg two', 'msg three']
    const ivs = messages.map(() => webcrypto.getRandomValues(new Uint8Array(12)))

    // All IVs must be distinct (extremely unlikely to collide with 96 random bits)
    const ivHexes = ivs.map((iv) => ethers.hexlify(iv))
    const uniqueIVs = new Set(ivHexes)
    assert.equal(uniqueIVs.size, messages.length, 'generated IVs must be unique')

    // All messages must encrypt and decrypt independently
    for (let i = 0; i < messages.length; i++) {
      const pt = new TextEncoder().encode(messages[i])
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv: ivs[i] }, key, pt)
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv: ivs[i] }, key, ct)
      assert.equal(new TextDecoder().decode(dec), messages[i])
    }
  })
})
