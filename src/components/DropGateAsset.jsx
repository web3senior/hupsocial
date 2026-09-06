'use client'

import clsx from 'clsx'
import { hexToString, isAddress, zeroAddress } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { CheckCircleIcon, WarningIcon } from '@phosphor-icons/react'
import { LSP4_DATA_KEYS } from '@/lib/drops'
import styles from './DropTokenIdentity.module.scss'

const readAbi = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const balance1155Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
]

const erc725yAbi = [
  { name: 'getData', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes' }] },
]

const countFormat = new Intl.NumberFormat('en')

const decodeString = (value) => {
  if (!value || value === '0x') return ''
  try {
    return hexToString(value).replace(/ /g, '').trim()
  } catch {
    return ''
  }
}

/**
 * Drop Gate Asset
 * What is deployed at a gating contract address, checked the way the gate itself checks it.
 *
 * It cannot reuse DropTokenIdentity: that one proves a token by its `decimals()`, and an ERC721
 * has none — the payment field's own test would call every NFT collection dead. The gate only
 * ever calls `balanceOf`, so that is what gets probed here, against the creator's own wallet when
 * one is connected. Seeing your own balance is also the fastest way to notice you have pointed
 * the gate at the wrong contract.
 *
 * `decimals` is reported back so the caller can scale a minimum: a balance of "100" means 100 for
 * an NFT and 100 × 10^18 for an ERC20, and the gate compares raw balances.
 *
 * @param {number} props.chainId The drop's chain.
 * @param {string} props.asset The gating contract, as typed.
 * @param {boolean} [props.is1155] Read `balanceOf(address, id)` instead of `balanceOf(address)`.
 * @param {string} [props.tokenId] The id to check for the 1155 form.
 * @param {string} [props.nativeGate] The chain's HupNativeBalance adapter, whose balance is the coin itself.
 * @param {string} [props.nativeSymbol] What to call that coin.
 */
export default function DropGateAsset({ chainId, asset, is1155 = false, tokenId = '', nativeGate = '', nativeSymbol = '' }) {
  const { address } = useConnection()
  const enabled = isAddress(asset ?? '')
  const holder = address ?? zeroAddress
  const isNative = enabled && Boolean(nativeGate) && asset.toLowerCase() === nativeGate.toLowerCase()

  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: asset, abi: readAbi, functionName: 'symbol', chainId },
      { address: asset, abi: readAbi, functionName: 'decimals', chainId },
      { address: asset, abi: erc725yAbi, functionName: 'getData', args: [LSP4_DATA_KEYS.symbol], chainId },
      is1155
        ? { address: asset, abi: balance1155Abi, functionName: 'balanceOf', args: [holder, BigInt(tokenId || 0)], chainId }
        : { address: asset, abi: readAbi, functionName: 'balanceOf', args: [holder], chainId },
    ],
    query: { enabled },
  })

  if (!enabled) return null
  if (isLoading || !data) return <span className={styles.tokenIdentity}>Reading the contract…</span>

  const symbol = (data[0]?.status === 'success' ? data[0].result : '') || (data[2]?.status === 'success' ? decodeString(data[2].result) : '')
  const decimals = data[1]?.status === 'success' ? Number(data[1].result) : 0
  const answered = data[3]?.status === 'success'
  const balance = answered ? data[3].result : null

  // The gate's only call. If it reverts here it reverts at mint, and the stage rejects everyone
  if (!answered) {
    return (
      <span className={clsx(styles.tokenIdentity, styles['tokenIdentity--bad'])}>
        <WarningIcon size={13} weight="fill" />
        This contract doesn&rsquo;t answer {is1155 ? 'balanceOf(wallet, id)' : 'balanceOf(wallet)'} on this network — the
        gate would turn everyone away.
      </span>
    )
  }

  const held = decimals > 0 ? Number(balance) / 10 ** decimals : Number(balance)

  return (
    <span className={styles.tokenIdentity}>
      <CheckCircleIcon size={13} weight="fill" />
      <strong>{isNative ? nativeSymbol || symbol : symbol || 'Unnamed contract'}</strong>
      <span>
        · {isNative ? 'the native coin, read straight from the wallet' : decimals > 0 ? 'a token balance' : 'a holding count'}
        {address ? ` · you hold ${countFormat.format(held)}` : ''}
      </span>
    </span>
  )
}
