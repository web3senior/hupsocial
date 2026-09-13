'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { isAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { config } from '@/config/wagmi'
import { CONTRACTS } from '@/config/contracts'
import { useQuoteAsset } from '@/hooks/useQuoteAsset'
import { formatQuote } from '@/lib/launch'
import { isValidSplit, predictSplitAddress, toSplitPayees } from '@/lib/splits'
import { useSplitDeployer } from '@/hooks/useSplitDeployer'
import launchAbi from '@/abis/HupLaunch.json'
import lockerAbi from '@/abis/HupLaunchLocker.json'
import { toast } from '@/components/NextToast'
import Profile from '@/components/Profile'
import PayeeTable, { emptyPayee } from '@/components/PayeeTable'
import SplitPayoutCard from '@/components/SplitPayoutCard'
import EmptyState from '@/components/ui/EmptyState'
import { CoinsIcon } from '@phosphor-icons/react'
import styles from './LaunchFees.module.scss'

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * Launch Fees
 * Where a creator collects what their token earned.
 *
 * Fees do not arrive on their own. Trading fees accrue inside the pool against the launch's own
 * locked position, and they stay there until someone calls collect — which anyone may do, because
 * it also tops up the compounding pot that pays whoever grows the position next. Only once
 * collected are they split and booked to a pull ledger the creator withdraws from.
 *
 * So this panel is deliberately two steps, matching the contract rather than papering over it:
 * collect moves fees out of the pool and splits them, claim withdraws the caller's balance.
 * Anyone can press collect; only what is yours can be claimed.
 */
const LaunchFees = ({ networkId, launch }) => {
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const [recipientDraft, setRecipientDraft] = useState(null)
  const [recipientMode, setRecipientMode] = useState('address')
  const [splitRows, setSplitRows] = useState([emptyPayee()])

  const isWrongChain = Boolean(walletChain && networkId && walletChain.id !== networkId)
  const publicClient = usePublicClient({ chainId: networkId })
  const { factory: splitsFactory, isAvailable: splitsAvailable, isDeploying: isDeployingSplit, ensureSplit } = useSplitDeployer(networkId)

  const launchAddress = CONTRACTS[`chain${networkId}`]?.launch
  const quote = launch?.quote ?? ZERO
  const positionTokenId = launch?.position_token_id
  // Fees are paid in the asset the launch is quoted in, at that asset's own precision
  const quoteAsset = useQuoteAsset(networkId, quote)

  // The locker is deployed by the factory's own constructor, so it is read rather than configured
  const { data: lockerAddress } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'locker',
    chainId: networkId,
    query: { enabled: Boolean(launchAddress), staleTime: Infinity },
  })

  const { data: claimable = 0n, refetch: refetchClaimable } = useReadContract({
    abi: lockerAbi,
    address: lockerAddress,
    functionName: 'claimable',
    args: [address ?? ZERO, quote],
    chainId: networkId,
    query: { enabled: Boolean(lockerAddress && address), refetchInterval: 30_000 },
  })

  // Fees already collected but not yet swept by a compounder. Which side of the pot holds the
  // quote asset depends on how the two currencies sorted — native is always currency0, an ERC20
  // quote can land either way.
  const quoteIsCurrency0 = String(quote).toLowerCase() < String(launch?.token ?? '').toLowerCase()
  const { data: pot = 0n, refetch: refetchPot } = useReadContract({
    abi: lockerAbi,
    address: lockerAddress,
    functionName: quoteIsCurrency0 ? 'pendingBounty0' : 'pendingBounty1',
    args: [BigInt(positionTokenId ?? 0)],
    chainId: networkId,
    query: { enabled: Boolean(lockerAddress && positionTokenId) },
  })

  // Who the fee is actually paid to, and who may move it — the locker is the authority on both,
  // and the creator can repoint the recipient at any time, so this is never read from the index
  const { data: locked, refetch: refetchLocked } = useReadContract({
    abi: lockerAbi,
    address: lockerAddress,
    functionName: 'lockedPositions',
    args: [BigInt(positionTokenId ?? 0)],
    chainId: networkId,
    query: { enabled: Boolean(lockerAddress && positionTokenId) },
  })
  const [lockedCreator, feeRecipient, lockedShareBps] = locked ?? []

  // What the recipient itself is owed. A split — or any contract that cannot call claim for
  // itself — would otherwise sit on a balance nobody could move, which is what claimFor is for.
  const { data: recipientClaimable = 0n, refetch: refetchRecipientClaimable } = useReadContract({
    abi: lockerAbi,
    address: lockerAddress,
    functionName: 'claimable',
    args: [feeRecipient ?? ZERO, quote],
    chainId: networkId,
    query: { enabled: Boolean(lockerAddress && feeRecipient), refetchInterval: 30_000 },
  })

  const { data: hash, isPending, writeContract, error: submitError } = useWriteContract()
  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isConfirmed) return
    refetchClaimable()
    refetchRecipientClaimable()
    refetchPot()
    refetchLocked()
    toast('Done', 'success')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const isBusy = isPending || isConfirming || isDeployingSplit
  const creatorAddress = lockedCreator ?? launch?.wallet_address
  const isCreator = Boolean(address && creatorAddress && address.toLowerCase() === String(creatorAddress).toLowerCase())
  const takesAFee = Number(lockedShareBps ?? launch?.creator_share_bps ?? 0) > 0
  const recipientIsMe = Boolean(address && feeRecipient && address.toLowerCase() === String(feeRecipient).toLowerCase())

  // Repointing at several wallets means repointing at one split. Its address follows from its
  // table, so it can be shown before it is deployed and before anything is signed.
  const splitPayees = useMemo(() => toSplitPayees(splitRows), [splitRows])
  const splitIsValid = isValidSplit(splitPayees)
  const splitPayeesKey = JSON.stringify(splitPayees)
  // Kept alongside the table it answers for, so editing a row blanks the address until the new
  // one is back rather than leaving the previous split's on screen
  const [resolvedSplit, setResolvedSplit] = useState(null)

  useEffect(() => {
    let cancelled = false

    if (!splitsAvailable || !publicClient || recipientMode !== 'split' || !splitIsValid) return undefined

    predictSplitAddress({ publicClient, factory: splitsFactory, payees: JSON.parse(splitPayeesKey) })
      .then((split) => {
        if (!cancelled) setResolvedSplit({ key: splitPayeesKey, split })
      })
      .catch(() => {
        if (!cancelled) setResolvedSplit(null)
      })

    return () => {
      cancelled = true
    }
  }, [splitsAvailable, splitsFactory, publicClient, recipientMode, splitIsValid, splitPayeesKey])

  const predictedSplit = recipientMode === 'split' && resolvedSplit?.key === splitPayeesKey ? resolvedSplit.split : ''

  const guard = () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return false
    }
    if (isWrongChain) {
      switchChain.mutate?.({ chainId: networkId })
      return false
    }
    return true
  }

  const handleCollect = () => {
    if (!guard()) return
    writeContract({
      abi: lockerAbi,
      address: lockerAddress,
      functionName: 'collect',
      args: [BigInt(positionTokenId)],
      chainId: networkId,
    })
  }

  /**
   * Pushes the recipient's own balance to it.
   *
   * The ledger pays whoever calls, so an address that cannot call — a split, a treasury — needs
   * someone to press this. Permissionless, and it can only ever send the recipient its own money.
   */
  const handlePushToRecipient = () => {
    if (!guard()) return
    writeContract({
      abi: lockerAbi,
      address: lockerAddress,
      functionName: 'claimFor',
      args: [feeRecipient, quote],
      chainId: networkId,
    })
  }

  const handleSaveRecipient = async () => {
    if (!guard()) return

    const next = recipientMode === 'split' ? predictedSplit : recipientDraft
    if (!isAddress(next ?? '')) {
      toast(recipientMode === 'split' ? 'Give every payee a wallet and shares totalling 100%' : 'That is not a valid address', 'error')
      return
    }

    // The split must exist before the fee points at it, so its payees can be read by the people
    // in it rather than taken on trust
    if (recipientMode === 'split' && !(await ensureSplit(next, splitPayees))) return

    writeContract(
      {
        abi: lockerAbi,
        address: lockerAddress,
        functionName: 'setFeeRecipient',
        args: [BigInt(positionTokenId), next],
        chainId: networkId,
      },
      // Closed on the hash rather than the receipt — it is signed, and the toast reports how it
      // landed. A rejection leaves the editor open with what was typed still in it.
      {
        onSuccess: () => {
          setRecipientDraft(null)
          setSplitRows([emptyPayee()])
        },
      },
    )
  }

  const handleClaim = () => {
    if (!guard()) return
    writeContract({
      abi: lockerAbi,
      address: lockerAddress,
      functionName: 'claim',
      args: [quote, address],
      chainId: networkId,
    })
  }

  if (!lockerAddress || !positionTokenId) return null

  return (
    <section className={styles.fees}>
      <header className={styles.fees__header}>
        <h2>Creator fees</h2>
        <p>
          Every trade pays a fee into this token&apos;s own locked position. Collecting splits it — the creator&apos;s share, Hup&apos;s
          share, a burn from sell fees, and the rest compounding back into the pool.
        </p>
      </header>

      <dl className={styles.fees__grid}>
        <div>
          <dt>Claimable by you</dt>
          <dd className={styles.fees__amount}>
            {formatQuote(claimable, quoteAsset.decimals)} <span>{quoteAsset.symbol}</span>
          </dd>
        </div>
        <div>
          <dt>In the compounding pot</dt>
          <dd className={styles.fees__amount}>
            {formatQuote(pot, quoteAsset.decimals)} <span>{quoteAsset.symbol}</span>
          </dd>
        </div>
      </dl>

      {takesAFee && feeRecipient && (
        <div className={styles.fees__recipient}>
          {recipientDraft === null ? (
            <>
              <div className={styles.fees__recipientWho}>
                <span>Creator fee paid to</span>
                <Profile creator={feeRecipient} networkId={networkId} variant="compact" size={20} fingerprint={false} />
              </div>
              {/* An address that cannot claim for itself needs a push, and anyone may give it */}
              {!recipientIsMe && recipientClaimable > 0n && (
                <button type="button" onClick={handlePushToRecipient} disabled={isBusy}>
                  {isBusy ? 'Working…' : `Pay out ${formatQuote(recipientClaimable, quoteAsset.decimals)} ${quoteAsset.symbol}`}
                </button>
              )}
              {isCreator && (
                <button type="button" onClick={() => setRecipientDraft(feeRecipient)} disabled={isBusy}>
                  Change
                </button>
              )}
            </>
          ) : (
            <>
              {splitsAvailable && (
                <div className={styles.fees__modes}>
                  <button
                    type="button"
                    className={clsx(recipientMode === 'address' && styles['fees__mode--active'])}
                    onClick={() => setRecipientMode('address')}
                    disabled={isBusy}
                  >
                    One wallet
                  </button>
                  <button
                    type="button"
                    className={clsx(recipientMode === 'split' && styles['fees__mode--active'])}
                    onClick={() => setRecipientMode('split')}
                    disabled={isBusy}
                  >
                    Several
                  </button>
                </div>
              )}

              {recipientMode === 'split' ? (
                <div className={styles.fees__payees}>
                  <PayeeTable rows={splitRows} onChange={setSplitRows} chainId={networkId} disabled={isBusy} />
                  <small>
                    {predictedSplit
                      ? `Split contract: ${predictedSplit} — deployed when you save, and its shares never change`
                      : 'The split address appears once the shares total 100%'}
                  </small>
                </div>
              ) : (
                <input
                  type="text"
                  value={recipientDraft}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setRecipientDraft(event.target.value.trim())}
                  disabled={isBusy}
                />
              )}

              <button type="button" onClick={handleSaveRecipient} disabled={isBusy}>
                {isBusy ? 'Working…' : 'Save'}
              </button>
              <button type="button" onClick={() => setRecipientDraft(null)} disabled={isBusy}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* Renders only when the recipient really is a split, so a plain wallet shows nothing */}
      <SplitPayoutCard
        chainId={networkId}
        candidate={feeRecipient}
        title="Creator fees"
        tokens={quote === ZERO ? [] : [{ address: quote, isLsp7: false }]}
      />

      {!address && <EmptyState icon={CoinsIcon}>Connect your wallet to see what you can claim.</EmptyState>}

      <div className={styles.fees__actions}>
        <button
          type="button"
          onClick={handleCollect}
          disabled={isBusy}
          className={clsx(styles.fees__button, styles['fees__button--secondary'])}
        >
          {isBusy ? 'Working…' : 'Collect from pool'}
        </button>

        <button
          type="button"
          onClick={handleClaim}
          disabled={isBusy || claimable === 0n}
          className={clsx(styles.fees__button, styles['fees__button--primary'])}
        >
          {claimable === 0n ? 'Nothing to claim' : `Claim ${formatQuote(claimable, quoteAsset.decimals)} ${quoteAsset.symbol}`}
        </button>
      </div>

      <p className={styles.fees__note}>
        Collecting is open to anyone, not just the creator — it is what moves fees out of the pool so they can be split. Your share is
        booked immediately; the rest joins the pot that pays whoever grows the position next.
        {isCreator
          ? ' The creator share is booked the moment it is collected, whoever pressed the button — to whichever address you have it pointed at.'
          : ''}
        {!recipientIsMe && recipientClaimable > 0n
          ? ' A recipient that is a contract cannot withdraw for itself, so paying it out is open to anyone — it can only ever send that address its own balance.'
          : ''}
      </p>
    </section>
  )
}

export default LaunchFees
