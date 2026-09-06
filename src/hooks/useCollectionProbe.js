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
import { LSP4_METADATA_KEY, LSP4_TOKEN_NAME_KEY, LSP4_TOKEN_SYMBOL_KEY, LSP8_TOKEN_METADATA_BASE_URI_KEY } from '@/lib/lsp4'
import { decodeDataString } from '@/lib/drops'

/* Only what a probe needs. A collection's real ABI is unknown here by definition — this is for
   contracts nobody in this app deployed — so every call is made against a minimal shape and
   allowed to fail. */
const PROBE_ABI = [
  { name: 'supportsInterface', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalMinted', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'tokenSupplyCap', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'maxSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'contractURI', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'tokenURI', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  { name: 'metadataFrozen', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
]

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

      /*
       * How many numbers exist, and how many have been handed out. LSP8 spells the ceiling
       * `tokenSupplyCap`, the ERC721 collections this app deploys spell it `maxSupply`, and a
       * collection that declares neither is an open edition or simply does not say — which is
       * information too: without a ceiling there is no unminted half to separate.
       *
       * `totalMinted` is the high-water mark and the honest line between the halves. totalSupply
       * falls when a token burns, which would quietly move already-minted numbers into the
       * unminted half.
       */
      // metadataFrozen is Hup's own drop collections saying their pointers are locked; anything else answers null
      const [owner, name, symbol, totalSupply, totalMinted, tokenSupplyCap, maxSupply, frozen] = await Promise.all([
        read('owner'),
        read('name'),
        read('symbol'),
        read('totalSupply'),
        read('totalMinted'),
        read('tokenSupplyCap'),
        read('maxSupply'),
        read('metadataFrozen'),
      ])
      const metadataFrozen = frozen === true
      const supplyCap = Number(tokenSupplyCap ?? 0) || Number(maxSupply ?? 0) || 0

      // Current metadata, read the way this standard stores it
      let lsp4Metadata = null
      let baseUri = null
      let contractUri = null
      let lsp4Name = null
      let lsp4Symbol = null
      if (isLuksoKind(kind)) {
        // LSP7 and LSP8 keep their name and symbol in ERC725Y, not behind name()/symbol()
        const [nameBytes, symbolBytes] = await Promise.all([read('getData', [LSP4_TOKEN_NAME_KEY]), read('getData', [LSP4_TOKEN_SYMBOL_KEY])])
        lsp4Name = decodeDataString(nameBytes) || null
        lsp4Symbol = decodeDataString(symbolBytes) || null
        lsp4Metadata = await read('getData', [LSP4_METADATA_KEY])
        if (kind === COLLECTION_KIND.LSP8) baseUri = await read('getData', [LSP8_TOKEN_METADATA_BASE_URI_KEY])
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
        name: name ?? lsp4Name,
        symbol: symbol ?? lsp4Symbol,
        totalSupply,
        totalMinted: totalMinted ?? null,
        supplyCap,
        metadataFrozen,
        lsp4Metadata,
        baseUri,
        contractUri,
        setters,
        isProxy,
        runtimeSize: code.length / 2 - 1,
        capabilities: describeCapabilities({ kind, owner, wallet, setters, isProxy, metadataFrozen }),
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
