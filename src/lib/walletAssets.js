// Fungible-token portfolio for an arbitrary wallet, across every chain the app supports.
//
// No chain but LUKSO can answer "which tokens does this wallet hold" without an indexer, so
// discovery here is a candidate list — the curated tip tokens, the chain's canonical USDC, the
// native coin, plus whatever addresses the user has pinned themselves — read with balanceOf and
// filtered down to the non-zero ones. That misses unlisted holdings by construction; the pinning
// path in useWalletAssets is what covers them until cidex grows a balances table.
//
// Plain module (no wagmi hooks, no window) so server routes can import it too.

import { erc20Abi, getAddress, hexToString, isAddress } from 'viem'
import { getBalance, readContracts } from 'wagmi/actions'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS, USDC } from '@/lib/tokens'
import { fetchLuksoTokenHoldings, supportsTokenScan } from '@/lib/luksoAssets'

// LSP7 assets have no symbol() — their LSP4 metadata lives in ERC725Y storage under the
// keccak256('LSP4TokenSymbol') data key. Same key the tip modal and the community forms read.
export const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'

export const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// LSP7's transfer carries an explicit sender plus a `force` flag: with force false the token
// refuses any recipient that isn't a contract implementing the LSP1 hook, which would reject
// every plain EOA. Sends from the UI always force.
export const lsp7Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'force', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
]

/**
 * Checksummed address, or null. Profile URLs carry whatever casing the linker used, and viem's
 * getAddress throws on a mixed-case address that fails checksum — so normalise through lowercase
 * rather than rejecting a wallet that is perfectly valid but sloppily cased.
 */
export const normalizeAddress = (value) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null
  return getAddress(value.toLowerCase())
}

export const nativeCurrencyFor = (chainId) =>
  appChains.find((chain) => chain.id === Number(chainId))?.nativeCurrency ?? { name: 'Native coin', symbol: '', decimals: 18 }

/**
 * The tokens worth probing on a chain: curated tip tokens merged with the chain's canonical USDC.
 * Both lists carry the `lsp7` flag that decides approve-vs-authorizeOperator elsewhere and
 * plain-transfer-vs-LSP7-transfer here, so the merge keeps whichever entry set it.
 */
export function candidateTokensFor(chainId) {
  const merged = new Map()

  const add = (entry) => {
    // Several USDC slots are placeholders (`address: ''`) for chains with no deployment yet
    if (!entry?.address || !isAddress(entry.address)) return
    const key = entry.address.toLowerCase()
    merged.set(key, { ...merged.get(key), ...entry, address: getAddress(entry.address) })
  }

  ;(TIP_TOKENS[Number(chainId)] ?? []).forEach(add)
  const usdc = USDC[Number(chainId)]
  if (usdc) add({ symbol: 'USDC', ...usdc })

  return [...merged.values()]
}

const unwrapBalance = (result) => (typeof result === 'bigint' ? result : result?.value)

const decodeLsp4Symbol = (bytes) => {
  if (!bytes || bytes === '0x') return ''
  try {
    // Trailing NULs show up when the writer padded to a fixed width
    return hexToString(bytes).replace(/\0+$/, '').trim()
  } catch {
    return ''
  }
}

/**
 * Every non-zero fungible balance `owner` holds across appChains.
 *
 * `customTokens` are user-pinned `{ chainId, address }` pairs, folded in alongside the curated
 * candidates. Returns plain-serialisable rows — balances are decimal strings, not BigInt, so the
 * query cache and any devtools inspection stay safe.
 */
export async function fetchWalletAssets(config, owner, customTokens = []) {
  const holder = normalizeAddress(owner)
  if (!holder) return []

  const pinnedByChain = new Map()
  for (const pinned of customTokens) {
    const address = normalizeAddress(pinned?.address)
    const chainId = Number(pinned?.chainId)
    if (!address || !appChains.some((chain) => chain.id === chainId)) continue
    pinnedByChain.set(chainId, [...(pinnedByChain.get(chainId) ?? []), { address, pinned: true }])
  }

  // One flat target list; readContracts carries a per-contract chainId and batches each chain
  // into its own multicall3, falling back to individual reads on the chains without one.
  const targets = []
  for (const chain of appChains) {
    const merged = new Map()
    for (const token of [...candidateTokensFor(chain.id), ...(pinnedByChain.get(chain.id) ?? [])]) {
      const key = token.address.toLowerCase()
      merged.set(key, { ...merged.get(key), ...token })
    }
    for (const token of merged.values()) targets.push({ ...token, chainId: chain.id })
  }

  // LUKSO can enumerate holdings outright, so those chains get a real scan instead of a probe —
  // the index returns balance, decimals, symbol and icon together, needing no onchain follow-up
  const scannedChains = appChains.filter((chain) => supportsTokenScan(chain.id))

  const [nativeSettled, scanSettled] = await Promise.all([
    Promise.allSettled(appChains.map((chain) => getBalance(config, { address: holder, chainId: chain.id }))),
    Promise.allSettled(scannedChains.map((chain) => fetchLuksoTokenHoldings(chain.id, holder))),
  ])

  const tokenReads = targets.flatMap((target) => [
    { address: target.address, abi: erc20Abi, functionName: 'balanceOf', args: [holder], chainId: target.chainId },
    { address: target.address, abi: erc20Abi, functionName: 'decimals', chainId: target.chainId },
    { address: target.address, abi: erc20Abi, functionName: 'symbol', chainId: target.chainId },
  ])

  const tokenResults = tokenReads.length ? await readContracts(config, { allowFailure: true, contracts: tokenReads }) : []

  const assets = []
  // Scanned rows win over probed ones for the same token — they already carry richer metadata
  const seen = new Set()

  scannedChains.forEach((chain, index) => {
    const settled = scanSettled[index]
    if (settled.status !== 'fulfilled') return
    for (const holding of settled.value) {
      const address = normalizeAddress(holding.address)
      if (!address) continue
      const id = `${chain.id}:${address.toLowerCase()}`
      if (seen.has(id)) continue
      seen.add(id)
      assets.push({
        id,
        chainId: chain.id,
        address,
        isNative: false,
        isLsp7: true,
        pinned: false,
        symbol: holding.symbol,
        decimals: holding.decimals,
        balance: holding.balance,
        icon: holding.icon,
      })
    }
  })

  appChains.forEach((chain, index) => {
    const settled = nativeSettled[index]
    if (settled.status !== 'fulfilled') return
    const value = unwrapBalance(settled.value)
    if (!value) return
    const native = nativeCurrencyFor(chain.id)
    assets.push({
      id: `${chain.id}:native`,
      chainId: chain.id,
      address: null,
      isNative: true,
      isLsp7: false,
      icon: null,
      pinned: false,
      symbol: native.symbol,
      decimals: native.decimals,
      balance: value.toString(),
    })
  })

  // symbol() reverting is exactly what identifies an LSP7, so the failures drive a second pass
  const needsLsp4Symbol = []

  const rows = targets.map((target, index) => {
    const [balanceRes, decimalsRes, symbolRes] = tokenResults.slice(index * 3, index * 3 + 3)
    const balance = balanceRes?.status === 'success' ? balanceRes.result : null
    const decimals = decimalsRes?.status === 'success' ? Number(decimalsRes.result) : null
    const onchainSymbol = symbolRes?.status === 'success' ? symbolRes.result : null
    const isLsp7 = Boolean(target.lsp7) || symbolRes?.status === 'failure'
    return { target, balance, decimals, onchainSymbol, isLsp7 }
  })

  // A pinned token was asked for by name, so it stays listed even at zero; a curated candidate
  // at zero is just noise the wallet doesn't hold. Anything the LUKSO scan already returned is
  // skipped outright rather than listed twice.
  const isListed = (row) =>
    row.decimals !== null &&
    row.balance !== null &&
    (row.balance > 0n || row.target.pinned) &&
    !seen.has(`${row.target.chainId}:${row.target.address.toLowerCase()}`)

  rows.forEach((row, index) => {
    if (!isListed(row)) return
    if (row.onchainSymbol || !row.isLsp7) return
    needsLsp4Symbol.push(index)
  })

  let lsp4Results = []
  if (needsLsp4Symbol.length) {
    lsp4Results = await readContracts(config, {
      allowFailure: true,
      contracts: needsLsp4Symbol.map((index) => ({
        address: rows[index].target.address,
        abi: erc725yAbi,
        functionName: 'getData',
        args: [LSP4_TOKEN_SYMBOL_KEY],
        chainId: rows[index].target.chainId,
      })),
    })
  }

  const lsp4SymbolByRow = new Map()
  needsLsp4Symbol.forEach((rowIndex, i) => {
    const result = lsp4Results[i]
    if (result?.status === 'success') lsp4SymbolByRow.set(rowIndex, decodeLsp4Symbol(result.result))
  })

  rows.forEach((row, index) => {
    // A failed balanceOf means a dead or non-token address, which never earns a row
    if (!isListed(row)) return
    const symbol = row.onchainSymbol || lsp4SymbolByRow.get(index) || row.target.symbol || 'Token'
    assets.push({
      id: `${row.target.chainId}:${row.target.address.toLowerCase()}`,
      chainId: row.target.chainId,
      address: row.target.address,
      isNative: false,
      isLsp7: row.isLsp7,
      icon: null,
      pinned: Boolean(row.target.pinned),
      symbol,
      decimals: row.decimals,
      balance: row.balance.toString(),
    })
  })

  const chainOrder = new Map(appChains.map((chain, index) => [chain.id, index]))
  // Native first within each chain, then alphabetical — a stable order across refetches so rows
  // never reshuffle under the user's cursor mid-transfer
  return assets.sort(
    (a, b) =>
      chainOrder.get(a.chainId) - chainOrder.get(b.chainId) ||
      Number(b.isNative) - Number(a.isNative) ||
      a.symbol.localeCompare(b.symbol)
  )
}
