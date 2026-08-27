'use client'

import { useState, useEffect, useRef } from 'react'
import { useConnection, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { encodeAbiParameters, erc20Abi, hexToString, isAddress, parseUnits, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import { searchTokens } from '@/lib/tokenSearch'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { trackTip } from '@/lib/tipTracking'
import { shortTxError } from '@/lib/utils'
import tipperAbi from '@/abis/HupTipper.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import Profile from './Profile'
import styles from './TipModal.module.scss'

const TIP_PRESETS = [1, 2, 5, 10]

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
// The amount the way the button and the toast both say it — "5 LYX", "0.25 G$"
const amountNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

// An approval only unlocks the send button, so the modal stays open while it mines — but not
// past this, or a transaction nobody will ever see mined keeps the button locked forever
const APPROVAL_TIMEOUT_MS = 120_000

// Popularity line for a search result — the signal that separates the real token from
// same-name copycats (LUKSO returns holder counts, GeckoTerminal pool liquidity)
const formatTokenPopularity = (result) => {
  if (result.holderCount !== null && result.holderCount !== undefined) {
    return `${compactNumber.format(result.holderCount)} ${result.holderCount === 1 ? 'holder' : 'holders'}`
  }
  if (result.liquidityUsd) return `$${compactNumber.format(result.liquidityUsd)} liquidity`
  return null
}

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

// ERC677 (e.g. GoodDollar) — transferAndCall moves the tokens and invokes the tipper's
// onTokenTransfer in the same transaction, so no approve step is needed at all
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

// The payload HupTipper.onTokenTransfer decodes to learn which post to credit
const encodeErc677TipData = (postId, memo = '0x') =>
  encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes' }], [postId, memo])

/**
 * Tip Modal
 * Sends a tip for a post through HupTipper in the native coin, a curated popular token
 * (TIP_TOKENS, listed by name so no address pasting), or a custom ERC20/LSP7 address.
 * The recipient is resolved onchain from the post's creator.
 * @param {Object} props
 * @param {Object} props.item Core content model with network metadata.
 * @param {Function} props.setShowTipModal Clears the open-modal state on close.
 */
const TipModal = ({ item, setShowTipModal }) => {
  const [amount, setAmount] = useState('1')
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [tokenSearchResults, setTokenSearchResults] = useState([])
  // Flipped on synchronously at the top of every send handler so the button locks on the
  // click itself — the session check is two RPC round trips, and wagmi only reports isPending
  // once the write actually starts. Held until the handler settles: for a tip that is the
  // hash (the modal closes on it), for an approval it is the receipt (the modal stays open).
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { address } = useConnection()
  const dialogRef = useRef(null)
  const creator = item.wallet_address

  // Tips settle on the post's own chain, not whichever chain is currently active
  const chainId = Number(item.network_id)
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((c) => c.id === chainId)
  const tipperAddress = CONTRACTS[`chain${chainId}`]?.tipper || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const tipTokens = TIP_TOKENS[chainId] ?? []
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  const isTokenTip = paymentChoice !== 'native'
  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  // Curated entries are selected by address ("token:0x..."), so the option value alone
  // pins the exact contract the user saw in the list
  const listedToken = paymentChoice.startsWith('token:')
    ? tipTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  // Trimmed once so a pasted-with-whitespace address and a typed search query are both
  // read consistently below (isAddress has no whitespace tolerance)
  const trimmedCustomToken = customToken.trim()
  // Invalid/incomplete custom addresses resolve to null — every downstream read stays
  // disabled and the send button locked until a real address is pasted or picked from search
  const tokenAddress = listedToken ? listedToken.address : isCustomToken && isAddress(trimmedCustomToken) ? trimmedCustomToken : null
  const isLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)
  // Only curated entries can be ERC677: the tipper rejects onTokenTransfer from any token it
  // hasn't whitelisted, so a pasted address always takes the approve path
  const isErc677 = Boolean(listedToken?.erc677)
  const isSelf = address?.toLowerCase() === creator?.toLowerCase()

  // Debounced name search for the custom-token field — a pasted address never triggers a
  // search (isAddress short-circuits it), so picking from TIP_TOKENS or pasting stays
  // exactly as fast as before. Only the "search by name" path waits on the network.
  useEffect(() => {
    if (!isCustomToken || isAddress(trimmedCustomToken) || trimmedCustomToken.length < 2) {
      setTokenSearchResults([])
      return
    }

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

  const handleSelectSearchResult = (result) => {
    setPaymentChoice(result.isLsp7 ? 'custom-lsp7' : 'custom-erc20')
    setCustomToken(result.address)
    setTokenSearchResults([])
  }

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(isTokenTip && tokenAddress) },
  })

  // Custom ERC20s expose symbol(); custom LSP7s don't — their symbol comes from LSP4
  // metadata in ERC725Y storage instead, so each custom mode reads its own source
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

  const symbol = !isTokenTip
    ? nativeCurrency?.symbol || ''
    : listedToken
    ? listedToken.symbol
    : paymentChoice === 'custom-lsp7'
    ? lsp4Symbol || 'tokens'
    : customSymbol || 'tokens'
  const decimals = isTokenTip ? tokenDecimals : nativeCurrency?.decimals ?? 18

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
    args: [address, tipperAddress],
    chainId,
    query: { enabled: Boolean(isTokenTip && !isLsp7 && !isErc677 && tokenAddress && address && tipperAddress) },
  })

  const { data: lsp7Allowance, refetch: refetchLsp7Allowance } = useReadContract({
    abi: lsp7Abi,
    address: tokenAddress,
    functionName: 'authorizedAmountFor',
    args: [tipperAddress, address],
    chainId,
    query: { enabled: Boolean(isLsp7 && tokenAddress && address && tipperAddress) },
  })

  const allowance = isLsp7 ? lsp7Allowance : erc20Allowance
  const refetchAllowance = isLsp7 ? refetchLsp7Allowance : refetchErc20Allowance
  // ERC677 funds and credits the tip in one transaction, so it never needs an allowance
  const needsApproval = isTokenTip && !isErc677 && allowance !== undefined && amountUnits !== null && allowance < amountUnits

  const { isPending, writeContractAsync } = useWriteContract()
  const isBusy = isPending || isSubmitting

  const amountLabel = `${amountNumber.format(parsedAmount)} ${symbol}`

  // Mount = open / unmount = close, matching the NewPost dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  // The transaction is sent: the modal's job is done. Everything after — the receipt, the
  // toast that reports it, the counter — is handed to trackTip, which outlives this component,
  // so the user goes back to the feed instead of watching a button say "Confirming" for a block.
  const handOff = (hash) => {
    trackTip({ post: item, viewer: address, hash, amountLabel })
    dialogRef.current?.close()
  }

  // An approval can't close the modal — the tip it unlocks is still to be sent from here — so
  // it holds the button while it mines, but the wait is reported by a toast the user can
  // ignore rather than a frozen label. The onchain allowance is re-read whatever happened.
  const handleApprove = async (e) => {
    e.stopPropagation()
    if (amountUnits === null || !tokenAddress) return

    setIsSubmitting(true)
    let handle = null
    const report = (message, type) => {
      if (!handle?.update(message, type)) toast(message, type)
    }

    try {
      const hash = await writeContractAsync(
        isLsp7
          ? { abi: lsp7Abi, address: tokenAddress, functionName: 'authorizeOperator', args: [tipperAddress, amountUnits, '0x'], chainId }
          : { abi: erc20Abi, address: tokenAddress, functionName: 'approve', args: [tipperAddress, amountUnits], chainId }
      )

      handle = toast(`Approving ${symbol}…`, 'loading')
      const receipt = await waitForTransactionReceipt(config, { chainId, hash, timeout: APPROVAL_TIMEOUT_MS })
      if (receipt.status !== 'success') throw new Error(`${symbol} approval was rejected onchain`)

      report(`${symbol} approved — send your tip`, 'success')
    } catch (err) {
      report(shortTxError(err, 'Approval failed'), 'error')
    } finally {
      refetchAllowance()
      setIsSubmitting(false)
    }
  }

  const handleTip = async (e) => {
    e.stopPropagation()
    if (amountUnits === null || !tipperAddress || (isTokenTip && !tokenAddress)) return

    setIsSubmitting(true)
    try {
      // ERC677: one transaction, no approve. The tipper is credited from onTokenTransfer, which
      // reads the post id out of the payload. Burner sessions can't apply here — the tokens have
      // to leave the wallet that actually holds them — so this path always uses wagmi.
      if (isErc677) {
        const hash = await writeContractAsync({
          abi: erc677Abi,
          address: tokenAddress,
          functionName: 'transferAndCall',
          args: [tipperAddress, amountUnits, encodeErc677TipData(BigInt(item.id))],
          chainId,
        })
        handOff(hash)
        return
      }

      // The recipient is resolved onchain by HupTipper from the post's creator — the client
      // only commits the post id, amount, and token
      const args = [address, BigInt(item.id), amountUnits, tokenAddress ?? zeroAddress, isLsp7, '0x']

      // Route through the burner session key if one's active — same convenience BuyButton gets,
      // skipping the wallet popup. Approve/authorizeOperator stays wagmi-only regardless.
      const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

      if (session.active) {
        // Back at the hash, not the receipt — the tracker does the waiting, not the modal
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: tipperAddress,
          abi: tipperAbi,
          functionName: 'tip',
          args: isTokenTip ? args : [...args, { value: amountUnits }],
          waitForReceipt: false,
        })
        handOff(tx.hash)
        return
      }

      const hash = await writeContractAsync({
        abi: tipperAbi,
        address: tipperAddress,
        functionName: 'tip',
        args,
        chainId,
        ...(isTokenTip ? {} : { value: amountUnits }),
      })
      handOff(hash)
    } catch (err) {
      toast(shortTxError(err, 'Tip failed'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.tipModal}
      aria-label="Support creator"
      onClick={(e) => e.stopPropagation()}
      onClose={() => setShowTipModal()}
    >
      <header className={styles.tipModal__header}>
        <button type="button" className={styles.tipModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Support creator</h3>
      </header>

      <main className={styles.tipModal__body}>
        <div className={styles.tipModal__recipient}>
          <Profile variant="fullWithoutTime" creator={creator} networkId={item.network_id} />
          <p className={styles.tipModal__recipientNote}>
            {isSelf ? `This is your own post` : `Your tip goes directly to the creator's wallet`}
          </p>
        </div>

        <div className={styles.tipModal__field}>
          <label htmlFor="tipModalToken">Token</label>
          <select id="tipModalToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
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
          <div className={clsx(styles.tipModal__field, styles.tipModal__tokenSearch)}>
            <label htmlFor="tipModalCustomToken">Search token or paste address</label>
            <input
              type="text"
              id="tipModalCustomToken"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="Token name or 0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {tokenSearchResults.length > 0 && (
              <>
                <ul className={styles.tipModal__tokenResults}>
                  {tokenSearchResults.map((result) => {
                    const popularity = formatTokenPopularity(result)
                    return (
                      <li key={result.address}>
                        <button type="button" onClick={() => handleSelectSearchResult(result)}>
                          <span className={styles.tipModal__tokenResultMain}>
                            <span className={styles.tipModal__tokenResultSymbol}>{result.symbol}</span>
                            {result.name && <span className={styles.tipModal__tokenResultName}>{result.name}</span>}
                          </span>
                          <span className={styles.tipModal__tokenResultMeta}>
                            <span className={styles.tipModal__tokenResultAddress}>
                              {result.address.slice(0, 6)}…{result.address.slice(-4)}
                            </span>
                            {popularity && <span className={styles.tipModal__tokenResultPopularity}>{popularity}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.tipModal__tokenWarning} role="alert">
                  Anyone can create a token with any name — check the contract address before tipping.
                </p>
              </>
            )}
          </div>
        )}

        <div className={styles.tipModal__field}>
          <label htmlFor="tipModalAmount">Amount</label>
          <div className={styles.tipModal__amount}>
            <input
              type="number"
              id="tipModalAmount"
              value={amount}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
            <span className={styles.tipModal__amountSymbol}>{symbol}</span>
          </div>
          <div className={styles.tipModal__presets}>
            {TIP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(styles.tipModal__preset, parsedAmount === preset && styles['tipModal__preset--active'])}
                onClick={() => setAmount(`${preset}`)}
              >
                {preset} {symbol}
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className={styles.tipModal__footer}>
        {!tipperAddress && <p className={styles.tipModal__hint}>Tipping isn&apos;t available on this network yet</p>}
        {needsApproval ? (
          <button type="button" className={styles.tipModal__send} onClick={handleApprove} disabled={isBusy || amountUnits === null || isSelf}>
            {isBusy ? 'Approving…' : `Approve ${amountLabel}`}
          </button>
        ) : (
          <button
            type="button"
            className={styles.tipModal__send}
            onClick={handleTip}
            disabled={isBusy || amountUnits === null || isSelf || !tipperAddress}
          >
            {isBusy ? 'Sending…' : isValidAmount ? `Send ${amountLabel}` : `Send`}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default TipModal
