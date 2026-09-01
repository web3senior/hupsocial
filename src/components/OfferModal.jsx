'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { encodeAbiParameters, erc20Abi, hexToString, isAddress, numberToHex, parseUnits, zeroAddress } from 'viem'
import clsx from 'clsx'
// Both from config/contracts, never config/wagmi: this dialog is reached from the collection
// grid, whose route graph is evaluated server-side, and importing the wagmi config there
// constructs connectors during that pass
import { appChains, CONTRACTS } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import { searchTokens } from '@/lib/tokenSearch'
import offersAbi from '@/abis/HupOffers.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import styles from './OfferModal.module.scss'

// IHupOffers.AssetStandard — this modal only fronts the one-of-one standards; the
// fungible/edition standards get their own OTC surface later
const STANDARD_ERC721 = 0
const STANDARD_LSP8 = 1

// IHupOffers ERC677 payload action byte: fund and create a new offer in one transferAndCall
const ERC677_ACTION_MAKE = 1

// Chains whose native asset standard is LSP7, so the custom-token field offers that option.
// LSP7 is a LUKSO standard, so the token pickers only offer it there.
const LUKSO_CHAIN_IDS = [42]

// LSP7 has no symbol() — LSP4 metadata lives in ERC725Y storage, read via getData
// with the keccak256('LSP4TokenSymbol') data key
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'
const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

// Popularity line for a search result — the signal that separates the real token from
// same-name copycats (LUKSO returns holder counts, GeckoTerminal pool liquidity)
const formatTokenPopularity = (result) => {
  if (result.holderCount !== null && result.holderCount !== undefined) {
    return `${compactNumber.format(result.holderCount)} ${result.holderCount === 1 ? 'holder' : 'holders'}`
  }
  if (result.liquidityUsd) return `$${compactNumber.format(result.liquidityUsd)} liquidity`
  return null
}

const EXPIRY_OPTIONS = [
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 3 * 86400 },
  { label: '7 days', seconds: 7 * 86400 },
  { label: '30 days', seconds: 30 * 86400 },
]

// LSP7 Digital Asset (LUKSO) — operator-based equivalents of allowance/approve
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

// ERC677 (e.g. GoodDollar) — transferAndCall moves the tokens and invokes the offers
// contract's onTokenTransfer in the same transaction, so no approve step is needed at all
const erc677Abi = [
  {
    type: 'function',
    name: 'transferAndCall',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
]

// Owner lookups only — the approval/operator sides of both standards moved to OfferList
// with the accept flow they serve
const erc721Abi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
]

// LSP8 Identifiable Digital Asset (LUKSO)
const lsp8Abi = [
  {
    type: 'function',
    name: 'tokenOwnerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
]

// The payload HupOffers.onTokenTransfer decodes to create the offer it was just funded for
const encodeErc677MakeData = (collection, tokenId, standard, amount, expiresAt, counterparty) =>
  encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'bytes' }],
    [
      ERC677_ACTION_MAKE,
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
        [collection, tokenId, standard, amount, expiresAt, counterparty]
      ),
    ]
  )

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

const computeExpiresAt = (seconds) => BigInt(Math.floor(Date.now() / 1000) + seconds)

// HupOffers keys tokens by bytes32 for both standards. Indexed rows already carry the hex
// form; chain-enumerated ERC721 ids can arrive as plain decimals, so normalize once here.
const toBytes32TokenId = (raw) => {
  const value = String(raw)
  if (value.startsWith('0x')) return value
  try {
    return numberToHex(BigInt(value), { size: 32 })
  } catch {
    return value
  }
}

/**
 * Offer Modal
 * Escrow-backed offers on a single one-of-one NFT through HupOffers: locks the payment up
 * front (native coin, a curated token, or a whitelisted ERC677 token in one transferAndCall).
 * Make-only by design — viewing, accepting, and cancelling offers live on the listing page's
 * OfferList table and the /nfts/offers page, not behind this dialog.
 * @param {Object} props
 * @param {number} props.chainId The asset's chain.
 * @param {string} props.collection The NFT contract address.
 * @param {string} props.tokenId The token id as bytes32 hex (both standards).
 * @param {boolean} props.isLsp8 True for LSP8 collections, false for ERC721.
 * @param {string} [props.assetName] Display name for the header ("Anti Crypto Club #86").
 * @param {string} [props.ownerAddress] The token's current owner when the caller already
 *        knows it (a live listing's seller). Omit it and the modal reads the owner from the
 *        chain instead — either way it unlocks the accept flow and blocks self-offers.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const OfferModal = ({ chainId, collection, tokenId: tokenIdProp, isLsp8, assetName, ownerAddress, onClose }) => {
  const tokenId = toBytes32TokenId(tokenIdProp)
  const [amount, setAmount] = useState('')
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [tokenSearchResults, setTokenSearchResults] = useState([])
  const [expirySeconds, setExpirySeconds] = useState(EXPIRY_OPTIONS[2].seconds)
  const { address } = useConnection()
  const dialogRef = useRef(null)
  const lastActionRef = useRef(null)

  const chainInfo = appChains.find((c) => c.id === chainId)
  const offersAddress = CONTRACTS[`chain${chainId}`]?.offers || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const offerTokens = TIP_TOKENS[chainId] ?? []
  const standard = isLsp8 ? STANDARD_LSP8 : STANDARD_ERC721

  const isTokenPayment = paymentChoice !== 'native'
  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)
  // Curated entries are selected by address ("token:0x..."), so the option value alone pins
  // the exact contract the user saw in the list
  const listedToken = paymentChoice.startsWith('token:')
    ? offerTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  // Trimmed once so a pasted-with-whitespace address and a typed search query are both read
  // consistently below (isAddress has no whitespace tolerance)
  const trimmedCustomToken = customToken.trim()
  // Invalid/incomplete custom addresses resolve to null — every downstream read stays disabled
  // and the offer button locked until a real address is pasted or picked from search
  const tokenAddress = listedToken ? listedToken.address : isCustomToken && isAddress(trimmedCustomToken) ? trimmedCustomToken : null
  const isTokenLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)
  // Only curated entries can be ERC677: the offers contract rejects onTokenTransfer from any
  // token it hasn't whitelisted, so a pasted address always takes the approve path
  const isErc677 = Boolean(listedToken?.erc677)

  // Debounced name search for the custom-token field — a pasted address never triggers a
  // search (isAddress short-circuits it), so picking from the curated list or pasting stays
  // exactly as fast as before. Only the "search by name" path waits on the network.
  useEffect(() => {
    if (!isCustomToken || isAddress(trimmedCustomToken) || trimmedCustomToken.length < 2) return

    let cancelled = false
    const timeout = setTimeout(() => {
      searchTokens(chainId, trimmedCustomToken).then((results) => {
        if (!cancelled) setTokenSearchResults(results)
      })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isCustomToken, trimmedCustomToken, chainId])

  // Whether the stored results still belong to what's in the field — derived at render rather
  // than cleared from the effect, so a pasted address or a switch back to a curated token hides
  // the previous query's list immediately instead of one debounce later
  const searchResults = isCustomToken && !isAddress(trimmedCustomToken) && trimmedCustomToken.length >= 2 ? tokenSearchResults : []

  const handleSelectSearchResult = (result) => {
    setPaymentChoice(result.isLsp7 ? 'custom-lsp7' : 'custom-erc20')
    setCustomToken(result.address)
    setTokenSearchResults([])
  }

  // Ownership decides two things — whether the accept flow appears, and whether making an
  // offer is blocked as a self-offer. Callers that already know the owner (a live listing's
  // seller) pass it in; everywhere else — the collection grid, an unlisted token — it comes
  // from the chain, which is also the only source that can't be stale.
  const { data: erc721Owner } = useReadContract({
    abi: erc721Abi,
    address: collection,
    functionName: 'ownerOf',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(!ownerAddress && !isLsp8 && tokenId && collection) },
  })

  const { data: lsp8Owner } = useReadContract({
    abi: lsp8Abi,
    address: collection,
    functionName: 'tokenOwnerOf',
    args: [tokenId],
    chainId,
    query: { enabled: Boolean(!ownerAddress && isLsp8 && tokenId && collection) },
  })

  const owner = ownerAddress || (isLsp8 ? lsp8Owner : erc721Owner) || null
  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase())

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(isTokenPayment && tokenAddress) },
  })

  // Custom ERC20s expose symbol(); custom LSP7s don't — their symbol comes from LSP4 metadata
  // in ERC725Y storage instead, so each custom mode reads its own source
  const { data: customSymbol } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'symbol',
    chainId,
    query: { enabled: Boolean(paymentChoice === 'custom-erc20' && tokenAddress) },
  })

  const { data: lsp4SymbolBytes } = useReadContract({
    abi: erc725yAbi,
    address: tokenAddress,
    functionName: 'getData',
    args: [LSP4_TOKEN_SYMBOL_KEY],
    chainId,
    query: { enabled: Boolean(paymentChoice === 'custom-lsp7' && tokenAddress) },
  })
  let lsp4Symbol = null
  if (lsp4SymbolBytes && lsp4SymbolBytes !== '0x') {
    try {
      lsp4Symbol = hexToString(lsp4SymbolBytes).trim() || null
    } catch {
      lsp4Symbol = null
    }
  }

  const symbol = !isTokenPayment
    ? nativeCurrency?.symbol || ''
    : listedToken
      ? listedToken.symbol
      : paymentChoice === 'custom-lsp7'
        ? lsp4Symbol || 'tokens'
        : customSymbol || 'tokens'
  const decimals = isTokenPayment ? tokenDecimals : (nativeCurrency?.decimals ?? 18)

  const parsedAmount = Number(amount)
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  let amountUnits = null
  if (isValidAmount && decimals !== undefined) {
    try {
      amountUnits = parseUnits(amount, decimals)
    } catch {
      amountUnits = null
    }
  }

  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'allowance',
    args: [address, offersAddress],
    chainId,
    query: { enabled: Boolean(isTokenPayment && !isTokenLsp7 && !isErc677 && tokenAddress && address && offersAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: tokenAddress,
    functionName: 'authorizedAmountFor',
    args: [offersAddress, address],
    chainId,
    query: { enabled: Boolean(isTokenLsp7 && tokenAddress && address && offersAddress) },
  })

  const allowance = isTokenLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isTokenLsp7 ? refetchLsp7Allowance : refetchErc20Allowance
  // ERC677 funds and creates the offer in one transaction, so it never needs an allowance
  const needsPaymentApproval = isTokenPayment && !isErc677 && allowance !== undefined && amountUnits !== null && allowance < amountUnits

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  // Mount = open / unmount = close, matching the TipModal dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve-payment') {
      toast('Token approved — you can place your offer now', 'success')
      refetchAllowance()
    } else if (lastActionRef.current === 'make') {
      toast('Offer placed — your payment is escrowed until it fills, expires, or you cancel', 'success')
      dialogRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprovePayment = (e) => {
    e.stopPropagation()
    if (amountUnits === null || !tokenAddress || !offersAddress) return

    lastActionRef.current = 'approve-payment'
    if (isTokenLsp7) {
      writeContract({
        abi: lsp7Abi,
        address: tokenAddress,
        functionName: 'authorizeOperator',
        args: [offersAddress, amountUnits, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [offersAddress, amountUnits],
        chainId,
      })
    }
  }

  // Every offers write goes through the connected wallet. HupOffers has no forwarder and no
  // burner-session resolution — it credits msg.sender and nothing else — because both sides of
  // an offer must already control value, so relaying would only add an impersonation surface.
  const handleMakeOffer = (e) => {
    e.stopPropagation()
    if (amountUnits === null || !offersAddress || (isTokenPayment && !tokenAddress)) return

    const expiresAt = computeExpiresAt(expirySeconds)

    // ERC677: one transaction, no approve. The offer is created from onTokenTransfer, which
    // reads the asset out of the payload.
    if (isErc677) {
      lastActionRef.current = 'make'
      writeContract({
        abi: erc677Abi,
        address: tokenAddress,
        functionName: 'transferAndCall',
        args: [offersAddress, amountUnits, encodeErc677MakeData(collection, tokenId, standard, 1n, expiresAt, zeroAddress)],
        chainId,
      })
      return
    }

    lastActionRef.current = 'make'
    writeContract({
      abi: offersAbi,
      address: offersAddress,
      functionName: 'makeOffer',
      args: [collection, tokenId, standard, tokenAddress ?? zeroAddress, isTokenLsp7, amountUnits, 1n, expiresAt, zeroAddress],
      chainId,
      ...(isTokenPayment ? {} : { value: amountUnits }),
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.offerModal}
      aria-label="Make an offer"
      onClick={(e) => e.stopPropagation()}
      // React's synthetic close/cancel bubble where the native events don't — without this,
      // dismissing this dialog from inside another one (the token detail panel's offer action)
      // would close its host too
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <header className={styles.offerModal__header}>
        <button type="button" className={styles.offerModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Make an offer</h3>
      </header>

      <main className={styles.offerModal__body}>
        {assetName && <p className={styles.offerModal__asset}>{assetName}</p>}

        <div className={styles.offerModal__field}>
          <label htmlFor="offerModalToken">Pay with</label>
          <select id="offerModalToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
            {offerTokens.map((token) => (
              <option key={token.address} value={`token:${token.address}`}>
                {token.symbol}
              </option>
            ))}
            <option value="custom-erc20">Custom ERC20</option>
            {isLukso && <option value="custom-lsp7">Custom LSP7</option>}
          </select>
        </div>

        {isCustomToken && (
          <div className={clsx(styles.offerModal__field, styles.offerModal__tokenSearch)}>
            <label htmlFor="offerModalCustomToken">Search token or paste address</label>
            <input
              type="text"
              id="offerModalCustomToken"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="Token name or 0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {searchResults.length > 0 && (
              <>
                <ul className={styles.offerModal__tokenResults}>
                  {searchResults.map((result) => {
                    const popularity = formatTokenPopularity(result)
                    return (
                      <li key={result.address}>
                        <button type="button" onClick={() => handleSelectSearchResult(result)}>
                          <span className={styles.offerModal__tokenResultMain}>
                            <span className={styles.offerModal__tokenResultSymbol}>{result.symbol}</span>
                            {result.name && <span className={styles.offerModal__tokenResultName}>{result.name}</span>}
                          </span>
                          <span className={styles.offerModal__tokenResultMeta}>
                            <span className={styles.offerModal__tokenResultAddress}>
                              {result.address.slice(0, 6)}…{result.address.slice(-4)}
                            </span>
                            {popularity && <span className={styles.offerModal__tokenResultPopularity}>{popularity}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.offerModal__tokenWarning} role="alert">
                  Anyone can create a token with any name — check the contract address before offering.
                </p>
              </>
            )}
          </div>
        )}

        <div className={styles.offerModal__field}>
          <label htmlFor="offerModalAmount">Offer price</label>
          <div className={styles.offerModal__amount}>
            <input
              type="number"
              id="offerModalAmount"
              value={amount}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <span className={styles.offerModal__amountSymbol}>{symbol}</span>
          </div>
        </div>

        <div className={styles.offerModal__field}>
          <label htmlFor="offerModalExpiry">Expires</label>
          <select id="offerModalExpiry" value={expirySeconds} onChange={(e) => setExpirySeconds(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                {option.label}
              </option>
            ))}
          </select>
          <p className={styles.offerModal__note}>
            Your payment is escrowed in the offers contract. Cancel anytime — expired offers just need a cancel to reclaim.
          </p>
        </div>
      </main>

      <footer className={styles.offerModal__footer}>
        {!offersAddress && <p className={styles.offerModal__hint}>Offers aren&apos;t available on this network yet</p>}
        {isOwner && <p className={styles.offerModal__hint}>You own this NFT — offers on your own token aren&apos;t allowed</p>}
        {!address && offersAddress && <p className={styles.offerModal__hint}>Connect your wallet to make an offer</p>}
        {needsPaymentApproval ? (
          <button
            type="button"
            className={styles.offerModal__send}
            onClick={handleApprovePayment}
            disabled={isBusy || amountUnits === null || isOwner}
          >
            {isBusy ? 'Confirming...' : `Approve ${amountFormat.format(parsedAmount)} ${symbol}`}
          </button>
        ) : (
          <button
            type="button"
            className={styles.offerModal__send}
            onClick={handleMakeOffer}
            disabled={isBusy || amountUnits === null || isOwner || !offersAddress || !address}
          >
            {isBusy ? 'Confirming...' : isValidAmount ? `Offer ${amountFormat.format(parsedAmount)} ${symbol}` : 'Make offer'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default OfferModal
