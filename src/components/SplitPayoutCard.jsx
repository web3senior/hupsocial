'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import { useBalance, useConnection, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { describeWalletError } from '@/lib/walletErrors'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import splitsAbi from '@/abis/HupSplits.json'
import splitterAbi from '@/abis/HupSplitter.json'
import styles from './SplitPayoutCard.module.scss'

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
]

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })
const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')
const fmt = (value, decimals = 18) => amountFormat.format(Number(formatUnits(value ?? 0n, decimals)))

/**
 * Split Payout Card
 * A HupSplits split as its payees see it: who is in it, what each is owed right now, and the two
 * ways money leaves — one payee pulling their own share, or anyone paying everyone out. Mints and
 * royalties only push into the split and stop there; nothing leaves until one of these is
 * pressed, so this card is where a collaborator actually gets paid.
 *
 * Renders nothing unless `candidate` is a split the chain's factory deployed, so a caller can hand
 * it any destination address — a plain wallet simply shows no card.
 *
 * @param {number} props.chainId
 * @param {string} props.candidate The address that may be a split: a drop's payout destination, a collection's royalty receiver.
 * @param {string} props.title What this split pays out — "Mint proceeds", "Resale royalties".
 * @param {{ address: string, isLsp7: boolean }[]} [props.tokens] Payment tokens the drop's phases charge in, so their balances show too.
 */
export default function SplitPayoutCard({ chainId, candidate, title, tokens = [] }) {
  const { address: me } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const { writeContractAsync } = useWriteContract()
  const [busy, setBusy] = useState(null)

  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const factory = CONTRACTS[`chain${chainId}`]?.splits || ''
  const valid = isAddress(candidate ?? '') && candidate !== zeroAddress && isAddress(factory)

  const { data: isSplit } = useReadContract({
    abi: splitsAbi,
    address: factory || undefined,
    functionName: 'isSplit',
    args: [candidate ?? zeroAddress],
    chainId,
    query: { enabled: valid },
  })
  const enabled = valid && isSplit === true

  const { data: payees = [], refetch: refetchPayees } = useReadContract({
    abi: splitterAbi,
    address: candidate,
    functionName: 'payees',
    chainId,
    query: { enabled },
  })
  const { data: held, refetch: refetchHeld } = useBalance({ address: candidate, chainId, query: { enabled } })

  // What each payee could pull right now, and the connected wallet's own figure
  const { data: owedReads, refetch: refetchOwed } = useReadContracts({
    allowFailure: true,
    contracts: payees.map((payee) => ({ abi: splitterAbi, address: candidate, functionName: 'releasable', args: [payee.account], chainId })),
    query: { enabled: enabled && payees.length > 0 },
  })

  // Distinct payment tokens, each with its balance here, its label, and what the viewer may pull
  const tokenList = useMemo(() => {
    const seen = new Map()
    for (const token of tokens) {
      if (isAddress(token?.address ?? '') && token.address !== zeroAddress) seen.set(token.address.toLowerCase(), token)
    }
    return [...seen.values()]
  }, [tokens])
  const { data: tokenReads, refetch: refetchTokens } = useReadContracts({
    allowFailure: true,
    contracts: tokenList.flatMap((token) => [
      { abi: erc20Abi, address: token.address, functionName: 'balanceOf', args: [candidate], chainId },
      { abi: erc20Abi, address: token.address, functionName: 'symbol', chainId },
      { abi: erc20Abi, address: token.address, functionName: 'decimals', chainId },
      { abi: splitterAbi, address: candidate, functionName: 'releasableToken', args: [token.address, me ?? zeroAddress], chainId },
    ]),
    query: { enabled: enabled && tokenList.length > 0 },
  })

  if (!enabled) return null

  const myIndex = me ? payees.findIndex((payee) => payee.account.toLowerCase() === me.toLowerCase()) : -1
  const owed = (index) => (owedReads?.[index]?.status === 'success' ? owedReads[index].result : 0n)
  const mine = myIndex >= 0 ? owed(myIndex) : 0n
  const heldValue = held?.value ?? 0n

  const refetchAll = () => {
    refetchPayees()
    refetchHeld()
    refetchOwed()
    refetchTokens()
  }

  /* The wallet prompt is the only wait shown; the receipt is watched in the background and the
     figures re-read once it lands, so nobody sits on a spinner for a block. */
  const send = async (key, { functionName, args, sentText }) => {
    setBusy(key)
    try {
      const hash = await writeContractAsync({ abi: splitterAbi, address: candidate, functionName, args, chainId })
      toast(sentText, 'success')
      publicClient
        ?.waitForTransactionReceipt({ hash })
        .then(refetchAll)
        .catch(() => {})
    } catch (err) {
      toast(describeWalletError(err, { fallback: 'Transaction rejected or encountered an error' }), 'error')
    } finally {
      setBusy(null)
    }
  }

  const withdrawMine = () => send('mine', { functionName: 'release', args: [me], sentText: `Withdrawing your ${nativeSymbol} share — it lands once the block confirms` })
  const payEveryone = () => send('all', { functionName: 'distribute', args: [], sentText: `Paying everyone out — ${nativeSymbol} lands once the block confirms` })

  return (
    <section className={styles.split}>
      <header className={styles.split__head}>
        <strong>{title}</strong>
        <small>
          split contract <code title={candidate}>{shortAddress(candidate)}</code>
        </small>
      </header>

      <ul className={styles.split__payees}>
        {payees.map((payee, index) => (
          <li key={payee.account} className={clsx(styles.split__payee, index === myIndex && styles['split__payee--me'])}>
            <Profile creator={payee.account} networkId={chainId} variant="compact" size={22} hoverCard={false} />
            <span className={styles.split__share}>{(Number(payee.shareBps) / 100).toFixed(Number(payee.shareBps) % 100 ? 2 : 0)}%</span>
            <span className={styles.split__owed}>
              {owed(index) > 0n ? `${fmt(owed(index))} ${nativeSymbol} to collect` : 'nothing to collect'}
              {index === myIndex && <em> · you</em>}
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.split__row}>
        <span>{heldValue > 0n ? `${fmt(heldValue)} ${nativeSymbol} waiting in the split` : `No ${nativeSymbol} waiting in the split right now`}</span>
        <span className={styles.split__actions}>
          {mine > 0n && (
            <button type="button" onClick={withdrawMine} disabled={busy !== null}>
              {busy === 'mine' ? 'Sending…' : 'Withdraw my share'}
            </button>
          )}
          {heldValue > 0n && (
            <button type="button" onClick={payEveryone} disabled={busy !== null}>
              {busy === 'all' ? 'Sending…' : 'Pay everyone out'}
            </button>
          )}
        </span>
      </div>

      {tokenList.map((token, index) => {
        const read = (offset) => tokenReads?.[index * 4 + offset]
        const balance = read(0)?.status === 'success' ? read(0).result : 0n
        const symbol = read(1)?.status === 'success' ? read(1).result : shortAddress(token.address)
        const decimals = read(2)?.status === 'success' ? Number(read(2).result) : 18
        const myToken = read(3)?.status === 'success' ? read(3).result : 0n
        const key = token.address.toLowerCase()

        return (
          <div key={key} className={styles.split__row}>
            <span>{balance > 0n ? `${fmt(balance, decimals)} ${symbol} waiting in the split` : `No ${symbol} waiting in the split right now`}</span>
            <span className={styles.split__actions}>
              {myToken > 0n && (
                <button
                  type="button"
                  onClick={() =>
                    send(`mine-${key}`, {
                      functionName: 'releaseToken',
                      args: [token.address, Boolean(token.isLsp7), me],
                      sentText: `Withdrawing your ${symbol} share — it lands once the block confirms`,
                    })
                  }
                  disabled={busy !== null}
                >
                  {busy === `mine-${key}` ? 'Sending…' : `Withdraw my ${symbol}`}
                </button>
              )}
              {balance > 0n && (
                <button
                  type="button"
                  onClick={() =>
                    send(`all-${key}`, {
                      functionName: 'distributeToken',
                      args: [token.address, Boolean(token.isLsp7)],
                      sentText: `Paying everyone out in ${symbol} — it lands once the block confirms`,
                    })
                  }
                  disabled={busy !== null}
                >
                  {busy === `all-${key}` ? 'Sending…' : `Pay everyone out in ${symbol}`}
                </button>
              )}
            </span>
          </div>
        )
      })}

      <small className={styles.split__note}>
        Mints and royalties land here and wait. Anyone can pay everyone out; a payee can also withdraw just their own share. Shares
        are fixed for this split&rsquo;s life.
      </small>
    </section>
  )
}
