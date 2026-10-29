import { createPublicKey, verify } from 'node:crypto'
import bs58 from 'bs58'

export function verifySolanaBlockSignature(address, message, signature) {
  try {
    const publicKey = bs58.decode(address)
    const signed = bs58.decode(signature)
    if (publicKey.length !== 32 || signed.length !== 64) return false
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(message), key, signed)
  } catch {
    return false
  }
}
