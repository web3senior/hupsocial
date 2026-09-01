/**
 * @file lib/collectionProbe.js
 * @description Works out what a pasted contract address is, and what of its metadata the
 * connected wallet is actually allowed to change.
 *
 * The point is to answer honestly for collections nobody here deployed. On LUKSO that is
 * straightforward: every LSP7 and LSP8 is ERC725Y, so `setData` is guaranteed present and
 * owner-gated whatever tool minted the asset. On the ERC side there is no such guarantee —
 * `setBaseURI` is an OpenZeppelin convention, not part of ERC721 — so the only truthful way to
 * know is to look for the selector in the deployed bytecode and say plainly when it is absent.
 * A collection that cannot be edited should be reported as immutable, never offered an editor
 * that will revert.
 */

import { keccak256, toHex } from 'viem'

// --- what a contract says it is ---

export const INTERFACE_IDS = {
  LSP8: '0x3a271706',
  LSP7: '0xc52d6008',
  ERC725Y: '0x629aa694',
  ERC721: '0x80ac58cd',
  ERC721Metadata: '0x5b5e139f',
  ERC1155: '0xd9b67a26',
}

export const COLLECTION_KIND = {
  LSP8: 'lsp8',
  LSP7: 'lsp7',
  ERC721: 'erc721',
  ERC1155: 'erc1155',
  UNKNOWN: 'unknown',
}

export const KIND_LABEL = {
  [COLLECTION_KIND.LSP8]: 'LSP8 · numbered',
  [COLLECTION_KIND.LSP7]: 'LSP7 · editions',
  [COLLECTION_KIND.ERC721]: 'ERC721 · numbered',
  [COLLECTION_KIND.ERC1155]: 'ERC1155 · editions',
  [COLLECTION_KIND.UNKNOWN]: 'Unrecognised',
}

/** True for the LUKSO pair, where ERC725Y makes metadata universally writable by the owner. */
export const isLuksoKind = (kind) => kind === COLLECTION_KIND.LSP8 || kind === COLLECTION_KIND.LSP7

/**
 * The 4-byte selector of a signature. Used to ask the deployed bytecode whether a function
 * exists at all — `supportsInterface` cannot answer for a non-standard setter, and simulating
 * the call would need the caller to already be the owner.
 */
export const selectorOf = (signature) => keccak256(toHex(signature)).slice(0, 10)

/*
 * The setters worth looking for on an ERC collection, in the order we would use them. Several
 * names are in the wild for the same job, because each NFT tool picked its own.
 */
export const ERC_SETTERS = {
  baseURI: ['setBaseURI(string)', 'setBaseTokenURI(string)', 'setBaseUri(string)'],
  tokenURI: ['setTokenURI(uint256,string)', 'setURI(string)'],
  contractURI: ['setContractURI(string)'],
}

/**
 * Which of those a contract's runtime bytecode contains.
 *
 * A selector present in the code is strong evidence the function exists; absent is near-proof it
 * does not, since the dispatcher has to compare against it to route a call. The exception is a
 * proxy, whose code is a delegating stub with no selectors of its own — reported separately so a
 * proxy is never mistaken for an immutable collection.
 */
export function detectErcSetters(bytecode) {
  const code = (bytecode ?? '').toLowerCase()
  const found = {}

  for (const [role, signatures] of Object.entries(ERC_SETTERS)) {
    found[role] = signatures.find((signature) => code.includes(selectorOf(signature).slice(2))) ?? null
  }

  return found
}

/**
 * Whether the runtime code looks like a minimal proxy or an upgradeable stub. Both forward every
 * call, so their own bytecode carries none of the implementation's selectors — and concluding
 * "no setters, therefore immutable" from that would be wrong.
 */
export function looksLikeProxy(bytecode) {
  const code = (bytecode ?? '').toLowerCase()
  if (code.length <= 2) return false

  // EIP-1167 minimal proxy is ~45 bytes; anything this small cannot be a real collection
  if (code.length < 200) return true
  // `delegatecall` with almost no dispatch surface of its own
  return code.includes('363d3d373d3d3d363d73') || (code.includes('f4') && code.length < 800)
}

/**
 * What the connected wallet may change, given everything read from chain.
 *
 * `owner` is compared case-insensitively and may be a Universal Profile rather than an EOA — the
 * caller resolves that before asking, because a UP owner means the write has to be routed through
 * the profile rather than sent directly.
 */
export function describeCapabilities({ kind, owner, wallet, setters, isProxy }) {
  const isOwner = Boolean(owner && wallet && owner.toLowerCase() === wallet.toLowerCase())

  if (isLuksoKind(kind)) {
    return {
      isOwner,
      // ERC725Y guarantees it. No probing, no caveat.
      canEditCollection: isOwner,
      canEditTokens: isOwner && kind === COLLECTION_KIND.LSP8,
      method: 'setData',
      note: isOwner
        ? null
        : 'Only the collection owner can change its metadata. You are connected as a different address.',
    }
  }

  if (kind === COLLECTION_KIND.ERC721 || kind === COLLECTION_KIND.ERC1155) {
    const hasBase = Boolean(setters?.baseURI)
    const hasToken = Boolean(setters?.tokenURI)
    return {
      isOwner,
      canEditCollection: isOwner && Boolean(setters?.contractURI),
      canEditTokens: isOwner && (hasBase || hasToken),
      method: setters?.baseURI ?? setters?.tokenURI ?? null,
      note: isProxy
        ? 'This looks like a proxy, so its setters live in an implementation contract this check cannot see. Editing may still work.'
        : !hasBase && !hasToken
          ? 'This collection exposes no metadata setter, so its metadata is immutable — nothing here or anywhere else can change it.'
          : !isOwner
            ? 'Only the collection owner can change its metadata. You are connected as a different address.'
            : null,
    }
  }

  return {
    isOwner: false,
    canEditCollection: false,
    canEditTokens: false,
    method: null,
    note: 'That address does not answer as an NFT collection on this network.',
  }
}

/** Reads a supportsInterface sweep into one kind. Order matters: LSP8 and LSP7 both claim ERC725Y. */
export function kindFromInterfaces({ lsp8, lsp7, erc721, erc1155 }) {
  if (lsp8) return COLLECTION_KIND.LSP8
  if (lsp7) return COLLECTION_KIND.LSP7
  if (erc721) return COLLECTION_KIND.ERC721
  if (erc1155) return COLLECTION_KIND.ERC1155
  return COLLECTION_KIND.UNKNOWN
}
