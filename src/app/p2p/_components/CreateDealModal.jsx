'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, isAddress, parseUnits, zeroAddress, zeroHash } from 'viem'
import clsx from 'clsx'
import { TIP_TOKENS } from '@/lib/tokens'
import { formatTokenPopularity, searchTokens } from '@/lib/tokenSearch'
import { EMPTY_RECIPIENT, recipientFromInput } from '@/lib/recipientSearch'
import offersAbi from '@/abis/HupOffers.json'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import RecipientField from '@/components/ui/RecipientField'
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

const LUKSO_CHAIN_IDS = [42, 4201]

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
  // Drafts saved before this field became a RecipientField stored a bare address string, so
  // both shapes have to load. The newer one keeps the address a name already resolved to,
  // rather than making a restored draft re-resolve it.
  const [counterparty, setCounterparty] = useState(() => {
    const saved = draft?.counterparty
    if (typeof saved === 'string') return recipientFromInput(saved)
    if (saved?.input) return { input: saved.input, address: saved.address ?? null, profile: null }
    return EMPTY_RECIPIENT
  })
  const [customPayment, setCustomPayment] = useState(draft?.customPayment ?? '')
  const [expirySeconds, setExpirySeconds] = useState(draft?.expirySeconds ?? EXPIRY_OPTIONS[2].seconds)
  // Two independent result lists: both fields can be mid-search at once, and one field's
  // results must never surface under the other
  const [assetResults, setAssetResults] = useState([])
  const [paymentResults, setPaymentResults] = useState([])

  const chainId = chain.id
  const nativeCurrency = chain.nativeCurrency
  const curatedTokens = TIP_TOKENS[chainId] ?? []
  // LSP7 only exists on LUKSO, so offering it as a payment standard anywhere else would just
  // be a way to post a deal nobody can fund
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

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

  // Debounced name search for the asset field, same shape as OfferModal's payment-token
  // search. A pasted address never triggers it (isAddress short-circuits), so the paste path
  // stays exactly as fast as it was before the field learned to search.
  useEffect(() => {
    if (isNativeAsset || isAddress(trimmedAsset) || trimmedAsset.length < 2) return

    let cancelled = false
    const timeout = setTimeout(() => {
      searchTokens(chainId, trimmedAsset).then((results) => {
        if (!cancelled) setAssetResults(results)
      })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isNativeAsset, trimmedAsset, chainId])

  // Derived at render rather than cleared from the effect, so picking a result or switching to
  // the native coin hides the list immediately instead of one debounce later
  const assetSuggestions = !isNativeAsset && !isAddress(trimmedAsset) && trimmedAsset.length >= 2 ? assetResults : []

  const handleSelectToken = (result) => {
    setAssetToken(result.address)
    setAssetResults([])
  }

  const isStandardKnown = isNativeAsset || isLsp7Asset || isErc20Asset
  const asset = useTokenMeta({ chainId, token: assetAddress, isLsp7: isLsp7Asset, nativeCurrency })
  const assetStandard = isNativeAsset ? STANDARD_NATIVE : isLsp7Asset ? STANDARD_LSP7 : STANDARD_ERC20

  const isTokenPayment = paymentChoice !== 'native'
  const listedToken = paymentChoice.startsWith('token:')
    ? curatedTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  // The curated list is a shortcut, not the boundary — the contract escrows any ERC20 or LSP7,
  // so paying with a token nobody curated (selling your own LSP7 for the native coin, say) is
  // a matter of naming it. Unlike the asset side the standard is chosen rather than probed:
  // the offerer already knows what they hold, and the escrow pull happens in the same
  // transaction, so a wrong answer fails immediately instead of posting an unfillable deal.
  const isCustomPayment = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  const trimmedCustomPayment = customPayment.trim()
  const paymentAddress = listedToken?.address ?? (isCustomPayment && isAddress(trimmedCustomPayment) ? trimmedCustomPayment : null)
  const isPaymentLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)
  const payment = useTokenMeta({ chainId, token: paymentAddress, isLsp7: isPaymentLsp7, nativeCurrency })

  // Same search for the payment side, so the token you pay with is as findable as the one you
  // want. Only the custom options search — a curated pick is already an address. Declared here
  // rather than beside the asset search because it reads the derivations just above it.
  useEffect(() => {
    if (!isCustomPayment || isAddress(trimmedCustomPayment) || trimmedCustomPayment.length < 2) return

    let cancelled = false
    const timeout = setTimeout(() => {
      searchTokens(chainId, trimmedCustomPayment).then((results) => {
        if (!cancelled) setPaymentResults(results)
      })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isCustomPayment, trimmedCustomPayment, chainId])

  const paymentSuggestions =
    isCustomPayment && !isAddress(trimmedCustomPayment) && trimmedCustomPayment.length >= 2 ? paymentResults : []

  // The picked result knows its own standard, so choosing from search also corrects a
  // mismatched ERC20/LSP7 selection rather than leaving it to fail at the approve step
  const handleSelectPayment = (result) => {
    setPaymentChoice(result.isLsp7 ? 'custom-lsp7' : 'custom-erc20')
    setCustomPayment(result.address)
    setPaymentResults([])
  }

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
  // RecipientField resolves a name, ENS or pasted address down to `.address`; anything it
  // could not resolve leaves that null while `.input` still holds what was typed, which is
  // exactly the difference between "empty, so open deal" and "typed something unresolvable"
  const typedCounterparty = counterparty.input.trim()
  const counterpartyArg = counterparty.address ?? zeroAddress
  const isCounterpartyValid = !typedCounterparty || Boolean(counterparty.address)
  const isSelfLock = counterparty.address && address && counterparty.address.toLowerCase() === address.toLowerCase()

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
        // Only the typed text and what it resolved to — the profile behind it carries an
        // avatar URL and follower counts that would bloat the draft and go stale anyway
        JSON.stringify({
          assetKind,
          assetToken,
          assetAmount,
          paymentChoice,
          customPayment,
          price,
          counterparty: { input: counterparty.input, address: counterparty.address },
          expirySeconds,
        })
      )
    } catch (error) {
      console.error('Failed to save OTC draft:', error)
    }
  }, [chainId, assetKind, assetToken, assetAmount, paymentChoice, customPayment, price, counterparty, expirySeconds])

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
    if (!isNativeAsset && !assetAddress) return 'Search for the token you want, or paste its address'
    if (isCustomPayment && !paymentAddress) return "Search for the token you'll pay with, or paste its address"
    if (isCustomPayment && payment.isError) {
      return `No decimals() at that payment address on ${chain.name} — check the address, and that it is the standard you picked`
    }
    if (!isNativeAsset && asset.isError) {
      return `No decimals() at that address on ${chain.name} — it may be an NFT collection, not a token, or deployed on a different chain`
    }
    if (!isNativeAsset && !asset.isResolved) return 'Reading that token…'
    if (!isStandardKnown) return 'That address answers neither ERC20 nor LSP7 — it cannot be delivered by a deal'
    if (isSameToken) return 'The asset and the payment must be different'
    if (amountUnits === null) return 'Enter how much you want to receive'
    if (priceUnits === null) return `Enter the price you'll pay`
    if (!isCounterpartyValid) return `No wallet found for "${typedCounterparty}" — pick one from the list or paste an address`
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
            {/* Name AND symbol, matching the payment select below: several chains name their
                coin after themselves (LUKSO, Monad, Celo), so the name alone reads as a chain
                picker rather than an asset one */}
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
          </select>
        </div>

        {!isNativeAsset && (
          <div className={clsx(styles.deal__field, styles.deal__tokenSearch)}>
            <label htmlFor="dealAssetToken">Search token or paste address</label>
            <input
              type="text"
              id="dealAssetToken"
              value={assetToken}
              onChange={(e) => setAssetToken(e.target.value)}
              placeholder="Token name or 0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {assetSuggestions.length > 0 && (
              <>
                <ul className={styles.deal__tokenResults}>
                  {assetSuggestions.map((result) => {
                    const popularity = formatTokenPopularity(result)
                    return (
                      <li key={result.address}>
                        <button type="button" onClick={() => handleSelectToken(result)}>
                          <span className={styles.deal__tokenResultMain}>
                            <span className={styles.deal__tokenResultSymbol}>{result.symbol}</span>
                            {result.name && <span className={styles.deal__tokenResultName}>{result.name}</span>}
                          </span>
                          <span className={styles.deal__tokenResultMeta}>
                            <span className={styles.deal__tokenResultAddress}>
                              {result.address.slice(0, 6)}…{result.address.slice(-4)}
                            </span>
                            {popularity && <span className={styles.deal__tokenResultPopularity}>{popularity}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.deal__tokenWarning} role="alert">
                  Anyone can create a token with any name — check the contract address before posting.
                </p>
              </>
            )}
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
            <option value="custom-erc20">Another token (ERC20)</option>
            {isLukso && <option value="custom-lsp7">Another token (LSP7)</option>}
          </select>
        </div>

        {isCustomPayment && (
          <div className={clsx(styles.deal__field, styles.deal__tokenSearch)}>
            <label htmlFor="dealCustomPayment">Search token or paste address</label>
            <input
              type="text"
              id="dealCustomPayment"
              value={customPayment}
              onChange={(e) => setCustomPayment(e.target.value)}
              placeholder="Token name or 0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {paymentSuggestions.length > 0 && (
              <>
                <ul className={styles.deal__tokenResults}>
                  {paymentSuggestions.map((result) => {
                    const popularity = formatTokenPopularity(result)
                    return (
                      <li key={result.address}>
                        <button type="button" onClick={() => handleSelectPayment(result)}>
                          <span className={styles.deal__tokenResultMain}>
                            <span className={styles.deal__tokenResultSymbol}>{result.symbol}</span>
                            {result.name && <span className={styles.deal__tokenResultName}>{result.name}</span>}
                          </span>
                          <span className={styles.deal__tokenResultMeta}>
                            <span className={styles.deal__tokenResultAddress}>
                              {result.address.slice(0, 6)}…{result.address.slice(-4)}
                            </span>
                            {popularity && <span className={styles.deal__tokenResultPopularity}>{popularity}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.deal__tokenWarning} role="alert">
                  Anyone can create a token with any name — check the contract address before posting.
                </p>
              </>
            )}
            {paymentAddress && payment.isResolved && (
              <p className={styles.deal__note}>
                {payment.symbol ? `${payment.symbol} · ` : ''}
                {isPaymentLsp7 ? 'LSP7' : 'ERC20'} · {payment.decimals} decimals
              </p>
            )}
          </div>
        )}

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

        {/* Same people-picker as every other recipient field in the app: a name, an ENS name
            or a pasted address all resolve here, and the wallet you're posting from is excluded
            because the contract rejects a deal locked to yourself */}
        <RecipientField
          label="Lock to one wallet (optional)"
          value={counterparty}
          onChange={setCounterparty}
          viewer={address ?? null}
          exclude={address ? [address] : []}
          className={styles.deal__field}
          hint="A locked deal can only be filled by that wallet, so a price agreed privately settles at that price and nobody else can take it first. Leave it empty for an open deal."
        />

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
