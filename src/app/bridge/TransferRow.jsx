'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { createPublicClient } from 'viem'
import { ArrowUpRightIcon, XIcon } from '@phosphor-icons/react'
import { browserTransport } from '@/config/wagmi'
import { Spinner } from '@/components/Loading'
import StatusBadge from '@/components/ui/StatusBadge'
import { postJson } from '@/hooks/launchpad/useSendTx'
import { BRIDGE_DESTINATION as lukso, LUKSO_BRIDGE, luksoBridgeAbi, sourceFor, vaultAbi } from '@/config/hupBridge'
import { removePending } from './pendingTransfers'
import styles from './BridgePanel.module.scss'

const clients = new Map()
const readClient = (chain) => {
  if (!clients.has(chain.id)) clients.set(chain.id, createPublicClient({ chain, transport: browserTransport(chain.id) }))
  return clients.get(chain.id)
}

const toClaim = (claim) => ({
  ...claim,
  sourceChainId: BigInt(claim.sourceChainId),
  depositNonce: BigInt(claim.depositNonce),
  decimals: Number(claim.decimals),
  amount: BigInt(claim.amount),
})

/**
 * One transfer this browser started: polls the signer until the transfer is deep enough, then
 * offers the claim (deposit → LUKSO) or the release (burn → source chain) the user sends.
 */
export default function TransferRow({ item, address, send, busy }) {
  const depositing = item.kind === 'deposit'
  const source = sourceFor(item.chainId)
  const from = depositing ? source?.chain : lukso
  const to = depositing ? lukso : source?.chain
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const { data, error: attestError, mutate } = useSWR(['hup-bridge-attest', item.txHash], () => postJson(depositing ? '/api/v1/bridge/claim' : '/api/v1/bridge/release', depositing ? { chainId: item.chainId, txHash: item.txHash } : { txHash: item.txHash }), {
    refreshInterval: (value) => value?.status === 'ready' ? 0 : 8_000,
  })
  const entries = data?.status === 'ready' ? (depositing ? data.claims : data.releases) : []
  const done = entries.length > 0 && entries.every((entry) => entry.claimed || entry.released)
  // Releases are capped per token per day; say when one would not fit rather than let it revert.
  const pendingRelease = !depositing && !done ? entries.find((entry) => !entry.released)?.release : null
  const { data: allowance } = useSWR(pendingRelease ? ['hup-bridge-releasable', pendingRelease.chainId, pendingRelease.token] : null, () => readClient(source.chain).readContract({ address: pendingRelease.vault, abi: vaultAbi, functionName: 'releasableToday', args: [pendingRelease.token] }), { refreshInterval: 60_000 })
  const overLimit = pendingRelease && allowance && BigInt(pendingRelease.amount) > allowance[0]

  async function finish(entry) {
    setSending(true)
    setError('')
    try {
      if (depositing) {
        await send({ account: address, chainId: lukso.id, label: `Claim ${item.symbol}`, address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'claim', args: [toClaim(entry.claim), entry.signature] })
      } else {
        const { burnId, token, recipient, amount, chainId, vault } = entry.release
        await send({ account: address, chainId: Number(chainId), label: `Release ${item.symbol}`, address: vault, abi: vaultAbi, functionName: 'release', args: [burnId, token, recipient, BigInt(amount), entry.signature] })
      }
      await mutate()
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'The transaction failed.')
    } finally {
      setSending(false)
    }
  }

  if (!source) return null
  const status = done ? <StatusBadge tone="approved">Done</StatusBadge>
    : data?.status === 'ready' ? <StatusBadge tone="pending">{depositing ? 'Ready to claim' : 'Ready to release'}</StatusBadge>
    : <StatusBadge tone="progress">{data?.status === 'confirming' ? `Confirming ${data.confirmations}/${data.required}` : 'Waiting for the chain'}</StatusBadge>

  return (
    <li className={styles.transfer}>
      <div className={styles.transfer__head}>
        <strong>{item.amount} {item.symbol} · {from.name} → {to.name}</strong>
        <span className={styles.transfer__status}>
          {status}
          <button type="button" className={styles.transfer__remove} aria-label="Remove from this list" title={done ? 'Remove from this list' : 'Remove from this list. Resume it later with its transaction hash.'} onClick={() => removePending(item.txHash)}>
            <XIcon size={14} weight="bold" />
          </button>
        </span>
      </div>
      {attestError && <p className={styles.transfer__note}>{attestError.message}</p>}
      {error && <p className={styles.transfer__note}>{error}</p>}
      {!done && entries.map((entry) => (
        <button key={entry.signature} type="button" className={styles.submit} disabled={busy || sending || !address || overLimit} onClick={() => finish(entry)}>
          {sending ? <><Spinner size={16} /> Confirm in your wallet…</> : depositing ? `Claim on ${lukso.name}` : `Release on ${to.name}`}
        </button>
      ))}
      {overLimit && <p className={styles.transfer__note}>This release is above today’s safety limit for {item.symbol}. It can be released after {new Date(Number(allowance[1]) * 1000).toLocaleString()}.</p>}
      {!done && data?.status === 'ready' && <p className={styles.transfer__note}>{depositing ? 'Claiming is one LUKSO transaction and needs a little LYX for gas.' : `Releasing is one ${to.name} transaction and needs a little ${to.nativeCurrency.symbol} for gas.`}</p>}
      <div className={styles.transfer__links}>
        <a href={`${from.blockExplorers.default.url}/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer">{depositing ? 'Deposit' : 'Burn'} transaction <ArrowUpRightIcon size={12} /></a>
      </div>
    </li>
  )
}
