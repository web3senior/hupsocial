'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, isAddress, parseUnits, zeroAddress, zeroHash } from 'viem'
import clsx from 'clsx'
import { TIP_TOKENS } from '@/lib/tokens'
import offersAbi from '@/abis/HupOffers.json'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import useTokenMeta from './useTokenMeta'
import { STANDARD_ERC20, STANDARD_LSP7, STANDARD_NATIVE } from './P2pDirectory'
import styles from './CreateDealModal.module.scss'

const EXPIRY_OPTIONS = [
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 3 * 86400 },
  { label: '7 days', seconds: 7 * 86400 },
  { label: '30 days', seconds: 30 * 86400 },
]

const computeExpiresAt = (seconds) => BigInt(Math.floor(Date.now() / 1000) + seconds)

// Key still says otc- so drafts saved before the P2P rename still load. Drafts are keyed per chain: token addresses and curated payment options differ between
// chains, so restoring one chain's half-typed deal onto another would hand back an address
// that doesn't exist there. Same storage prefix the post composer's draft uses.
const getDraftKey = (chainId) => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}otc-deal-${chainId}`

const loadDraft = (chainId) => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getDraftKey(chainId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const lsp7Abi = [
  {
    type: 'function',
    name: 'authorizedAmountFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenOwner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

/**
 * Create Deal Modal
 * Posts an escrowed OTC deal: you name the asset you want and the price you'll pay, the
 * payment is locked in HupOffers on submit, and whoever holds the asset delivers it to settle.
 *
 * The asset side is only ever described here — nothing of yours moves except the payment,
 * and that comes straight back if you cancel or the deal expires unfilled.
 *
 * @param {Object} props
 * @param {Object} props.chain Chain entry from appChains.
 * @param {string} props.offersAddress HupOffers deployment on that chain.
 * @param {Function} props.onClose Clears the open-modal state.
 * @param {Function} props.onCreated Revalidates the directory after a deal lands.
 */
export default function CreateDealModal({ chain, offersAddress, onClose, onCreated }) {
  const { address } = useConnection()
  const dialogRef = useRef(null)
  const lastActionRef = useRef(null)

  // Read once on mount: a half-filled deal survives closing the dialog, navigating away, or
  // an accidental refresh, and is cleared only when it actually posts
  const [draft] = useState(() => loadDraft(chain.id))

  // What you want to receive
  const [assetKind, setAssetKind] = useState(draft?.assetKind === 'native' ? 'native' : 'token')
  const [assetToken, setAssetToken] = useState(draft?.assetToken ?? '')
  const [assetAmount, setAssetAmount] = useState(draft?.assetAmount ?? '')
  // What you'll pay for it
  const [paymentChoice, setPaymentChoice] = useState(draft?.paymentChoice ?? 'native')
  const [price, setPrice] = useState(draft?.price ?? '')
  const [counterparty, setCounterparty] = useState(draft?.counterparty ?? '')
  const [expirySeconds, setExpirySeconds] = useState(draft?.expirySeconds ?? EXPIRY_OPTIONS[2].seconds)

  const chainId = chain.id
  const nativeCurrency = chain.nativeCurrency
  const curatedTokens = TIP_TOKENS[chainId] ?? []

  const isNativeAsset = assetKind === 'native'
  const trimmedAsset = assetToken.trim()
  const assetAddress = !isNativeAsset && isAddress(trimmedAsset) ? trimmedAsset : null

  // The asset's standard is detected, never asked. Making someone classify a pasted address
  // was a trap: picking wrong posts a deal that creates fine and can never be filled, because
  // LSP7 and ERC20 grant transfer rights through different functions. Each probe is a view
  // call that only one of the two standards answers, so whichever replies identifies it.
  const { isSuccess: isLsp7Asset } = useReadContract({
    abi: lsp7Abi,
    address: assetAddress,
    functionName: 'authorizedAmountFor',
    args: [zeroAddress, zeroAddress],
    chainId,
    query: { enabled: Boolean(assetAddress) },
  })

  const { isSuccess: isErc20Asset } = useReadContract({
    abi: erc20Abi,
    address: assetAddress,
    functionName: 'allowance',
    args: [zeroAddress, zeroAddress],
    chainId,
    query: { enabled: Boolean(assetAddress) },
  })

  const isStandardKnown = isNativeAsset || isLsp7Asset || isErc20Asset
  const asset = useTokenMeta({ chainId, token: assetAddress, isLsp7: isLsp7Asset, nativeCurrency })
  const assetStandard = isNativeAsset ? STANDARD_NATIVE : isLsp7Asset ? STANDARD_LSP7 : STANDARD_ERC20

  const isTokenPayment = paymentChoice !== 'native'
  const listedToken = paymentChoice.startsWith('token:')
    ? curatedTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  const paymentAddress = listedToken?.address ?? null
  const isPaymentLsp7 = Boolean(listedToken?.lsp7)
  const payment = useTokenMeta({ chainId, token: paymentAddress, isLsp7: isPaymentLsp7, nativeCurrency })

  // The asset and the payment can't be the same thing — the contract rejects it, and offering
  // a token for itself is meaningless anyway
  const isSameToken =
    (isNativeAsset && !isTokenPayment) || (assetAddress && paymentAddress && assetAddress.toLowerCase() === paymentAddress.toLowerCase())

  const toUnits = (value, decimals) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0 || decimals === undefined) return null
    try {
      return parseUnits(value, decimals)
    } catch {
      return null
    }
  }

  const amountUnits = toUnits(assetAmount, isNativeAsset ? (nativeCurrency?.decimals ?? 18) : asset.decimals)
  const priceUnits = toUnits(price, isTokenPayment ? payment.decimals : (nativeCurrency?.decimals ?? 18))
  const trimmedCounterparty = counterparty.trim()
  const counterpartyArg = trimmedCounterparty ? trimmedCounterparty : zeroAddress
  const isCounterpartyValid = !trimmedCounterparty || isAddress(trimmedCounterparty)
  const isSelfLock = trimmedCounterparty && address && trimmedCounterparty.toLowerCase() === address.toLowerCase()

  // Escrow is pulled from the payment token, so a token-denominated deal needs an allowance
  const { data: erc20Allowance, refetch: refetchErc20 } = useReadContract({
    abi: erc20Abi,
    address: paymentAddress,
    functionName: 'allowance',
    args: [address, offersAddress],
    chainId,
    query: { enabled: Boolean(isTokenPayment && !isPaymentLsp7 && paymentAddress && address) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7 } = useReadContract({
    abi: lsp7Abi,
    address: paymentAddress,
    functionName: 'authorizedAmountFor',
    args: [offersAddress, address],
    chainId,
    query: { enabled: Boolean(isPaymentLsp7 && paymentAddress && address) },
  })

  const allowance = isPaymentLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isPaymentLsp7 ? refetchLsp7 : refetchErc20
  const needsApproval = isTokenPayment && allowance !== undefined && priceUnits !== null && allowance < priceUnits

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  // Persist on every keystroke — restored by loadDraft() above. Only the typed fields go in;
  // nothing here is derived, so a restored draft resolves its own symbols and allowances.
  useEffect(() => {
    try {
      localStorage.setItem(
        getDraftKey(chainId),
        JSON.stringify({ assetKind, assetToken, assetAmount, paymentChoice, price, counterparty, expirySeconds })
      )
    } catch (error) {
      console.error('Failed to save OTC draft:', error)
    }
  }, [chainId, assetKind, assetToken, assetAmount, paymentChoice, price, counterparty, expirySeconds])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Token approved — you can post the deal now', 'success')
      refetchAllowance()
      return
    }
    toast('Deal posted — your payment is escrowed until it fills, expires, or you cancel', 'success')
    // The draft only dies once the deal is really onchain — a rejected or failed write leaves
    // it intact so nothing typed is lost to a wallet popup
    try {
      localStorage.removeItem(getDraftKey(chainId))
    } catch {
      // A storage failure must not stop the success path
    }
    onCreated()
    dialogRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprove = () => {
    if (priceUnits === null || !paymentAddress) return
    lastActionRef.current = 'approve'

    if (isPaymentLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: paymentAddress,
        functionName: 'authorizeOperator',
        args: [offersAddress, priceUnits, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: paymentAddress,
        functionName: 'approve',
        args: [offersAddress, priceUnits],
        chainId,
      })
    }
  }

  const handleCreate = () => {
    if (amountUnits === null || priceUnits === null) return

    lastActionRef.current = 'create'
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'makeOffer',
      args: [
        address,
        // Fungible assets are identified by contract alone; native has no contract at all
        isNativeAsset ? zeroAddress : assetAddress,
        zeroHash,
        assetStandard,
        paymentAddress ?? zeroAddress,
        isPaymentLsp7,
        priceUnits,
        amountUnits,
        computeExpiresAt(expirySeconds),
        counterpartyArg,
      ],
      chainId,
      ...(isTokenPayment ? {} : { value: priceUnits }),
    })
  }

  // Every reason the submit button can be off, in the order the form is filled. The gate used
  // to include conditions it never explained — an unresolved token address left the button
  // dead with nothing on screen saying why — so each one now names itself.
  const blocker = (() => {
    if (!address) return 'Connect your wallet to post a deal'
    if (!isNativeAsset && !assetAddress) return 'Enter the contract address of the token you want'
    if (!isNativeAsset && asset.isError) {
      return `No decimals() at that address on ${chain.name} — it may be an NFT collection, not a token, or deployed on a different chain`
    }
    if (!isNativeAsset && !asset.isResolved) return 'Reading that token…'
    if (!isStandardKnown) return 'That address answers neither ERC20 nor LSP7 — it cannot be delivered by a deal'
    if (isSameToken) return 'The asset and the payment must be different'
    if (amountUnits === null) return 'Enter how much you want to receive'
    if (priceUnits === null) return `Enter the price you'll pay`
    if (!isCounterpartyValid) return 'That counterparty address is not valid'
    if (isSelfLock) return 'A deal cannot be locked to yourself'
    return null
  })()

  const canSubmit = !blocker && !isBusy

  return (
    <NativeDialog ref={dialogRef} className={styles.deal} aria-label="New OTC deal" onClose={() => onClose()}>
      <header className={styles.deal__header}>
        <button type="button" className={styles.deal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>New OTC deal</h3>
      </header>

      <main className={styles.deal__body}>
        <div className={styles.deal__field}>
          <label htmlFor="dealAssetKind">You want to receive</label>
          <select id="dealAssetKind" value={assetKind} onChange={(e) => setAssetKind(e.target.value)}>
            <option value="token">A token</option>
            <option value="native">{nativeCurrency?.name || 'Native coin'}</option>
          </select>
        </div>

        {!isNativeAsset && (
          <div className={styles.deal__field}>
            <label htmlFor="dealAssetToken">Token address</label>
            <input
              type="text"
              id="dealAssetToken"
              value={assetToken}
              onChange={(e) => setAssetToken(e.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {/* Says outright which standard the deal will be posted as — it decides how the
                asset is delivered, so it shouldn't be invisible */}
            {assetAddress && asset.isResolved && isStandardKnown && (
              <p className={styles.deal__note}>
                {asset.symbol ? `${asset.symbol} · ` : ''}
                {isLsp7Asset ? 'LSP7' : 'ERC20'} · {asset.decimals} decimals
              </p>
            )}
          </div>
        )}

        <div className={styles.deal__field}>
          <label htmlFor="dealAssetAmount">Amount wanted</label>
          <div className={styles.deal__amount}>
            <input
              type="number"
              id="dealAssetAmount"
              value={assetAmount}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setAssetAmount(e.target.value)}
              placeholder="0.00"
            />
            <span className={styles.deal__amountSymbol}>{isNativeAsset ? nativeCurrency?.symbol : asset.symbol}</span>
          </div>
        </div>

        <div className={styles.deal__field}>
          <label htmlFor="dealPayment">You pay with</label>
          <select id="dealPayment" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
            {curatedTokens.map((token) => (
              <option key={token.address} value={`token:${token.address}`}>
                {token.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.deal__field}>
          <label htmlFor="dealPrice">Total price (escrowed now)</label>
          <div className={styles.deal__amount}>
            <input
              type="number"
              id="dealPrice"
              value={price}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
            <span className={styles.deal__amountSymbol}>{isTokenPayment ? payment.symbol : nativeCurrency?.symbol}</span>
          </div>
        </div>

        <div className={styles.deal__field}>
          <label htmlFor="dealCounterparty">Lock to one wallet (optional)</label>
          <input
            type="text"
            id="dealCounterparty"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="0x... — leave empty for an open deal"
            autoComplete="off"
            spellCheck={false}
          />
          <p className={styles.deal__note}>
            A locked deal can only be filled by that address, so a price agreed privately settles at that price and nobody else can take it
            first.
          </p>
        </div>

        <div className={styles.deal__field}>
          <label htmlFor="dealExpiry">Expires</label>
          <select id="dealExpiry" value={expirySeconds} onChange={(e) => setExpirySeconds(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </main>

      <footer className={styles.deal__footer}>
        {/* Sits with the button it explains, so a disabled control always says what it wants */}
        {blocker && !isBusy && (
          <p className={styles.deal__blocker} role="status">
            {blocker}
          </p>
        )}

        {needsApproval ? (
          <button type="button" className={styles.deal__submit} onClick={handleApprove} disabled={isBusy || priceUnits === null}>
            {isBusy ? 'Confirming…' : `Approve ${payment.symbol}`}
          </button>
        ) : (
          <button type="button" className={styles.deal__submit} onClick={handleCreate} disabled={!canSubmit}>
            {isBusy ? 'Confirming…' : 'Post deal'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}
