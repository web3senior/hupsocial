import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARGON2_PARAMS,
  deriveEvmKeyV2,
  deriveMasterV2,
  KEY_LABELS,
  keyDerivationTypedData,
  masterToHex,
  normalizeSignature,
  passphraseProblem,
  passphraseVerifierV2,
} from './keyDerivationV2.mjs'

// A fixed 65-byte signature (r ‖ low s ‖ v=27), so the vector below never drifts
const R = '11'.repeat(32)
const LOW_S = '22'.repeat(32)
const SIGNATURE = `0x${R}${LOW_S}1b`
const PASSPHRASE = 'orbit-lantern-gravel-mosaic'

// Pinned on first run. If this changes, every v2 user's keys moved: that is a bug, not a vector update.
const EXPECTED_MASTER = '870ab3d2930ba6cdbb59ec29cbf862118e7adcc78de2327a3583469c953153a4'

test('the same signature and passphrase reproduce the same master', async () => {
  const first = await deriveMasterV2({ signature: SIGNATURE, passphrase: PASSPHRASE })
  const second = await deriveMasterV2({ signature: SIGNATURE, passphrase: PASSPHRASE })
  assert.equal(masterToHex(first), masterToHex(second))
  assert.equal(masterToHex(first), EXPECTED_MASTER)
})

test('Argon2id runs at 64 MiB and 3 passes', () => {
  assert.deepEqual({ ...ARGON2_PARAMS }, { t: 3, m: 65536, p: 1, dkLen: 32 })
})

test('changing either input changes the master', async () => {
  const base = masterToHex(await deriveMasterV2({ signature: SIGNATURE, passphrase: PASSPHRASE }))
  const otherPassphrase = masterToHex(await deriveMasterV2({ signature: SIGNATURE, passphrase: 'orbit-lantern-gravel-mosaid' }))
  const otherSig = masterToHex(await deriveMasterV2({ signature: `0x${'12'.repeat(32)}${LOW_S}1b`, passphrase: PASSPHRASE }))
  assert.equal(new Set([base, otherPassphrase, otherSig]).size, 3)
})

test('v encoding and high-s do not move the keys', () => {
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  const highS = (n - BigInt(`0x${LOW_S}`)).toString(16).padStart(64, '0')
  const canonical = Buffer.from(normalizeSignature(SIGNATURE)).toString('hex')

  assert.equal(Buffer.from(normalizeSignature(`0x${R}${LOW_S}00`)).toString('hex'), canonical)
  assert.equal(Buffer.from(normalizeSignature(`0x${R}${highS}1c`)).toString('hex'), canonical)
})

test('a passphrase composed differently is the same passphrase', async () => {
  const composed = masterToHex(await deriveMasterV2({ signature: SIGNATURE, passphrase: 'café-latte-mornings' }))
  const decomposed = masterToHex(await deriveMasterV2({ signature: SIGNATURE, passphrase: 'café-latte-mornings' }))
  assert.equal(composed, decomposed)
})

test('short passphrases are refused at derivation', async () => {
  await assert.rejects(deriveMasterV2({ signature: SIGNATURE, passphrase: '12345678901' }), /at least 12/)
})

test('the strength screen turns away the first guesses an attacker tries', () => {
  for (const weak of ['short', '123456789012', 'abcdefghijklmnop', 'aaaaaaaaaaaaaa', 'abcabcabcabc', 'password1234', 'sunshinelove']) {
    assert.ok(passphraseProblem(weak), `${weak} should be refused`)
  }
  for (const strong of [PASSPHRASE, 'Tr0ub4dor&3xyz', 'abandon-ability-able-about-above-absent']) {
    assert.equal(passphraseProblem(strong), null, `${strong} should pass`)
  }
})

test('each label gets its own key, and the verifier is none of them', async () => {
  const master = await deriveMasterV2({ signature: SIGNATURE, passphrase: PASSPHRASE })
  const keys = [KEY_LABELS.inAppWallet, KEY_LABELS.agent(0), KEY_LABELS.agent(1)].map((label) => deriveEvmKeyV2(master, label))
  assert.equal(new Set([...keys, `0x${passphraseVerifierV2(master)}`]).size, 4)
  keys.forEach((key) => assert.match(key, /^0x[0-9a-f]{64}$/))
})

test('typed data carries no field that would change between sessions', () => {
  const fixed = keyDerivationTypedData('0x20e229667cec8a0e9d3c6fb89693b2a44ec2c50e')
  assert.equal(fixed.domain.chainId, undefined)
  assert.deepEqual(Object.keys(fixed.message).sort(), ['app', 'purpose', 'signer', 'version', 'warning'])
})
