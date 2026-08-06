'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnection, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, hexToString, isAddress, pad, parseEventLogs, parseUnits, toHex, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CaretDownIcon, StorefrontIcon, WarningIcon } from '@phosphor-icons/react'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import { searchTokens } from '@/lib/tokenSearch'
import { formatBps, splitSalePrice } from '@/lib/tradeFee'
import tradeAbi from '@/abis/HupTrade.json'
import useTradeFee from '@/hooks/useTradeFee'
import useNftMetadata from '@/hooks/useNftMetadata'
import useCollectionSuggestions from '@/hooks/useCollectionSuggestions'
import useOwnedTokenIds from '@/hooks/useOwnedTokenIds'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import NativePopover from './ui/NativePopover'
import styles from './SellNftModal.module.scss'

const LUKSO_CHAIN_IDS = [42, 4201]

// A listing can only settle where HupTrade is deployed — the network picker offers nothing else
const tradeChains = appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.trade)

// Listing terms live onchain; HupTrade caps the referral share at 50% (MAX_REFERRAL_BPS)
const MAX_REFERRAL_PERCENT = 50

const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`

// Collection suggestions are headed by where they came from — proven onchain ownership is a
// very different claim from "a collection by this name exists"
const COLLECTION_GROUP_LABELS = {
  owned: 'Your NFTs',
  market: 'Trading on Hup',
  search: 'Search results',
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })

// Popularity line for a search result — the signal that separates the real token from
// same-name copycats (LUKSO returns holder counts, GeckoTerminal pool liquidity)
const formatTokenPopularity = (result) => {
  if (result.holderCount !== null && result.holderCount !== undefined) {
    return `${compactNumber.format(result.holderCount)} ${result.holderCount === 1 ? 'holder' : 'holders'}`
  }
  if (result.liquidityUsd) return `$${compactNumber.format(result.liquidityUsd)} liquidity`
  return null
}

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

// LSP8 ids arrive in three dialects — left-padded numbers, utf8 strings, and opaque hashes.
// Decode the string case so a token called "magic" shows as magic rather than 0x6d61676963…
const decodeUtf8TokenId = (tokenId) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(tokenId)) return null
  try {
    const text = hexToString(tokenId).replace(/\0+$/, '')
    return text.length > 0 && /^[\x20-\x7e]+$/.test(text) ? text : null
  } catch {
    return null
  }
}

// Numeric-ish token ids read better as numbers; hash-style bytes32 ids get truncated hex
const shortTokenId = (tokenId) => {
  try {
    const numeric = BigInt(tokenId)
    if (numeric < 10n ** 12n) return `#${numeric}`
  } catch {
    return tokenId
  }
  return decodeUtf8TokenId(tokenId) || `${tokenId.slice(0, 10)}…`
}

const erc721Abi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getApproved',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
]

// LSP8 Identifiable Digital Asset (LUKSO) — per-token operator equivalents of approve
const lsp8Abi = [
  {
    type: 'function',
    name: 'tokenOwnerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isOperatorFor',
    stateMutability: 'view',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'authorizeOperator',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'operatorNotificationData', type: 'bytes' },
    ],
    outputs: [],
  },
]

// ERC721 ids are decimal-ish numbers, LSP8 ids are bytes32 — normalize both to the bytes32
// form HupTrade stores. Invalid/incomplete input resolves to null and keeps everything disabled.
const normalizeTokenId = (raw) => {
  const value = `${raw}`.trim()
  if (!value) return null
  try {
    if (value.startsWith('0x')) {
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null
      return pad(value, { size: 32 })
    }
    if (!/^\d+$/.test(value)) return null
    return toHex(BigInt(value), { size: 32 })
  } catch {
    return null
  }
}

/**
 * Market Listing Row
 * One attachable listing inside the "Attach from the market" popover — artwork and name
 * resolve live from the same per-token metadata source TradeCard uses, so the seller's
 * image is what the attaching user actually sees. The whole row is the attach action.
 * @param {Object} props
 * @param {Object} props.row Listing row from GET /api/v1/nfts.
 * @param {number} props.chainId
 * @param {Object} [props.nativeCurrency] Chain's native currency, for native-priced rows.
 * @param {boolean} props.enabled Metadata only loads once the popover has been opened —
 *   24 rows must not fire 24 token reads while the panel is still closed.
 * @param {Function} props.onAttach
 */
function MarketListingRow({ row, chainId, nativeCurrency, enabled, onAttach }) {
  const metadata = useNftMetadata({
    chainId,
    collection: row.collection,
    tokenId: row.token_id,
    isLsp8: Boolean(Number(row.is_lsp8)),
    enabled,
  })

  const referralBps = Number(row.referral_bps) || 0
  const formattedPrice = new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(
    Number(formatUnits(BigInt(row.price), row.decimals ?? 18)),
  )
  const symbol = row.symbol || (row.payment_token === zeroAddress ? nativeCurrency?.symbol : 'tokens')

  return (
    <li>
      <button type="button" onClick={onAttach}>
        <span className={styles.sellNftModal__suggestionArt}>
          {metadata.image ? (
            <img src={metadata.image} alt="" />
          ) : (
            <span>{(metadata.name || row.collection.slice(2)).slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.sellNftModal__suggestionMain}>
          <span className={styles.sellNftModal__suggestionName}>{metadata.name || shortTokenId(row.token_id)}</span>
          <span className={styles.sellNftModal__suggestionAddress}>
            {shortAddress(row.collection)} {shortTokenId(row.token_id)}
          </span>
        </span>
        <span className={styles.sellNftModal__suggestionMeta}>
          <span>
            {formattedPrice} {symbol}
          </span>
          <span className={clsx(referralBps > 0 && styles.sellNftModal__marketReferral)}>
            {referralBps > 0
              ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(referralBps / 100)}% referral`
              : 'no referral'}
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * Sell NFT Modal
 * Lists an ERC721 or LSP8 token on HupTrade (approve → list, non-custodial). Opened from the
 * composer it hands the listing reference back so it can travel inside the post's content
 * JSON; opened on its own (the NFT Market) the listing simply stands alone onchain and
 * reaches the market through the indexer.
 * @param {Object} props
 * @param {number} props.chainId Chain the listing settles on — fixed by the post when the
 *   composer is listening, otherwise only the starting point of the network picker.
 * @param {Function} [props.onAttached] Composer hook: receives the nftListing content payload.
 *   Its absence is what puts the modal in standalone mode.
 * @param {Function} [props.onListed] Standalone hook: fires with the same payload after listing.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const SellNftModal = ({ chainId: initialChainId = null, onAttached, onListed, onClose }) => {
  // Without a composer there is no post pinning the chain, so the network becomes the
  // user's choice — and there is nothing to attach a pre-existing listing to
  const isStandalone = !onAttached
  const [chainId, setChainId] = useState(() => initialChainId ?? tradeChains[0]?.id ?? null)
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  const [collection, setCollection] = useState('')
  // The picker row already knows a collection's name and artwork; the preview below only
  // learns them once a token id resolves, so hold on to the row that was chosen
  const [pickedCollection, setPickedCollection] = useState(null)
  const [tokenIdInput, setTokenIdInput] = useState('')
  // LSP8 is the native NFT standard on LUKSO; everywhere else ERC721 is the only option, so
  // the picked value is derived rather than stored — switching away from LUKSO can't strand
  // an lsp8 selection on a chain that has no such standard
  const [luksoStandard, setLuksoStandard] = useState('lsp8')
  const standard = isLukso ? luksoStandard : 'erc721'
  const [price, setPrice] = useState('')
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [tokenSearchResults, setTokenSearchResults] = useState([])
  const [referralPercent, setReferralPercent] = useState('0')
  // Listings that exist onchain but may never have made it into a post (listed, then the
  // composer was abandoned) — offered for re-attach or cancel so they're never stranded
  const [myListings, setMyListings] = useState([])
  // Other sellers' active listings on this chain — attachable repost-style: buys made
  // through the resulting post credit its author with the seller-set referral share
  const [marketListings, setMarketListings] = useState([])
  // Rows only load their NFT artwork once the popover has actually been opened
  const [marketOpened, setMarketOpened] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const dialogRef = useRef(null)
  // A text input can't be a native popover invoker (popovertarget only works on buttons),
  // so the suggestions panel is opened/closed imperatively from the input's events
  const collectionPopoverRef = useRef(null)
  const lastActionRef = useRef(null)
  const autoFilledRef = useRef(null)

  const chainInfo = appChains.find((c) => c.id === chainId)
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const tradeAddress = CONTRACTS[`chain${chainId}`]?.trade || null
  const nativeCurrency = chainInfo?.nativeCurrency
  const tipTokens = TIP_TOKENS[chainId] ?? []

  const isLsp8 = standard === 'lsp8'
  const trimmedCollection = collection.trim()
  const collectionAddress = isAddress(trimmedCollection) ? trimmedCollection : null
  const tokenId = normalizeTokenId(tokenIdInput)
  const hasToken = Boolean(collectionAddress && tokenId && tradeAddress)

  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  // Curated entries are selected by address ("token:0x..."), so the option value alone
  // pins the exact contract the user saw in the list
  const listedToken = paymentChoice.startsWith('token:')
    ? tipTokens.find((t) => t.address === paymentChoice.slice('token:'.length))
    : null
  // Invalid/incomplete custom addresses resolve to null — every downstream read stays
  // disabled and the list button locked until a real address is pasted or picked from search
  const trimmedCustomToken = customToken.trim()
  const tokenAddress = listedToken ? listedToken.address : isCustomToken && isAddress(trimmedCustomToken) ? trimmedCustomToken : null
  const isTokenLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)

  // Switching networks invalidates everything chain-scoped: the collection and token being sold
  // live at an address on one chain, a curated token from the previous network (or a custom
  // address that only exists there) would silently price the listing in nothing, and the
  // listing rows below belong to one chain each
  const handleChainChange = (nextChainId) => {
    setChainId(nextChainId)
    setCollection('')
    setPickedCollection(null)
    setTokenIdInput('')
    autoFilledRef.current = null
    setPaymentChoice('native')
    setCustomToken('')
    setTokenSearchResults([])
    setMyListings([])
    setMarketListings([])
  }

  // Debounced name search for the custom-token field — a pasted address never triggers a
  // search (isAddress short-circuits it). Results arrive most-held/most-liquid first from
  // searchTokens, so the real token outranks same-name copycats.
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

  // Collection discovery — the wallet's own holdings where the chain has an index, the
  // collections trading on Hup everywhere, and a name search on top
  const {
    suggestions: collectionSuggestions,
    isLoading: isLoadingCollections,
    canScanWallet,
  } = useCollectionSuggestions({ chainId, owner: address ?? null, isLsp8, query: collection })

  // Which tokens of that collection the wallet actually holds, read live onchain
  const ownedTokens = useOwnedTokenIds({ chainId, collection: collectionAddress, owner: address ?? null, isLsp8 })

  // The chosen row only describes the collection while the field still holds its address —
  // typing over it drops back to the address alone
  const collectionInfo =
    pickedCollection && collectionAddress && pickedCollection.address.toLowerCase() === collectionAddress.toLowerCase()
      ? pickedCollection
      : null

  const handleSelectCollection = (suggestion) => {
    setCollection(suggestion.address)
    setPickedCollection(suggestion)
    setTokenIdInput('')
    collectionPopoverRef.current?.close()
  }

  // Owning exactly one token in a collection isn't a choice — fill it in. Keyed on the
  // collection so clearing the field by hand doesn't immediately refill it.
  useEffect(() => {
    if (!collectionAddress || ownedTokens.tokenIds.length !== 1) return
    if (autoFilledRef.current === collectionAddress) return
    autoFilledRef.current = collectionAddress
    setTokenIdInput(ownedTokens.tokenIds[0])
  }, [collectionAddress, ownedTokens.tokenIds])

  const metadata = useNftMetadata({ chainId, collection: collectionAddress, tokenId, isLsp8, enabled: hasToken })

  // Ownership — the listing tx would revert anyway, but checking up front keeps the
  // button honest and the error readable
  const { data: erc721Owner } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'ownerOf',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8) },
  })

  const { data: lsp8Owner } = useReadContract({
    abi: lsp8Abi,
    address: collectionAddress,
    functionName: 'tokenOwnerOf',
    args: [tokenId],
    chainId,
    query: { enabled: Boolean(hasToken && isLsp8) },
  })

  const owner = isLsp8 ? lsp8Owner : erc721Owner
  const isOwner = Boolean(owner && address && owner.toLowerCase() === address.toLowerCase())

  // Transfer rights — HupTrade needs approval (ERC721) / operator rights (LSP8) before list()
  const { data: approvedFor, refetch: refetchApproved } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'getApproved',
    args: [tokenId ? BigInt(tokenId) : 0n],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8) },
  })

  const { data: approvedForAll, refetch: refetchApprovedForAll } = useReadContract({
    abi: erc721Abi,
    address: collectionAddress,
    functionName: 'isApprovedForAll',
    args: [address, tradeAddress],
    chainId,
    query: { enabled: Boolean(hasToken && !isLsp8 && address) },
  })

  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    abi: lsp8Abi,
    address: collectionAddress,
    functionName: 'isOperatorFor',
    args: [tradeAddress, tokenId],
    chainId,
    query: { enabled: Boolean(hasToken && isLsp8) },
  })

  const hasTransferRights = isLsp8
    ? Boolean(isOperator)
    : approvedFor?.toLowerCase() === tradeAddress?.toLowerCase() || Boolean(approvedForAll)

  // decimals() shares the same selector on ERC20 and LSP7 — one read covers both
  const { data: tokenDecimals } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress,
    functionName: 'decimals',
    chainId,
    query: { enabled: Boolean(tokenAddress) },
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

  const symbol =
    paymentChoice === 'native'
      ? nativeCurrency?.symbol || ''
      : listedToken
      ? listedToken.symbol
      : paymentChoice === 'custom-lsp7'
      ? lsp4Symbol || 'tokens'
      : customSymbol || 'tokens'
  const decimals = paymentChoice === 'native' ? nativeCurrency?.decimals ?? 18 : tokenAddress ? tokenDecimals : undefined

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

  // The platform's cut is set per chain and can change — quote the live one so the seller
  // signs against the split HupTrade will actually run at buy time
  const { feeBps, feePercent } = useTradeFee({ chainId, tradeAddress })
  const split = splitSalePrice(isValidPrice ? parsedPrice : 0, feeBps, referralBps)
  const hasDeductions = Boolean(feeBps > 0 || referralBps > 0)
  const showSplit = isValidPrice && referralBps !== null && hasDeductions

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const isBusy = isPending || isConfirming

  // Mount = open / unmount = close, matching the NewPost dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!address || !chainId) return

    let cancelled = false
    fetch(`/api/v1/trade/listings?networkId=${chainId}&seller=${address.toLowerCase()}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json?.success) setMyListings(json.data || [])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [address, chainId])

  // Composer mode only: everyone else's active listings, newest first. The API row shape
  // matches /api/v1/trade/listings, so handleAttachExisting serves both sections.
  useEffect(() => {
    if (isStandalone || !chainId) return

    let cancelled = false
    fetch(`/api/v1/nfts?networkId=${chainId}&status=active&sort=newest&limit=24`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json?.success) return
        // Own listings already have their section above (with cancel), so keep them out
        setMarketListings((json.data || []).filter((row) => row.wallet_address?.toLowerCase() !== address?.toLowerCase()))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [isStandalone, chainId, address])

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    if (lastActionRef.current === 'approve') {
      toast('Transfer approved — you can list your NFT now', 'success')
      refetchApproved()
      refetchApprovedForAll()
      refetchOperator()
      return
    }
    if (lastActionRef.current === 'cancel') {
      toast('Listing cancelled', 'success')
      setMyListings((prev) => prev.filter((row) => String(row.listing_id) !== cancellingId))
      setCancellingId(null)
      return
    }

    // The listing id only exists onchain — pull it out of the receipt's Listed event
    let listingId = null
    try {
      const [listed] = parseEventLogs({ abi: tradeAbi, logs: receipt?.logs ?? [], eventName: 'Listed' })
      listingId = listed?.args?.listingId?.toString() || null
    } catch {
      listingId = null
    }
    if (!listingId) {
      toast('Listing confirmed but its id could not be read — please try again', 'error')
      return
    }

    const listing = {
      listingId,
      chainId,
      collection: collectionAddress,
      tokenId,
      isLsp8,
      token: tokenAddress ?? zeroAddress,
      isTokenLsp7,
      price: priceUnits.toString(),
      referralBps,
    }
    // A standalone listing is live onchain immediately, but only reaches the market grid
    // once the indexer picks up the Listed event — say so rather than promise it's there
    toast(isStandalone ? 'NFT listed — it appears in the market once indexed' : 'NFT listed for sale', 'success')
    if (onAttached) onAttached(listing)
    else onListed?.(listing)
    dialogRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleApprove = (e) => {
    e.stopPropagation()
    if (!hasToken) return

    lastActionRef.current = 'approve'
    if (isLsp8) {
      writeContract({
        abi: lsp8Abi,
        address: collectionAddress,
        functionName: 'authorizeOperator',
        args: [tradeAddress, tokenId, '0x'],
        chainId,
      })
    } else {
      writeContract({
        abi: erc721Abi,
        address: collectionAddress,
        functionName: 'approve',
        args: [tradeAddress, BigInt(tokenId)],
        chainId,
      })
    }
  }

  const handleList = (e) => {
    e.stopPropagation()
    if (!hasToken || priceUnits === null || referralBps === null) return

    lastActionRef.current = 'list'
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'list',
      args: [address, collectionAddress, tokenId, isLsp8, tokenAddress ?? zeroAddress, isTokenLsp7, priceUnits, BigInt(referralBps)],
      chainId,
    })
  }

  const needsApproval = hasToken && isOwner && !hasTransferRights

  // Re-attach an onchain listing that never made it into a post — the DB row carries every
  // field the content payload needs, no new transaction required
  const handleAttachExisting = (row) => {
    onAttached({
      listingId: String(row.listing_id),
      chainId,
      collection: row.collection,
      tokenId: row.token_id,
      isLsp8: Boolean(row.is_lsp8),
      token: row.payment_token,
      isTokenLsp7: Boolean(row.is_lsp7),
      price: String(row.price),
      referralBps: Number(row.referral_bps),
    })
    dialogRef.current?.close()
  }

  const handleCancelExisting = (row) => {
    lastActionRef.current = 'cancel'
    setCancellingId(String(row.listing_id))
    writeContract({
      abi: tradeAbi,
      address: tradeAddress,
      functionName: 'cancelListing',
      args: [BigInt(row.listing_id)],
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sellNftModal}
      aria-label="Sell an NFT"
      onClick={(e) => e.stopPropagation()}
      // Nested inside the composer's NativeDialog — React's synthetic close/cancel events
      // propagate up the component tree, and without these the composer closes too
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <header className={styles.sellNftModal__header}>
        <button type="button" className={styles.sellNftModal__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Sell an NFT</h3>
      </header>

      <main className={styles.sellNftModal__body}>
        {isWrongChain && (
          <div className={styles.sellNftModal__chainWarning}>
            <WarningIcon size={14} />
            <span>Listing on {chainInfo?.name || 'this network'} needs your wallet on the same network.</span>
            <button type="button" onClick={() => switchChain.mutate({ chainId })} disabled={switchChain.isPending}>
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {isStandalone && tradeChains.length > 1 && (
          <div className={styles.sellNftModal__field}>
            <label htmlFor="sellNftNetwork">Network</label>
            <select id="sellNftNetwork" value={chainId ?? ''} onChange={(e) => handleChainChange(Number(e.target.value))} disabled={isBusy}>
              {tradeChains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {myListings.length > 0 && (
          // Collapsed by default so a long listing history never pushes the sell form
          // below the fold — the count on the summary says what's inside
          <details className={styles.sellNftModal__existing}>
            <summary className={styles.sellNftModal__existingSummary}>
              <span>
                Your active listings ({myListings.length})
              </span>
              <CaretDownIcon size={14} />
            </summary>
            <p className={styles.sellNftModal__hint}>
              {isStandalone
                ? 'Already listed onchain — cancel one to release the NFT.'
                : 'Already listed onchain — attach one to this post, or cancel it to release the NFT.'}
            </p>
            {myListings.map((row) => (
              <div key={row.listing_id} className={styles.sellNftModal__existingRow}>
                <div className={styles.sellNftModal__existingInfo}>
                  <strong>
                    {shortAddress(row.collection)} {shortTokenId(row.token_id)}
                  </strong>
                  <span>
                    {new Intl.NumberFormat('en', { maximumFractionDigits: 6 }).format(
                      Number(formatUnits(BigInt(row.price), row.decimals ?? 18)),
                    )}{' '}
                    {row.symbol || (row.payment_token === zeroAddress ? nativeCurrency?.symbol : 'tokens')}
                  </span>
                </div>
                <div className={styles.sellNftModal__existingActions}>
                  {!isStandalone && (
                    <button
                      type="button"
                      className={styles.sellNftModal__existingAttach}
                      onClick={() => handleAttachExisting(row)}
                      disabled={isBusy}
                    >
                      Attach
                    </button>
                  )}
                  <button type="button" onClick={() => handleCancelExisting(row)} disabled={isBusy}>
                    {cancellingId === String(row.listing_id) && isBusy ? 'Confirming...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </details>
        )}

        {!isStandalone && marketListings.length > 0 && (
          // Any active listing can anchor a post, not just your own — attaching works like
          // reposting: buys made through your post pay you the seller-set referral share.
          // A popover (not a details block) so the rows can carry live NFT artwork without
          // pushing the sell form below the fold.
          <NativePopover
            placement="bottom-start"
            className={styles.sellNftModal__suggestionsPanel}
            onToggle={(e) => {
              if (e.newState === 'open') setMarketOpened(true)
            }}
            trigger={
              <button type="button" className={styles.sellNftModal__marketTrigger} disabled={isBusy}>
                <StorefrontIcon size={16} />
                <span>Attach from the market ({marketListings.length})</span>
                <CaretDownIcon size={14} />
              </button>
            }
          >
            <p className={styles.sellNftModal__marketHint}>
              Attach anyone&apos;s listing to your post — when someone buys through it, you earn the listing&apos;s referral share.
            </p>
            <ul className={styles.sellNftModal__suggestions}>
              {marketListings.map((row) => (
                <MarketListingRow
                  key={row.listing_id}
                  row={row}
                  chainId={chainId}
                  nativeCurrency={nativeCurrency}
                  enabled={marketOpened}
                  onAttach={() => handleAttachExisting(row)}
                />
              ))}
            </ul>
          </NativePopover>
        )}

        {isLukso && (
          <div className={styles.sellNftModal__field}>
            <label htmlFor="sellNftStandard">Standard</label>
            <select id="sellNftStandard" value={luksoStandard} onChange={(e) => setLuksoStandard(e.target.value)}>
              <option value="lsp8">LSP8 (LUKSO NFT)</option>
              <option value="erc721">ERC721</option>
            </select>
          </div>
        )}

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftCollection">Collection</label>
          {/* The suggestions overlay the fields below instead of pushing them down — the
              popover panel floats in the top layer, anchored under the input */}
          <NativePopover
            ref={collectionPopoverRef}
            placement="bottom-start"
            className={styles.sellNftModal__suggestionsPanel}
            trigger={
              <input
                type="text"
                id="sellNftCollection"
                value={collection}
                // Typing reopens the list as well as focus: after picking a collection the input
                // still holds focus, so onFocus alone would never fire again
                onChange={(e) => {
                  setCollection(e.target.value)
                  collectionPopoverRef.current?.open()
                }}
                onFocus={() => collectionPopoverRef.current?.open()}
                // A text input can't hold the invoker exemption, so clicking the focused
                // input light-dismisses the panel on pointerdown — the click reopens it
                onClick={() => collectionPopoverRef.current?.open()}
                onBlur={() => collectionPopoverRef.current?.close()}
                placeholder={canScanWallet ? 'Search collections or paste 0x...' : 'Collection name or 0x...'}
                autoComplete="off"
                spellCheck={false}
              />
            }
          >
            {collectionSuggestions.length > 0 ? (
              <ul className={styles.sellNftModal__suggestions}>
                {collectionSuggestions.map((suggestion, index) => (
                  <li key={suggestion.address}>
                    {suggestion.group !== collectionSuggestions[index - 1]?.group && (
                      <p className={styles.sellNftModal__suggestionGroup}>{COLLECTION_GROUP_LABELS[suggestion.group]}</p>
                    )}
                    {/* mousedown would blur the input and close the panel before the click lands */}
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelectCollection(suggestion)}>
                      <span className={styles.sellNftModal__suggestionArt}>
                        {suggestion.image ? (
                          <img src={suggestion.image} alt="" />
                        ) : (
                          <span>{(suggestion.name || suggestion.address.slice(2)).slice(0, 1).toUpperCase()}</span>
                        )}
                      </span>
                      <span className={styles.sellNftModal__suggestionMain}>
                        <span className={styles.sellNftModal__suggestionName}>{suggestion.name || 'Unnamed collection'}</span>
                        <span className={styles.sellNftModal__suggestionAddress}>{shortAddress(suggestion.address)}</span>
                      </span>
                      <span className={styles.sellNftModal__suggestionMeta}>
                        {suggestion.ownedCount > 0 && (
                          <span className={styles.sellNftModal__suggestionOwned}>{suggestion.ownedCount} owned</span>
                        )}
                        {suggestion.activeCount > 0 && <span>{suggestion.activeCount} listed</span>}
                        {suggestion.group === 'search' && suggestion.holderCount > 0 && (
                          <span>{compactNumber.format(suggestion.holderCount)} holders</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={clsx(styles.sellNftModal__hint, styles.sellNftModal__suggestionsEmpty)}>
                {isLoadingCollections
                  ? 'Looking for collections...'
                  : canScanWallet
                  ? 'No match — paste the collection address instead.'
                  : `${chainInfo?.name || 'This network'} has no NFT index, so only collections trading on Hup are suggested — paste any other address.`}
              </p>
            )}
          </NativePopover>

          {collectionInfo && (
            <p className={styles.sellNftModal__pickerNote}>
              {collectionInfo.name || 'Unnamed collection'}
              {collectionInfo.ownedCount > 0 && ` — you own ${collectionInfo.ownedCount}`}
            </p>
          )}
        </div>

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftTokenId">Token id</label>
          <input
            type="text"
            id="sellNftTokenId"
            value={tokenIdInput}
            onChange={(e) => setTokenIdInput(e.target.value)}
            placeholder={isLsp8 ? '0x... or number' : 'e.g. 42'}
            autoComplete="off"
            spellCheck={false}
          />

          {collectionAddress && address && (
            <>
              {ownedTokens.isLoading && <p className={styles.sellNftModal__hint}>Checking what you own here...</p>}

              {!ownedTokens.isLoading && ownedTokens.tokenIds.length > 0 && (
                <>
                  <p className={styles.sellNftModal__hint}>Yours in this collection — tap one to list it</p>
                  <ul className={styles.sellNftModal__tokenChips}>
                    {ownedTokens.tokenIds.map((ownedId) => (
                      <li key={ownedId}>
                        <button
                          type="button"
                          className={clsx(normalizeTokenId(ownedId) === tokenId && styles['sellNftModal__tokenChip--active'])}
                          onClick={() => setTokenIdInput(ownedId)}
                        >
                          {shortTokenId(ownedId)}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {ownedTokens.balance > ownedTokens.tokenIds.length && (
                    <p className={styles.sellNftModal__hint}>
                      +{ownedTokens.balance - ownedTokens.tokenIds.length} more — paste the id above to list one of those.
                    </p>
                  )}
                </>
              )}

              {/* A real balance with nothing to show means the collection skips ERC721Enumerable */}
              {!ownedTokens.isLoading && ownedTokens.tokenIds.length === 0 && ownedTokens.balance > 0 && (
                <p className={styles.sellNftModal__hint}>
                  You own {ownedTokens.balance} here, but this collection doesn&apos;t publish a token list — enter the id above.
                </p>
              )}

              {!ownedTokens.isLoading && ownedTokens.balance === 0 && (
                <p className={styles.sellNftModal__hint}>This wallet doesn&apos;t hold anything in this collection.</p>
              )}
            </>
          )}
        </div>

        {hasToken && (
          <div className={styles.sellNftModal__preview}>
            <div className={styles.sellNftModal__previewMain}>
              {metadata.image && <img src={metadata.image} alt={metadata.name || 'NFT'} />}
              <div className={styles.sellNftModal__previewText}>
                <strong>{metadata.name || (metadata.isLoading ? 'Loading…' : 'Unknown token')}</strong>
                {metadata.collectionName && <span>{metadata.collectionName}</span>}
                {isOwner && <span className={styles.sellNftModal__owned}>Owned by you ✓</span>}
                {owner && !isOwner && <span className={styles.sellNftModal__warning}>This token belongs to another wallet</span>}
                {hasToken && !metadata.isLoading && !owner && (
                  <span className={styles.sellNftModal__warning}>Token not found in this collection</span>
                )}
              </div>
            </div>

            {metadata.attributes.length > 0 && (
              <ul className={styles.sellNftModal__previewTraits}>
                {metadata.attributes.slice(0, 4).map((attr) => (
                  <li key={`${attr.label}:${attr.value}`}>
                    <span>{attr.label}</span> <strong>{attr.value}</strong>
                  </li>
                ))}
                {metadata.attributes.length > 4 && <li>+{metadata.attributes.length - 4}</li>}
              </ul>
            )}

            {metadata.source === 'collection' && (
              <p className={styles.sellNftModal__previewNote}>
                This collection doesn&apos;t publish per-token metadata — the image and name above describe the collection, not
                this specific token.
              </p>
            )}
          </div>
        )}

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftToken">Sell for</label>
          <select id="sellNftToken" value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)}>
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
          <div className={clsx(styles.sellNftModal__field, styles.sellNftModal__tokenSearch)}>
            <label htmlFor="sellNftCustomToken">Search token or paste address</label>
            <input
              type="text"
              id="sellNftCustomToken"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="Token name or 0x..."
              autoComplete="off"
              spellCheck={false}
            />
            {tokenSearchResults.length > 0 && (
              <>
                <ul className={styles.sellNftModal__tokenResults}>
                  {tokenSearchResults.map((result) => {
                    const popularity = formatTokenPopularity(result)
                    return (
                      <li key={result.address}>
                        <button type="button" onClick={() => handleSelectSearchResult(result)}>
                          <span className={styles.sellNftModal__tokenResultMain}>
                            <span className={styles.sellNftModal__tokenResultSymbol}>{result.symbol}</span>
                            {result.name && <span className={styles.sellNftModal__tokenResultName}>{result.name}</span>}
                          </span>
                          <span className={styles.sellNftModal__tokenResultMeta}>
                            <span className={styles.sellNftModal__tokenResultAddress}>{shortAddress(result.address)}</span>
                            {popularity && <span className={styles.sellNftModal__tokenResultPopularity}>{popularity}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className={styles.sellNftModal__tokenWarning} role="alert">
                  Anyone can create a token with any name — check the contract address before pricing your NFT in it.
                </p>
              </>
            )}
          </div>
        )}

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftPrice">Price</label>
          <div className={styles.sellNftModal__amount}>
            <input
              type="number"
              id="sellNftPrice"
              value={price}
              min={0}
              step="any"
              inputMode="decimal"
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
            <span className={styles.sellNftModal__amountSymbol}>{symbol}</span>
          </div>
        </div>

        <div className={styles.sellNftModal__field}>
          <label htmlFor="sellNftReferral">Referral reward %</label>
          <input
            type="number"
            id="sellNftReferral"
            value={referralPercent}
            min={0}
            max={MAX_REFERRAL_PERCENT}
            step="any"
            inputMode="decimal"
            onChange={(e) => setReferralPercent(e.target.value)}
          />
          <p className={styles.sellNftModal__hint}>
            Share of the price paid to whoever's repost leads to the sale (0–{MAX_REFERRAL_PERCENT}%)
          </p>
        </div>

        {/* The settlement HupTrade runs when someone buys: platform fee off the top, the
            referral share next, the rest lands in the seller's wallet. Hidden until the fee
            read resolves so the panel never quotes a rate of zero it hasn't confirmed. */}
        {feeBps !== null && (
          <div className={styles.sellNftModal__split}>
            {showSplit ? (
              <>
                <p className={styles.sellNftModal__splitRow}>
                  <span>Buyer pays</span>
                  <strong>
                    {amountFormat.format(parsedPrice)} {symbol}
                  </strong>
                </p>
                {feeBps > 0 && (
                  <p className={styles.sellNftModal__splitRow}>
                    <span>Platform fee ({feePercent})</span>
                    <span>
                      −{amountFormat.format(split.fee)} {symbol}
                    </span>
                  </p>
                )}
                {referralBps > 0 && (
                  <p className={styles.sellNftModal__splitRow}>
                    <span>Referral ({formatBps(referralBps)})</span>
                    <span>
                      −{amountFormat.format(split.referral)} {symbol}
                    </span>
                  </p>
                )}
                <p className={clsx(styles.sellNftModal__splitRow, styles['sellNftModal__splitRow--total'])}>
                  <span>You receive</span>
                  <strong>
                    {amountFormat.format(split.seller)} {symbol}
                  </strong>
                </p>
              </>
            ) : (
              <p className={styles.sellNftModal__splitHint}>
                {feeBps > 0
                  ? `Platform fee: ${feePercent} of the sale price, taken from your proceeds.`
                  : 'No platform fee on this network — you receive the full sale price.'}
              </p>
            )}
          </div>
        )}
      </main>

      <footer className={styles.sellNftModal__footer}>
        {!tradeAddress && <p className={styles.sellNftModal__hint}>NFT selling isn&apos;t available on this network yet</p>}
        {needsApproval ? (
          <button type="button" className={clsx(styles.sellNftModal__submit)} onClick={handleApprove} disabled={isBusy}>
            {isBusy ? 'Confirming...' : 'Approve transfer'}
          </button>
        ) : (
          <button
            type="button"
            className={clsx(styles.sellNftModal__submit)}
            onClick={handleList}
            disabled={isBusy || !hasToken || !isOwner || !hasTransferRights || priceUnits === null || referralBps === null}
          >
            {isBusy
              ? 'Confirming...'
              : isValidPrice
              ? `List for ${amountFormat.format(parsedPrice)} ${symbol}`
              : 'List for sale'}
          </button>
        )}
      </footer>
    </NativeDialog>
  )
}

export default SellNftModal
