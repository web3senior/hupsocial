'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { isAddress } from 'viem'
import {
  COLLECTION_KIND,
  INTERFACE_IDS,
  describeCapabilities,
  detectErcSetters,
  isLuksoKind,
  kindFromInterfaces,
  looksLikeProxy,
} from '@/lib/collectionProbe'

/* Only what a probe needs. A collection's real ABI is unknown here by definition — this is for
   contracts nobody in this app deployed — so every call is made against a minimal shape and
   allowed to fail. */
const PROBE_ABI = [
  { name: 'supportsInterface', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'contractURI', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'tokenURI', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
]

const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'
const LSP8_BASE_URI_KEY = '0x1a7628600c3bac7101f53697f48df381ddc36b9015e7d7c9c5633d1252aa2843'

/**
 * Reads a pasted contract address into everything the metadata editor needs: what standard it
 * speaks, who owns it, what its metadata currently says, and — the part that actually decides
 * whether an editor should appear — which of its setters exist.
 *
 * Every read is allowed to fail. The whole point is contracts this app has never seen, so a
 * missing `owner()` or an unanswered `supportsInterface` is information, not an error.
 *
 * @param {Object} args
 * @param {string} args.address The contract to probe.
 * @param {number} args.chainId Which chain to look on.
 * @param {string} [args.wallet] Connected address, for the ownership comparison.
 */
export function useCollectionProbe({ address, chainId, wallet }) {
  const publicClient = usePublicClient({ chainId })
  const [state, setState] = useState({ status: 'idle' })

  const probe = useCallback(async () => {
    if (!publicClient || !address || !isAddress(address)) {
      setState({ status: 'idle' })
      return
    }

    setState({ status: 'loading' })
    try {
      const code = await publicClient.getBytecode({ address })
      if (!code || code === '0x') {
        setState({ status: 'empty', message: 'Nothing is deployed at that address on this network.' })
        return
      }

      const read = (functionName, args = []) =>
        publicClient.readContract({ address, abi: PROBE_ABI, functionName, args }).catch(() => null)
      const supports = (id) =>
        publicClient.readContract({ address, abi: PROBE_ABI, functionName: 'supportsInterface', args: [id] }).catch(() => false)

      const [lsp8, lsp7, erc721, erc1155] = await Promise.all([
        supports(INTERFACE_IDS.LSP8),
        supports(INTERFACE_IDS.LSP7),
        supports(INTERFACE_IDS.ERC721),
        supports(INTERFACE_IDS.ERC1155),
      ])
      const kind = kindFromInterfaces({ lsp8, lsp7, erc721, erc1155 })

      const [owner, name, symbol, totalSupply] = await Promise.all([read('owner'), read('name'), read('symbol'), read('totalSupply')])

      // Current metadata, read the way this standard stores it
      let lsp4Metadata = null
      let baseUri = null
      let contractUri = null
      if (isLuksoKind(kind)) {
        lsp4Metadata = await read('getData', [LSP4_METADATA_KEY])
        if (kind === COLLECTION_KIND.LSP8) baseUri = await read('getData', [LSP8_BASE_URI_KEY])
      } else {
        contractUri = await read('contractURI')
        // Token 1 is the convention this app mints from, and the cheapest sample of the pattern
        baseUri = await read('tokenURI', [1n])
      }

      const setters = detectErcSetters(code)
      const isProxy = looksLikeProxy(code)

      setState({
        status: 'ready',
        address,
        chainId,
        kind,
        owner,
        name,
        symbol,
        totalSupply,
        lsp4Metadata,
        baseUri,
        contractUri,
        setters,
        isProxy,
        runtimeSize: code.length / 2 - 1,
        capabilities: describeCapabilities({ kind, owner, wallet, setters, isProxy }),
      })
    } catch (error) {
      setState({ status: 'error', message: error.shortMessage || error.message || 'Could not read that address' })
    }
  }, [publicClient, address, chainId, wallet])

  /*
   * Re-probed when the wallet changes too: ownership is half the answer, and switching accounts
   * should flip the editor on or off without the address being pasted again. The await yields
   * before any state is written, so the effect body itself performs no synchronous update — a
   * render-phase cascade here would re-run the probe on every pass.
   */
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await Promise.resolve()
      if (!cancelled) probe()
    }
    run()
    return () => {
      cancelled = true
    }
  }, [probe])

  return { ...state, refetch: probe }
}
