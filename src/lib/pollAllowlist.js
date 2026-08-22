/**
 * @file lib/pollAllowlist.js
 * @description Merkle tree for a poll's allowlisted voters, matching HupPolls.sol exactly.
 *
 * Hand-rolled rather than pulled from a package: the whole thing is thirty lines against
 * viem's keccak256, and a dependency whose hashing convention drifts from the verifier is a
 * silent "nobody can vote" bug rather than a build error.
 *
 * Two conventions must match the contract or every proof fails:
 *   - Leaves are double-hashed — keccak256(keccak256(abi.encode(address))) — per OpenZeppelin's
 *     guidance. A single hash over a 20-byte address leaves the tree open to a second-preimage
 *     attack through its internal nodes.
 *   - Pairs are sorted before hashing, because OZ's MerkleProof hashes commutatively. That is
 *     what lets a proof carry only siblings and no left/right flags.
 */

import { encodeAbiParameters, keccak256 } from 'viem'

/** The tree leaf for one voter. Case-insensitive: addresses are lowercased first. */
export const allowlistLeaf = (address) => keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [address.toLowerCase()])))

// Commutative pair hash — same ordering rule as OZ's _hashPair. Comparing the hex strings is
// equivalent to comparing the bytes here: both are lowercase and the same length.
const hashPair = (a, b) => {
  const [left, right] = a <= b ? [a, b] : [b, a]
  return keccak256(`0x${left.slice(2)}${right.slice(2)}`)
}

/**
 * Deduplicated, sorted leaves — the canonical layer 0. Sorting makes the tree a pure function
 * of the address set, so the root a creator publishes and the proof a voter builds can never
 * disagree because the two loaded the list in a different order.
 * @param {string[]} addresses Voter addresses in any order or case.
 * @returns {string[]} Leaf hashes.
 */
const leavesFor = (addresses) => {
  const unique = [...new Set((addresses || []).map((address) => String(address).toLowerCase()).filter((address) => /^0x[0-9a-f]{40}$/.test(address)))]
  return unique.map(allowlistLeaf).sort()
}

/**
 * Every level of the tree, layer 0 first. An odd node at the end of a layer is promoted
 * unchanged rather than paired with itself — the same rule proofs are generated against.
 */
const layersFor = (leaves) => {
  const layers = [leaves]

  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1]
    const next = []
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i])
    }
    layers.push(next)
  }

  return layers
}

/**
 * Merkle root over an address set, for HupPolls' `allowlistRoot`.
 * @param {string[]} addresses Voter addresses.
 * @returns {string} 32-byte root, or the zero root when the set is empty.
 */
export const allowlistRootFor = (addresses) => {
  const leaves = leavesFor(addresses)
  if (leaves.length === 0) return `0x${'0'.repeat(64)}`

  const layers = layersFor(leaves)
  return layers[layers.length - 1][0]
}

/**
 * Proof that one address belongs to the set, for `vote`.
 * @param {string[]} addresses The same set the root was built from.
 * @param {string} address The voter.
 * @returns {string[]} Sibling hashes, or an empty array when the address is not in the set —
 *   the contract rejects that proof, which is the correct outcome rather than a thrown error.
 */
export const allowlistProofFor = (addresses, address) => {
  const leaves = leavesFor(addresses)
  const target = allowlistLeaf(String(address))

  let index = leaves.indexOf(target)
  if (index < 0) return []

  const layers = layersFor(leaves)
  const proof = []

  for (let level = 0; level < layers.length - 1; level += 1) {
    const current = layers[level]
    const isRight = index % 2 === 1
    const siblingIndex = isRight ? index - 1 : index + 1

    // No sibling means this node was the promoted odd one — it contributes nothing to the path
    if (siblingIndex < current.length) proof.push(current[siblingIndex])
    index = Math.floor(index / 2)
  }

  return proof
}
