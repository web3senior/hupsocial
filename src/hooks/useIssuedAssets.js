'use client'

import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { concat, hexToString, isAddress, pad, slice, toHex } from 'viem'

/** keccak256('LSP12IssuedAssets[]') — the array a Universal Profile lists what it created in. */
export const LSP12_ISSUED_ASSETS_KEY = '0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd'

const ERC725Y_ABI = [
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'getDataBatch', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32[]' }], outputs: [{ type: 'bytes[]' }] },
]

const ASSET_ABI = [
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'supportsInterface', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'bool' }] },
]

const INTERFACE_LSP8 = '0x3a271706'

/*
 * An LSP asset keeps its name and symbol in ERC725Y, not behind `name()` / `symbol()` — those
 * are the ERC20/721 convention and most LUKSO assets do not implement them. Reading the functions
 * returns nothing for almost every collection, which looks like a list of unnamed contracts.
 */
const LSP4_TOKEN_NAME_KEY = '0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1'
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'

const decodeText = (value) => {
  if (!value || value === '0x') return ''
  try {
    return hexToString(value).replace(/\u0000+$/, '')
  } catch {
    return ''
  }
}

/** LSP2 array element key: the first half of the array key, then the index. */
const elementKeyAt = (index) => concat([slice(LSP12_ISSUED_ASSETS_KEY, 0, 16), pad(toHex(index), { size: 16 })])

/** A stored element is an abi-encoded address; take the last 20 bytes rather than trusting padding. */
const addressFrom = (value) => (value && value.length >= 42 ? `0x${value.slice(-40)}` : null)

const MAX_ASSETS = 60

/**
 * The collections a Universal Profile says it created, from `LSP12IssuedAssets[]`.
 *
 * Self-declared, which is the important caveat: the array holds what the profile claims to have
 * issued, so a collection deployed by a tool that never wrote the entry simply will not appear.
 * That makes this a shortcut to the common case, never a replacement for pasting an address —
 * and the caller keeps that path open beside it.
 *
 * Issued is also not the same as owned. Ownership can move without the entry following, so this
 * offers candidates and the caller's own owner check still decides what may be edited.
 */
export function useIssuedAssets({ profile, chainId, enabled = true }) {
  const publicClient = usePublicClient({ chainId })
  const [state, setState] = useState({ status: 'idle', assets: [] })

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // Every path yields before touching state, so the effect body itself writes nothing —
      // including the "nothing to do" case, which is the common one on a non-LUKSO chain.
      await Promise.resolve()
      if (cancelled) return

      if (!enabled || !publicClient || !profile || !isAddress(profile)) {
        setState({ status: 'idle', assets: [] })
        return
      }

      setState({ status: 'loading', assets: [] })

      try {
        const lengthBytes = await publicClient
          .readContract({ address: profile, abi: ERC725Y_ABI, functionName: 'getData', args: [LSP12_ISSUED_ASSETS_KEY] })
          .catch(() => null)

        // A profile with nothing issued, or an EOA that has no ERC725Y at all, both land here —
        // and neither is an error worth showing.
        const count = lengthBytes && lengthBytes !== '0x' ? parseInt(lengthBytes, 16) : 0
        if (!count) {
          if (!cancelled) setState({ status: 'ready', assets: [] })
          return
        }

        const wanted = Math.min(count, MAX_ASSETS)
        const keys = Array.from({ length: wanted }, (_, i) => elementKeyAt(i))

        // One batch where the profile supports it; a per-key fallback where it does not
        const values = await publicClient
          .readContract({ address: profile, abi: ERC725Y_ABI, functionName: 'getDataBatch', args: [keys] })
          .catch(async () =>
            Promise.all(
              keys.map((key) =>
                publicClient.readContract({ address: profile, abi: ERC725Y_ABI, functionName: 'getData', args: [key] }).catch(() => null),
              ),
            ),
          )

        const addresses = [...new Set((values ?? []).map(addressFrom).filter(Boolean))]
        if (!addresses.length) {
          if (!cancelled) setState({ status: 'ready', assets: [] })
          return
        }

        // Names and standard per asset. Each is allowed to fail: an entry can point at a
        // contract that was never deployed on this chain, or at one that answers nothing.
        const assets = await Promise.all(
          addresses.map(async (address) => {
            const read = (functionName, args = []) =>
              publicClient.readContract({ address, abi: ASSET_ABI, functionName, args }).catch(() => null)
            const [nameBytes, symbolBytes, owner, isLsp8] = await Promise.all([
              read('getData', [LSP4_TOKEN_NAME_KEY]),
              read('getData', [LSP4_TOKEN_SYMBOL_KEY]),
              read('owner'),
              read('supportsInterface', [INTERFACE_LSP8]),
            ])
            return {
              address,
              name: decodeText(nameBytes),
              symbol: decodeText(symbolBytes),
              owner,
              isLsp8: Boolean(isLsp8),
            }
          }),
        )

        if (!cancelled) {
          setState({
            status: 'ready',
            // A contract that answers nothing is almost certainly not on this chain — drop it
            // rather than offer a row that opens onto an error.
            assets: assets.filter((asset) => asset.name || asset.owner),
            truncated: count > wanted,
            total: count,
          })
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', assets: [], message: error.shortMessage || error.message })
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [publicClient, profile, chainId, enabled])

  return state
}
