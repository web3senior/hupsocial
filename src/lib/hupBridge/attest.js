/**
 * @file lib/hupBridge/attest.js
 * @description The Hup bridge signer. It never sends a transaction: it reads a deposit (or a LUKSO
 * burn) straight off the chain by its transaction hash, waits until it is deep enough, and signs
 * the claim (or release) the user then submits. Stateless: the contracts reject anything already
 * claimed or released, so signing the same event twice is harmless.
 */

import { createPublicClient, encodeAbiParameters, http, isAddress, isHash, keccak256, parseEventLogs, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  BRIDGE_DESTINATION as lukso, CLAIM_TYPES, claimDomain, LUKSO_BRIDGE, LUKSO_CONFIRMATIONS, luksoBridgeAbi,
  RELEASE_TYPES, releaseDomain, sourceFor, vaultAbi,
} from '@/config/hupBridge'
import { BridgeError } from './respond'
import { buildMirrorMetadata } from './metadata'

const same = (left, right) => Boolean(left && right) && left.toLowerCase() === right.toLowerCase()

const clients = new Map()
const clientFor = (chain) => {
  if (!clients.has(chain.id)) clients.set(chain.id, createPublicClient({ chain, transport: http() }))
  return clients.get(chain.id)
}

function signer() {
  const key = process.env.HUP_BRIDGE_SIGNER_PRIVATE_KEY
  if (!key) throw new BridgeError('The bridge signer is not configured', 503)
  return privateKeyToAccount(key)
}

/** JSON-safe: bigints become decimal strings. */
const serialize = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'bigint' ? item.toString() : item]))

/** The receipt and its depth, or a pending/confirming answer the caller polls on. */
async function confirmedReceipt(client, hash, required) {
  if (!isHash(hash)) throw new BridgeError('Expected a transaction hash')
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null)
  if (!receipt) return { receipt: null, wait: { status: 'pending', confirmations: 0, required } }
  if (receipt.status !== 'success') throw new BridgeError('That transaction failed onchain')
  const confirmations = Number((await client.getBlockNumber()) - receipt.blockNumber + 1n)
  return { receipt, confirmations, wait: confirmations < required ? { status: 'confirming', confirmations, required } : null }
}

/**
 * Signs a claim for every Hup bridge deposit in a source-chain transaction.
 * @returns {Promise<{status: 'pending'|'confirming'|'ready', confirmations?: number, required?: number, claims?: Array}>}
 */
export async function attestDeposit({ chainId, txHash }) {
  if (!isAddress(LUKSO_BRIDGE)) throw new BridgeError('The bridge is not live yet', 503)
  const source = sourceFor(chainId)
  if (!source) throw new BridgeError('This chain has no Hup bridge vault')
  const { receipt, confirmations, wait } = await confirmedReceipt(clientFor(source.chain), txHash, source.confirmations)
  if (!receipt) return wait
  const deposits = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: 'Deposited' }).filter((log) => same(log.address, source.vault))
  if (!deposits.length) throw new BridgeError('No Hup bridge deposit in that transaction')
  if (wait) return wait

  const destination = clientFor(lukso)
  const account = signer()
  const claims = await Promise.all(deposits.map(async ({ args }) => {
    const id = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }], [BigInt(source.chain.id), source.vault, args.nonce]))
    const [claimed, mirror] = await Promise.all([
      destination.readContract({ address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'claimed', args: [id] }),
      destination.readContract({ address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'mirrors', args: [BigInt(source.chain.id), args.token] }),
    ])
    // Only the first claim of a token creates its mirror, so only it carries the icon metadata.
    // A failed pin leaves the mirror without one; the owner can set it later.
    const created = mirror[0] !== zeroAddress
    const metadata = created || claimed ? '0x' : await buildMirrorMetadata({ chain: source.chain, token: args.token, name: args.name, symbol: args.symbol }).catch((error) => {
      console.error('[bridge] metadata', error)
      return '0x'
    })
    const claim = {
      sourceChainId: BigInt(source.chain.id), vault: source.vault, depositNonce: args.nonce, sourceToken: args.token, decimals: args.decimals,
      name: args.name, symbol: args.symbol, recipient: args.recipient, amount: args.amount, metadata,
    }
    const signature = await account.signTypedData({ domain: claimDomain(), types: CLAIM_TYPES, primaryType: 'Claim', message: claim })
    return { claim: serialize(claim), signature, claimed, fee: args.fee.toString() }
  }))
  return { status: 'ready', confirmations, claims }
}

/**
 * Signs a release for every burn in a LUKSO transaction.
 * @returns {Promise<{status: 'pending'|'confirming'|'ready', releases?: Array}>}
 */
export async function attestBurn({ txHash }) {
  if (!isAddress(LUKSO_BRIDGE)) throw new BridgeError('The bridge is not live yet', 503)
  const { receipt, confirmations, wait } = await confirmedReceipt(clientFor(lukso), txHash, LUKSO_CONFIRMATIONS)
  if (!receipt) return wait
  const burns = parseEventLogs({ abi: luksoBridgeAbi, logs: receipt.logs, eventName: 'Burned' }).filter((log) => same(log.address, LUKSO_BRIDGE))
  if (!burns.length) throw new BridgeError('No Hup bridge burn in that transaction')
  if (wait) return wait

  const account = signer()
  const releases = await Promise.all(burns.map(async ({ args }) => {
    const source = sourceFor(args.sourceChainId)
    if (!source) throw new BridgeError('That burn names a chain this bridge does not serve')
    const released = await clientFor(source.chain).readContract({ address: source.vault, abi: vaultAbi, functionName: 'released', args: [args.burnId] })
    const release = { burnId: args.burnId, token: args.sourceToken, recipient: args.recipient, amount: args.amount }
    const signature = await account.signTypedData({ domain: releaseDomain(source.chain.id, source.vault), types: RELEASE_TYPES, primaryType: 'Release', message: release })
    return { release: serialize({ ...release, chainId: source.chain.id, vault: source.vault }), signature, released }
  }))
  return { status: 'ready', confirmations, releases }
}
