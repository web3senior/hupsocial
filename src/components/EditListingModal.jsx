'use client'

import { useEffect, useRef, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, hexToString, isAddress, parseUnits, zeroAddress } from 'viem'
import clsx from 'clsx'
import { formatBps, splitSalePrice } from '@/lib/tradeFee'
import tradeAbi from '@/abis/HupTrade.json'
import useTradeFee from '@/hooks/useTradeFee'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import styles from './EditListingModal.module.scss'

const LUKSO_CHAIN_IDS = [42]

// Listing terms live onchain; HupTrade caps the referral share at 50% (MAX_REFERRAL_BPS)
const MAX_REFERRAL_PERCENT = 50

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

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

/**
 * Edit Listing Modal
 * Lets the seller change an active HupTrade listing's price, payment token, and referral
 * share without cancelling and re-listing (the NFT never leaves their wallet either way).
 * @param {Object} props
 * @param {number} props.chainId
 * @param {string} props.tradeAddress HupTrade contract address on this chain.
 * @param {bigint} props.listingId
 * @param {string} props.initialToken Current payment token (zeroAddress for native).
 * @param {boolean} props.initialIsTokenLsp7
 * @param {bigint} props.initialPrice
 * @param {number} props.initialReferralBps
 * @param {number} props.initialDecimals Decimals of the current payment token/native currency.
 * @param {Object} [props.nativeCurrency] Chain's native currency (symbol/decimals).
 * @param {Array} [props.tipTokens] Curated ERC20/LSP7 tokens for this chain (from TIP_TOKENS).
 * @param {Function} props.onClose
 * @param {Function} props.onUpdated Called after the update transaction confirms.
 */
const EditListingModal = ({
  chainId,
  tradeAddress,
  listingId,
  initialToken,
  initialIsTokenLsp7,
  initialPrice,
  initialReferralBps,
  initialDecimals,
  nativeCurrency,
  tipTokens = [],
  onClose,
  onUpdated,
}) => {
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)
  const isInitialNative = !initialToken || initialToken === zeroAddress
  const initialCurated = !isInitialNative ? tipTokens.find((t) => t.address.toLowerCase() === initialToken.toLowerCase()) : null

  const [price, setPrice] = useState(
    initialPrice !== undefined && initialDecimals !== undefined ? formatUnits(initialPrice, initialDecimals) : '',
  )
  const [paymentChoice, setPaymentChoice] = useState(
    isInitialNative ? 'native' : initialCurated ? `token:${initialCurated.address}` : initialIsTokenLsp7 ? 'custom-lsp7' : 'custom-erc20',
  )
  const [customToken, setCustomToken] = useState(!isInitialNative && !initialCurated ? initialToken : '')
  const [referralPercent, setReferralPercent] = useState(String((initialReferralBps ?? 0) / 100))

  const dialogRef = useRef(null)

  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  const listedToken = paymentChoice.startsWith('token:') ? tipTokens.find((t) => t.address === paymentChoice.slice('token:'.length)) : null
  const trimmedCustomToken = customToken.trim()
  const tokenAddress = listedToken ? listedToken.address : isCustomToken && isAddress(trimmedCustomToken) ? trimmedCustomToken : null
  const isTokenLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)
  const isNativePrice = paymentChoice === 'native'

  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(tokenAddress) },
  })

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

  const symbol = isNativePrice
    ? nativeCurrency?.symbol || ''
    : listedToken
    ? listedToken.symbol
    : paymentChoice === 'custom-lsp7'
    ? lsp4Symbol || 'tokens'
    : customSymbol || 'tokens'
  const decimals = isNativePrice ? nativeCurrency?.decimals ?? 18 : tokenAddress ? tokenDecimals : undefined

  const parsedPrice = Number(price)
  const isValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0
  let priceUnits = null
  if (isValidPrice && decimals !== undefined) {
    try {
      priceUnits = parseUnits(price, decimals)
    } catch {
      priceUnits = null
    }
  }

  const parsedReferral = Number(referralPercent)
  const isValidReferral = Number.isFinite(parsedReferral) && parsedReferral >= 0 && parsedReferral <= MAX_REFERRAL_PERCENT
  const referralBps = isValidReferral ? Math.round(parsedReferral * 100) : null

  // Repricing changes what actually lands in the seller's wallet — quote the live split
  // rather than making them work the fee out from the new price
  const { feeBps, feePercent } = useTradeFee({ chainId, tradeAddress })
  const split = splitSalePrice(isValidPrice ? parsedPrice : 0, feeBps, referralBps)
  const showSplit = isValidPrice && referralBps !== null && Boolean(feeBps > 0 || referralBps > 0)

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  // Mount = open / unmount = close, matching SellNftModal's dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    toast('Listing updated', 'success')
    onUpdated?.()
    dialogRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const canSubmit = priceUnits !== null && referralBps !== null && (!isCustomToken || Boolean(tokenAddress))

  const handleSubmit = (e) => {
    e.stopPropagation()
    if (!canSubmit) return

    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'updateListing',
      args: [listingId, tokenAddress ?? zeroAddress, isTokenLsp7, priceUnits, BigInt(referralBps)],
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.editListingModal}
      aria-label="Edit listing"
      onClick={(e) => e.stopPropagation()}
      // Rendered inside a post — React's synthetic close/cancel events propagate up the
      // component tree, and without these the post's own dialogs (if any) would close too
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <header className={styles.editListingModal__header}>
        <button type="button" className={styles.editListingModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Edit listing</h3>
      </header>

      <main className={styles.editListingModal__body}>
        <div className={styles.editListingModal__field}>
          <label htmlFor="editListingToken">Sell for</label>
          <select id="editListingToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
            <option value="native">{`${nativeCurrency?.name || 'Native'} (${nativeCurrency?.symbol || ''})`}</option>
            {tipTokens.map((token) => (
              <option key={token.address} value={`token:${token.address}`}>
                {token.symbol}
              </option>
            ))}
            <option value="custom-erc20">Custom ERC20</option>
            {isLukso && <option value="custom-lsp7">Custom LSP7</option>}
          </select>
        </div>

        {isCustomToken && (
          <div className={styles.editListingModal__field}>
            <label htmlFor="editListingCustomToken">Token address</label>
            <input
              type="text"
              id="editListingCustomToken"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className={styles.editListingModal__field}>
          <label htmlFor="editListingPrice">Price</label>
          <div className={styles.editListingModal__amount}>
            <input
              type="number"
              id="editListingPrice"
              value={price}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
            <span className={styles.editListingModal__amountSymbol}>{symbol}</span>
          </div>
        </div>

        <div className={styles.editListingModal__field}>
          <label htmlFor="editListingReferral">Referral reward %</label>
          <input
            type="number"
            id="editListingReferral"
            value={referralPercent}
            min={0}
            max={MAX_REFERRAL_PERCENT}
            step="any"
            inputMode="decimal"
            onChange={(e) => setReferralPercent(e.target.value)}
          />
          <p className={styles.editListingModal__hint}>
            Share of the price paid to whoever's repost leads to the sale (0–{MAX_REFERRAL_PERCENT}%)
          </p>
        </div>

        {/* Same split panel the listing form shows — platform fee, referral, then the rest */}
        {feeBps !== null && (
          <div className={styles.editListingModal__split}>
            {showSplit ? (
              <>
                <p className={styles.editListingModal__splitRow}>
                  <span>Buyer pays</span>
                  <strong>
                    {amountFormat.format(parsedPrice)} {symbol}
                  </strong>
                </p>
                {feeBps > 0 && (
                  <p className={styles.editListingModal__splitRow}>
                    <span>Platform fee ({feePercent})</span>
                    <span>
                      −{amountFormat.format(split.fee)} {symbol}
                    </span>
                  </p>
                )}
                {referralBps > 0 && (
                  <p className={styles.editListingModal__splitRow}>
                    <span>Referral ({formatBps(referralBps)})</span>
                    <span>
                      −{amountFormat.format(split.referral)} {symbol}
                    </span>
                  </p>
                )}
                <p className={clsx(styles.editListingModal__splitRow, styles['editListingModal__splitRow--total'])}>
                  <span>You receive</span>
                  <strong>
                    {amountFormat.format(split.seller)} {symbol}
                  </strong>
                </p>
              </>
            ) : (
              <p className={styles.editListingModal__splitHint}>
                {feeBps > 0
                  ? `Platform fee: ${feePercent} of the sale price, taken from your proceeds.`
                  : 'No platform fee on this network — you receive the full sale price.'}
              </p>
            )}
          </div>
        )}
      </main>

      <footer className={styles.editListingModal__footer}>
        <button type="button" className={clsx(styles.editListingModal__submit)} onClick={handleSubmit} disabled={isBusy || !canSubmit}>
          {isBusy ? 'Confirming...' : 'Save changes'}
        </button>
      </footer>
    </NativeDialog>
  )
}

export default EditListingModal
