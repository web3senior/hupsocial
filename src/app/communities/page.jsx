'use client'

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useAccount,
  usePublicClient,
  useConnection,
  useChainId,
} from 'wagmi'
import { formatEther, parseEther, parseUnits } from 'viem'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import NativeDialog from '@/components/ui/NativeDialog'
import DialogHeader from '@/components/ui/DialogHeader'
import RecipientField from '@/components/ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import { CaretLeftIcon, CaretRightIcon, GearSixIcon, MagnifyingGlassIcon, UsersIcon } from '@phosphor-icons/react'
import { PostCard } from '@/components/Post'
import HupCommunityABI from '@/abis/HupCommunity'
import NewPost from '@/components/NewPost'
import {
  deriveIdentityFromCachedMaster,
  cacheUnlockedIdentity,
  getCachedIdentityPrivKeyHex,
  pubKeyFromPrivKeyHex,
  generateContentKey,
  wrapContentKey,
  unwrapContentKey,
  wrapKeyWithKey,
  unwrapKeyWithKey,
  decryptPostContent,
} from '@/lib/communityVault'
import { getActiveChain } from '@/lib/communication'
import { useProfile } from '@/hooks/useProfile'
import { config, CONTRACTS } from '@/config/wagmi'
import { getPosts } from '@/lib/api'
import { getIPFS, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { buildLinks, displayLinks, emptySocials, parseLinks } from '@/lib/socialLinks'
import { asClause, describeWalletError } from '@/lib/walletErrors'
import { toast } from '@/components/NextToast'
import { usePostStore } from '@/stores/usePostStore'
import { useFeedCacheStore } from '@/stores/useFeedCacheStore'
import BrandingLinksFields from './_components/BrandingLinksFields'
import ImagePicker from './_components/ImagePicker'
import CreateCommunityModal from './_components/CreateCommunityModal'
import { AssetUnitLabel, TokenRequirementTag, TokenUnitHint } from './_components/TokenAmount'
import TokenAssetInput from './_components/TokenAssetInput'
import OptionPicker from './_components/OptionPicker'
import { DEFAULT_COMMUNITY_CATEGORY, getCommunityCategory, normalizeCommunityCategory } from '@/config/communityCategories'
import useCommunityCategories from '@/hooks/useCommunityCategories'
import useRailScroll from '@/hooks/useRailScroll'
import {
  ZERO_ADDRESS,
  fetchIsLsp7,
  fetchTokenDecimals,
  formatTokenDisplay,
  getNativeCurrency,
  isNativeAsset,
  toAmountInput,
  useTokenMeta,
} from './tokenUnits'
import {
  ADMISSION,
  ADMISSION_OPTIONS,
  COMMUNITY_TYPE_OPTIONS,
  REQUIREMENT_TYPE,
  REQUIREMENT_TYPE_OPTIONS,
  REQUIREMENT_TYPE_CHOICES,
  REQUIREMENT_MODE_OPTIONS,
  ENCRYPTION_NOTES,
  SELF_SERVE_HINTS,
  toOnchainRequirement,
  toUiRequirementType,
} from './membershipOptions'
import { MAX_TAG_LENGTH, normalizeTag } from './communityTag'
import styles from './page.module.scss'

// Metadata JSON uploads share lib/ipfs.js's uploadObjectToIPFS; the historical local name is
// kept as an alias since the card's update flow references it throughout this file.
const uploadPostContentToIPFS = uploadObjectToIPFS

const FEED_PAGE_SIZE = 10

// Shared identity-vault hook: derives/caches the per-user community identity key (a child of
// the app-wide security vault — one signature + one security PIN shared with the in-app wallet
// and future features) and keeps its on-chain registration (HupCommunity.communityIdentityKeys)
// in sync.
function useCommunityVault() {
  const { address } = useConnection()
  // Identity registration always targets the wallet's active chain — unlike CommunityCard,
  // which can be pinned to another network for browsing
  const chainId = useChainId()
  const [, activeChainContracts] = getActiveChain()
  const CONTRACT_ADDRESS = activeChainContracts?.community

  const [identity, setIdentity] = useState(null) // { privKeyHex, pubKeyHex }
  // "Needs the vault" flag — renders the setup notice that links to Settings → Security Vault
  // (the app's only PIN prompt) instead of asking for the PIN in place.
  const [showPinPrompt, setShowPinPrompt] = useState(false)

  const { data: registeredPubKey, refetch: refetchRegisteredPubKey } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'communityIdentityKeys',
    args: [address],
    query: { enabled: !!address },
  })

  const { mutate: registerIdentityKey, data: registerHash } = useWriteContract()
  const { isSuccess: isRegisterConfirmed } = useWaitForTransactionReceipt({ hash: registerHash })

  useEffect(() => {
    if (isRegisterConfirmed) refetchRegisteredPubKey()
  }, [isRegisterConfirmed, refetchRegisteredPubKey])

  useEffect(() => {
    const cached = getCachedIdentityPrivKeyHex()
    if (cached) {
      setIdentity({ privKeyHex: cached, pubKeyHex: pubKeyFromPrivKeyHex(cached) })
      return
    }

    // The security vault may already be unlocked by another feature (e.g. the in-app wallet) —
    // in that case the identity is derivable with no prompt at all.
    let cancelled = false
    deriveIdentityFromCachedMaster().then((derived) => {
      if (cancelled || !derived) return
      cacheUnlockedIdentity(derived.privKeyHex)
      setIdentity(derived)
    })

    return () => {
      cancelled = true
    }
  }, [address])

  // Registration is a plain tx (no PIN involved), so it's fine to offer it contextually here:
  // the identity might be unlocked but not yet registered on *this* chain (per-chain registry).
  const registerOnThisChain = () => {
    if (!identity || !CONTRACT_ADDRESS) return
    registerIdentityKey({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'registerIdentityKey',
      args: [identity.pubKeyHex],
    })
  }

  const needsRegistration = Boolean(
    identity && (!registeredPubKey || registeredPubKey === '0x' || registeredPubKey.toLowerCase() !== identity.pubKeyHex.toLowerCase())
  )

  return { identity, showPinPrompt, setShowPinPrompt, needsRegistration, registerOnThisChain }
}

// Encryption-setup notice. The PIN itself is NEVER asked here — Settings → Security Vault is the
// app's single PIN entry point, so a locked vault sends the user there. Only the per-chain
// identity registration (a plain tx, no secret) is offered in place.
function VaultUnlockPrompt({ vault }) {
  return (
    <div className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')} style={{ marginTop: '1rem', marginBottom: '1rem' }}>
      {!vault.identity ? (
        <>
          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Security Vault locked</h5>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem' }}>
            This community is encrypted. Unlock your Security Vault (one signature + your Hup PIN) to read and write here — it also unlocks
            your other protected features like the in-app wallet.
          </p>
          <Link
            href="/settings?tab=security"
            className={styles.card__submit}
            style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}
          >
            Unlock in Settings
          </Link>
        </>
      ) : (
        <>
          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>One more step on this network</h5>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem' }}>
            Your vault is unlocked, but your encryption key isn’t registered on this network yet — until it is, moderators can’t share
            community keys with you here. One quick wallet confirmation fixes that.
          </p>
          <button type="button" className={styles.card__submit} onClick={vault.registerOnThisChain}>
            Register on this network
          </button>
        </>
      )}
    </div>
  )
}

// Modal wrapper for the card's management panels (Modify / Manage Members): the open/closed
// decision stays plain state while NativeDialog supplies real modality. Content mounts only
// while open, so a directory full of cards doesn't pay for idle panels.
function CardDialog({ open, onClose, className, label, children }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (open) dialogRef.current?.open()
    else dialogRef.current?.close()
  }, [open])

  return (
    <NativeDialog ref={dialogRef} className={className} aria-label={label} onClose={onClose}>
      {open ? children : null}
    </NativeDialog>
  )
}

// Byline helper: shows the creator's profile name once resolved, truncated wallet until then —
// same name precedence as the Profile component so bylines match the rest of the app
export function CreatorName({ address }) {
  const { profile } = useProfile(address)
  if (!address) return null
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`
  return profile ? profile.fullName || profile.name || truncated : truncated
}

// Dedicated presentation sub-component to isolate ERC-721 naming hooks safely. NFT minimums are
// plain counts, so unlike token balances they need no decimals scaling.
//
// `resolvedName` short-circuits the read: cidex resolves every gating collection's name once at
// index time, and a directory card that reads it per chip is doing the same lookup twenty times
// over for names the page was already handed.
function NftTag({ tokenAddress, chainId, minBalance, resolvedName = undefined }) {
  const { data: liveName } = useReadContract({
    address: tokenAddress,
    chainId,
    abi: [{ name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }],
    functionName: 'name',
    query: { enabled: resolvedName === undefined },
  })
  const nftName = resolvedName === undefined ? liveName : resolvedName

  return (
    <span
      className={styles.card__tag}
      style={{ background: 'var(--bg-light)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', fontSize: '0.8rem' }}
      title={`Contract: ${tokenAddress}`}
    >
      NFT: {nftName || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`} (Min: {minBalance || '1'})
    </span>
  )
}

// Helper component to fetch, render, update, and post within individual community cards.
// Exported so communities/[networkId]/[communityId]/page.jsx can reuse it for the standalone
// detail page instead of duplicating all of its state/logic. hideHeader skips the logo/title/
// summary/tags block (the detail page renders its own, indexed-data-backed version of that) but
// keeps the action buttons/feed/forms.
/**
 * The directory's DB row, reshaped into the metadata JSON the card renders. cidex stores the
 * resolved IPFS document in `metadata` and projects the hot fields into columns; the column
 * values win for anything the JSON lacks (a legacy document, or a row repaired by hand).
 */
export function metadataFromRow(row) {
  if (!row) return null
  let parsed = null
  if (row.metadata) {
    try {
      parsed = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    } catch {
      parsed = null
    }
  }
  const base = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    ...base,
    name: base.name || row.name || '',
    tag: base.tag || row.tag || '',
    category: base.category || row.category || '',
    summary: base.summary || row.summary || '',
    description: base.description || row.description || '',
    'logo url': base['logo url'] || row.logo_url || '',
    'cover url': base['cover url'] || row.cover_url || '',
  }
}

/**
 * @param {object|null} row — the community's indexed row, carrying everything the card renders:
 *   the metadata document cidex already resolved, the join gating (requirements, price, payout,
 *   governor, key version) and the viewer's own membership standing. Given one, the card paints
 *   from it and reads nothing onchain — a directory of twenty used to open with several hundred
 *   un-batched eth_calls, and every card sat on a skeleton until its own communities() answered.
 * @param {boolean} hideHeader — the standalone detail page, which renders its own header. It is
 *   also what puts the card in live mode: one card on screen can afford authoritative reads, and
 *   that is the surface where gating decisions actually get made.
 */
// Failures stay on screen longer than the toast's 5s default: they carry a reason worth reading,
// and nothing else is left to explain what happened once they go.
const ERROR_TOAST_MS = 12000

const REQUEST_ALREADY_HANDLED =
  'that wallet is no longer pending — they withdrew the request, or another moderator handled it first. The queue refreshes on its own.'

// HupCommunity reverts worth translating. Matched against the whole error, so both the decoded
// name and the bare selector a node sometimes returns instead resolve to the same sentence.
const KNOWN_REVERTS = {
  NoPendingRequest: REQUEST_ALREADY_HANDLED,
  '0xcc2c06e8': REQUEST_ALREADY_HANDLED,
}

export function CommunityCard({ id, networkId = null, hideHeader = false, memberCount = null, row = null }) {
  const { address, isConnected } = useConnection()
  const { address: activeAccountAddress } = useAccount()
  // Shared across every card on the page by SWR — one request, not one per card
  const { categories } = useCommunityCategories()
  const activeChainId = useChainId()
  // Chain-aware: an explicit networkId (directory filter / detail route) pins every read and
  // write to that chain — reads via a chain-bound public client, writes via wagmi's chainId
  // param (which prompts a network switch when the wallet is elsewhere).
  const chainId = networkId ? Number(networkId) : activeChainId
  const publicClient = usePublicClient({ chainId })
  const vault = useCommunityVault()
  const router = useRouter()
  // Hands the clicked row to the post detail page so it paints instantly, exactly as HomeFeedTab does
  const setCurrentPost = usePostStore((state) => state.setCurrentPost)
  const CONTRACT_ADDRESS = CONTRACTS[`chain${chainId}`]?.community

  // Live mode: ask the contract as well as the indexed row. On the detail page that is one card's
  // worth of reads and buys authoritative gating; in the grid it would be that same set multiplied
  // by the page size, which is the whole problem. A card with no row to fall back on has no choice
  // either way.
  //
  // It decides which reads *run*, never what the card renders while they are running: every value
  // below prefers the live answer once it lands and shows the row's until then. Live mode used to
  // mean the row was ignored outright, which is why the detail page opened on a skeleton and then
  // an ellipsis where the join price goes — a dozen round trips to display data it was holding.
  //
  // A grid card the viewer actually acts on joins them for the rest of its life. It has to: the
  // indexed row is a block or two behind the transaction that just landed, and every refetch this
  // card performs after a confirmation is a no-op while its reads are disabled — so a Join would
  // sit there saying "Join". One card the viewer is interacting with can afford the reads.
  const [hasInteracted, setHasInteracted] = useState(false)
  const liveReads = hideHeader || !row || hasInteracted

  // Metadata has two sources and a clear precedence: the gateway copy this card resolved for
  // itself, if it has one, otherwise the copy cidex already resolved and put on the row. Derived
  // rather than held in state, so the detail page — which mounts this card before its own fetch
  // lands — picks the row up the moment it arrives, with no effect to synchronize the two.
  //
  // null means the gateway hasn't been asked yet; { value: null } means it was asked and came
  // back with nothing, which is what separates "still loading" from "there is nothing to show".
  const [gatewayMetadata, setGatewayMetadata] = useState(null)
  const rowMetadataKey = row ? `${row.network_id}:${row.contract_address}:${row.id}:${row.updated_at ?? ''}` : null
  const rowMetadata = useMemo(() => (row ? metadataFromRow(row) : null), [rowMetadataKey])
  const metadata =
    gatewayMetadata?.value ??
    rowMetadata ??
    (gatewayMetadata ? { name: `Space #${id}`, summary: 'Invalid metadata payload structure' } : null)

  const [isEditing, setIsEditing] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [isManagingMembers, setIsManagingMembers] = useState(false)
  // --- Community feed cache (mirrors HomeFeedTab) ---

  // The community feed restores through the same in-memory store the home feed uses, keyed per
  // community. Opening a post unmounts this page; coming back re-reads the snapshot instead of
  // refetching page 1 behind a shimmer and dropping the reader at the top of the feed.
  const feedCacheKey = `community-${chainId}-${id}`
  const saveFeedCache = useFeedCacheStore((state) => state.saveFeedCache)
  // Safe to read in an initializer: the store is in-memory, so it's always empty during SSR
  // hydration and hits only ever happen on client-side remounts. Only the detail view keeps a
  // feed at all, so the directory's cards never read or write one.
  const [initialFeedCache] = useState(() =>
    hideHeader ? useFeedCacheStore.getState().readFeedCache(feedCacheKey, address ?? null) : null
  )

  const [communityPosts, setCommunityPosts] = useState(initialFeedCache?.list ?? [])
  const [isFeedLoading, setIsFeedLoading] = useState(false)

  // Update states for inline modifications
  const [editName, setEditName] = useState('')
  const [editTag, setEditTag] = useState('')
  const [editCategory, setEditCategory] = useState(DEFAULT_COMMUNITY_CATEGORY)
  const [editSummary, setEditSummary] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [editSocials, setEditSocials] = useState(emptySocials)
  const [editExtraLinks, setEditExtraLinks] = useState([])
  const [editAdmission, setEditAdmission] = useState(0)
  const [editCommunityType, setEditCommunityType] = useState(0)

  // Composable requirement rows being edited ({ rType, asset, minBalance } — string minBalance
  // until submit) plus their ALL/ANY combinator, mirroring the create modal's editor
  const [editRequirements, setEditRequirements] = useState([])
  const [editRequirementMode, setEditRequirementMode] = useState(0)
  // What the contract held when the editor opened. Submit diffs against this to decide whether
  // setRequirements is worth a transaction — it has to be the same snapshot the form was seeded
  // from, not whatever the card happens to be rendering (which, in the grid, is the indexed row).
  const editSeedRef = useRef({ requirements: [], mode: 0 })

  // Payment Requirement Input States (blank paymentTokenAddress means the native coin)
  const [paymentTokenAddress, setPaymentTokenAddress] = useState('')
  const [paymentPrice, setPaymentPrice] = useState('')
  const [paymentIsLsp7, setPaymentIsLsp7] = useState(false)
  // Join-fee destination being edited (RecipientField shape); empty means fees go to the
  // creator. Richer rules (multisig, DAO, splits) live in the destination contract itself.
  const [editPayoutDestination, setEditPayoutDestination] = useState(EMPTY_RECIPIENT)
  const [isPayingToJoin, setIsPayingToJoin] = useState(false)

  // New post content inputs
  // Bumped by the NewPost community composer once its tx confirms, so the feed reloads
  const [feedRefreshKey, setFeedRefreshKey] = useState(0)
  // Infinite-scroll paging for the community feed (detail page only) — seeded from the cache so
  // a restored feed keeps paginating from where it left off instead of re-appending page 2
  const [feedPage, setFeedPage] = useState(initialFeedCache?.page ?? 1)
  const [hasMoreFeed, setHasMoreFeed] = useState(initialFeedCache?.hasMore ?? false)
  const [isFeedLoadingMore, setIsFeedLoadingMore] = useState(false)

  // Member management state
  const [pendingRequests, setPendingRequests] = useState([])
  const [members, setMembers] = useState([])
  // Banned wallets are not members (setBanStatus removes them from the roster), so they come
  // from the contract's separate banned list — this is where a moderator unbans from
  const [bannedMembers, setBannedMembers] = useState([])
  const [inviteAddress, setInviteAddress] = useState(EMPTY_RECIPIENT)
  const [approvingAddress, setApprovingAddress] = useState(null)
  const [rejectingAddress, setRejectingAddress] = useState(null)
  const [banningAddress, setBanningAddress] = useState(null)
  const [whitelistEntries, setWhitelistEntries] = useState([])
  const [newWhitelistAddress, setNewWhitelistAddress] = useState(EMPTY_RECIPIENT)
  const [removingWhitelistAddress, setRemovingWhitelistAddress] = useState(null)

  // Lazy key-delivery state: pending 'grant' requests (members missing the current-version
  // envelope) and whether a rotation is pending (someone self-left; only a moderator can rotate)
  const [keyRequests, setKeyRequests] = useState([])
  const [isGrantingBatch, setIsGrantingBatch] = useState(false)
  // Grant requests that couldn't be fulfilled because the member has no identity key
  // registered on this contract — surfaced instead of silently skipped
  const [grantSkippedAddresses, setGrantSkippedAddresses] = useState([])
  const [isTogglingHistory, setIsTogglingHistory] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [isInitializingKey, setIsInitializingKey] = useState(false)

  // Contract data query hook
  const {
    data,
    isLoading,
    refetch: refetchCommunity,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'communities',
    args: [id],
    query: { enabled: liveReads },
  })

  // Safe-to-use-before-loaded derived values so hooks below can reference them unconditionally.
  // Chain first where it was read, indexed row otherwise — the two carry the same fields, and
  // writing it this way means the detail page keeps its live answer without a second code path.
  const creator = data ? data[1] : (row?.creator_address ?? null)
  const admission = data ? Number(data[2]) : row ? Number(row.membership_type) : null
  const cType = data ? Number(data[3]) : row?.community_type === null || row?.community_type === undefined ? null : Number(row.community_type)
  // Indices track the Community struct's field order (id, creator, admission, cType, isActive,
  // metadata) — isActive sits before metadata so it packs into the creator slot onchain.
  const isActive = data ? Boolean(data[4]) : row ? Boolean(row.is_active) : true
  const isOwner = Boolean(activeAccountAddress && creator && activeAccountAddress.toLowerCase() === creator.toLowerCase())

  // The community's composable requirement list + its ALL/ANY combinator (empty = no gating)
  const { data: requirementsData, refetch: refetchRequirements } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'getRequirements',
    args: [id],
    query: { enabled: liveReads },
  })
  // Indexed rows arrive in the contract's own order with snake_case columns; normalized here to
  // the tuple shape the chips and the editor already expect, so neither has to know the source.
  const requirementsList =
    requirementsData ??
    (row?.requirements ?? []).map((requirement) => ({
      rType: Number(requirement.r_type),
      asset: requirement.asset,
      minBalance: BigInt(requirement.min_balance ?? 0),
      // Resolved by cidex at index time — present only on the indexed shape, and what lets a
      // chip read "min 100 USDC" without the card touching the token contract
      assetName: requirement.asset_name,
      assetSymbol: requirement.asset_symbol,
      assetDecimals: requirement.asset_decimals === null ? undefined : Number(requirement.asset_decimals),
    }))

  const { data: requirementModeData } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'requirementMode',
    args: [id],
    query: { enabled: liveReads && requirementsList.length > 1 },
  })
  const requirementMode = requirementModeData === undefined ? Number(row?.requirement_mode ?? 0) : Number(requirementModeData)

  const { data: paymentRequirementData, refetch: refetchPaymentRequirement } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'paymentRequirements',
    args: [id],
    query: { enabled: liveReads },
  })

  // Unpacked next to its read (rather than further down with the rest of the render values) so
  // the metadata hook below stays above this component's loading return. Only the two values the
  // card displays: the LSP7 flag decides which approval call a paid join makes, so it is read
  // live at the moment of paying rather than taken from here.
  const savedPaymentToken = paymentRequirementData ? paymentRequirementData[0] : (row?.payment_token ?? null)
  const savedPaymentPrice = paymentRequirementData ? paymentRequirementData[1]?.toString() : (row?.payment_price ?? null)
  const hasValidPaymentRequirement = Boolean(savedPaymentPrice) && savedPaymentPrice !== '0'
  const isPaymentNative = isNativeAsset(savedPaymentToken)

  // Where the fee goes: the community's payout destination (zero = creator). join() pushes
  // the fee straight there. Read for everyone — a joiner deserves to see where their money
  // lands before they pay.
  const { data: payoutDestinationData, refetch: refetchPayoutDestination } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'payoutDestination',
    args: [id],
    query: { enabled: liveReads },
  })
  // cidex indexes the same address off PayoutDestinationSet, so the row answers this while the
  // read is still in flight — the live value takes over the moment it lands.
  const savedPayoutDestination = payoutDestinationData ?? row?.payout_destination ?? null
  const payoutDestination =
    savedPayoutDestination && savedPayoutDestination !== ZERO_ADDRESS ? savedPayoutDestination : null

  // The join price is stored in the smallest unit of whichever asset it's priced in — it only
  // becomes a number anyone can read once scaled by that asset's decimals. cidex resolves the
  // symbol and decimals at index time, so a seeded card skips the token reads entirely.
  const nativeCurrency = getNativeCurrency(chainId)
  const indexedPaymentMeta = row
    ? {
        decimals: isPaymentNative ? nativeCurrency.decimals : row.payment_decimals === null ? undefined : Number(row.payment_decimals),
        symbol: isPaymentNative ? nativeCurrency.symbol : (row.payment_symbol ?? ''),
      }
    : null
  const livePaymentMeta = useTokenMeta(liveReads ? savedPaymentToken : null, chainId)
  // In the grid the live read never runs — and useTokenMeta answers a disabled read with the
  // *native* currency, so it must not be consulted there at all. Where it does run, decimals stays
  // undefined until it lands, and a price with unknown decimals renders as '…' — so the indexed
  // pair carries the label until then rather than instead of it. The detail page used to show that
  // ellipsis for the whole length of a decimals() and a symbol().
  const paymentMeta =
    liveReads && livePaymentMeta.decimals !== undefined ? livePaymentMeta : (indexedPaymentMeta ?? livePaymentMeta)
  const paymentPriceLabel = formatTokenDisplay(savedPaymentPrice, paymentMeta.decimals)
  const paymentPriceWithSymbol = paymentPriceLabel === null ? '…' : `${paymentPriceLabel} ${paymentMeta.symbol}`.trim()

  // Current viewer's membership status (isMember, isPending, isModerator, isBanned, canPost).
  // cidex writes this row straight from registry() on every membership event, so the indexed
  // copy is the same answer a block later — enough to decide which button a card offers, while
  // the contract still decides whether the resulting transaction goes through.
  const { data: myStatusData, refetch: refetchMyStatus } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'registry',
    args: [id, activeAccountAddress],
    query: { enabled: liveReads && !!activeAccountAddress },
  })
  const viewer = row?.viewer ?? null
  const isModerator = isOwner || Boolean(myStatusData ? myStatusData[2] : viewer?.is_moderator)
  const isMember = Boolean(myStatusData ? myStatusData[0] : viewer?.is_member)
  const isBanned = Boolean(myStatusData ? myStatusData[3] : viewer?.is_banned)

  // Live composite eligibility check (bans, moderator override, canPost flag, NFT/token balance,
  // follow status). Gates both the self-service "Request Access" button and the "Write Post"
  // button — this is the exact same check cidex runs before tagging a post with a community, so
  // gating on it keeps the UI from letting someone publish a post the indexer will refuse to tag.
  const { data: myCanPostLive, refetch: refetchMyCanPost } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'canPost',
    args: [activeAccountAddress, id],
    query: { enabled: liveReads && !!activeAccountAddress },
  })

  // DAO mode: the community's optional governance executor (creator-level powers onchain).
  // Reverts on pre-governor deployments — wagmi surfaces that as undefined, i.e. "no governor".
  const { data: governorData, refetch: refetchGovernor } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'governors',
    args: [id],
    query: { enabled: liveReads },
  })
  const governor = governorData
    ? governorData !== ZERO_ADDRESS
      ? governorData
      : null
    : (row?.governor_address ?? null)

  // canPost() reproduced from the indexed row for the grid, following the contract's own order
  // exactly. Everything it checks is indexed except the trailing isEligible() balance re-check,
  // which no index can answer — a member holding a gating asset is presumed to still hold it,
  // and the composer's own transaction (plus cidex's canPost() check before it tags the post)
  // is what settles it. undefined means "not known yet", which leaves the button enabled.
  const canPostFromRow = (() => {
    if (!viewer) return undefined
    if (!isActive || isBanned) return false
    if (isOwner || isModerator || (governor && activeAccountAddress && governor.toLowerCase() === activeAccountAddress.toLowerCase())) return true
    if (cType === 1) return false
    if (!viewer.is_member || !viewer.can_post) return false
    return true
  })()
  // Live answer wins wherever it has arrived; the row's reconstruction stands in until then. Both
  // surfaces read it the same way now — the detail page waited on canPost() before it could decide
  // whether to offer the composer, which is a round trip it already had the answer to.
  const canPost = myCanPostLive ?? (activeAccountAddress ? canPostFromRow : undefined)

  // Live composite eligibility (requirement list + optional module) — lets the Self-serve
  // Join button disable itself proactively instead of submitting a join() that will revert.
  // The one gating read the grid keeps: it turns on current token/NFT balances, which nothing
  // indexed can stand in for, and the condition narrows it to wallets actually looking at a
  // self-serve community they haven't joined.
  const { data: amIEligible } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'isEligible',
    args: [activeAccountAddress, id],
    query: { enabled: !!activeAccountAddress && admission === ADMISSION.SelfServeIfEligible && !isMember && !isOwner },
  })

  const { mutate: joinCommunity, data: joinHash, isPending: isJoinPending, error: joinError } = useWriteContract()
  const { isSuccess: isJoinConfirmed } = useWaitForTransactionReceipt({ hash: joinHash })

  // This community's current content-key version (0 = not encrypted / not yet initialized)
  const { data: keyVersionData, refetch: refetchKeyVersion } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'keyVersion',
    args: [id],
    query: { enabled: liveReads },
  })
  const keyVersion = keyVersionData === undefined ? Number(row?.key_version ?? 0) : Number(keyVersionData)
  // is_encrypted has been indexed since long before key_version, and cidex backfills the version
  // on its own schedule — so a row can legitimately know a community is encrypted without yet
  // knowing which version it is on. The 🔒 chip only needs the former.
  const isEncryptionInitialized = keyVersion > 0 || (keyVersionData === undefined && Boolean(row?.is_encrypted))
  // ...but the key mailbox read below needs the exact version, and a guess would ask for the
  // wrong envelope — which the effect further down would read as "this member has no key" and
  // file a grant request nobody needs. It only runs where the version is known for certain.
  const hasAuthoritativeKeyVersion = keyVersionData !== undefined || Number(row?.key_version ?? 0) > 0

  // History policy: when true, rotations publish backward key-chain links so members holding
  // only the current key (including future joiners) can decrypt pre-rotation posts.
  const { data: historyVisibleData, refetch: refetchHistoryVisible } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'historyVisibleToNewMembers',
    args: [id],
    query: { enabled: liveReads },
  })
  const historyVisible = historyVisibleData === undefined ? Boolean(row?.history_visible) : Boolean(historyVisibleData)

  // The viewer's own wrapped copy of the current content key. This one has no indexed stand-in
  // and never will: the envelope is a secret wrapped to the member's public key, and the whole
  // point is that no server holds it. Narrowed to members of encrypted communities instead —
  // where it fires it is doing real work (deciding whether to file a key-grant request), and
  // outside that it never had an answer worth reading.
  const { data: myWrappedKeyData, refetch: refetchMyWrappedKey } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'wrappedKeys',
    args: [id, activeAccountAddress, BigInt(keyVersion || 0)],
    query: { enabled: isEncryptionInitialized && hasAuthoritativeKeyVersion && !!activeAccountAddress && isMember },
  })

  // Contract modification hook for updating space metadata
  const { mutate: updateContract, data: updateHash, isPending: isUpdatePending, error: updateError } = useWriteContract()

  const { isLoading: isUpdateConfirming, isSuccess: isUpdateConfirmed } = useWaitForTransactionReceipt({ hash: updateHash })

  // Contract modification hook for replacing the composable requirement list
  const {
    mutate: updateRequirementsWrite,
    data: requirementsHash,
    isPending: isRequirementsPending,
    error: requirementsError,
  } = useWriteContract()

  const { isLoading: isRequirementsConfirming, isSuccess: isRequirementsConfirmed } = useWaitForTransactionReceipt({
    hash: requirementsHash,
  })

  // Contract modification hook for setting the Fixed Price join cost
  const {
    mutate: updatePaymentRequirement,
    data: paymentReqHash,
    isPending: isPaymentReqPending,
    error: paymentReqError,
  } = useWriteContract()

  const { isLoading: isPaymentReqConfirming, isSuccess: isPaymentReqConfirmed } = useWaitForTransactionReceipt({ hash: paymentReqHash })

  // Ledger write for re-pointing the community's join-fee destination (creator-only on the
  // contract; zero address clears back to the creator)
  const {
    mutate: updatePayoutDestination,
    data: payoutDestinationHash,
    error: payoutDestinationError,
  } = useWriteContract()

  const { isSuccess: isPayoutDestinationConfirmed } = useWaitForTransactionReceipt({ hash: payoutDestinationHash })

  useEffect(() => {
    if (isPayoutDestinationConfirmed) refetchPayoutDestination()
  }, [isPayoutDestinationConfirmed, refetchPayoutDestination])

  // Contract modification hook for paying to join a Fixed Price community
  const { mutate: payToJoin, data: payToJoinHash, isPending: isPayToJoinPending, error: payToJoinError } = useWriteContract()

  const { isLoading: isPayToJoinConfirming, isSuccess: isPayToJoinConfirmed } = useWaitForTransactionReceipt({ hash: payToJoinHash })

  // ERC-20/LSP7 approval hook, used before payToJoin when the price is token-denominated
  const { writeContractAsync: approveTokenAsync } = useWriteContract()

  // Contract modification hook for archiving/reactivating a space (freezes canPost/join, keeps
  // existing posts and membership intact)
  const { mutate: setStatusContract, data: statusHash, isPending: isStatusPending, error: statusError } = useWriteContract()

  const { isLoading: isStatusConfirming, isSuccess: isStatusConfirmed } = useWaitForTransactionReceipt({ hash: statusHash })

  // --- Member management: approve pending requests ---

  const { mutate: approveRequest, data: approveHash, isPending: isApprovePending, error: approveError } = useWriteContract()
  const { isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash })

  const { mutate: rejectRequestWrite, data: rejectHash, isPending: isRejectPending } = useWriteContract()
  const { isSuccess: isRejectConfirmed } = useWaitForTransactionReceipt({ hash: rejectHash })

  // The requester's own side of rejectRequest: cancelRequest clears their onchain isPending flag
  const {
    mutate: cancelRequestWrite,
    data: cancelRequestHash,
    isPending: isCancelRequestPending,
    error: cancelRequestError,
  } = useWriteContract()
  const { isSuccess: isCancelRequestConfirmed } = useWaitForTransactionReceipt({ hash: cancelRequestHash })

  const { mutate: grantKeyToMember, data: grantHash } = useWriteContract()
  useWaitForTransactionReceipt({ hash: grantHash })

  const approveHandledRef = useRef(null)

  // --- Member management: ban + key rotation ---

  const { mutate: banMember, data: banHash, isPending: isBanPending, error: banError } = useWriteContract()
  const { isSuccess: isBanConfirmed } = useWaitForTransactionReceipt({ hash: banHash })

  // Unban lives on its own hook: banMember's confirmation effect rotates the encryption key
  // (correct after removing someone), which must NOT fire when a moderator readmits someone
  const { mutate: unbanMember, data: unbanHash, isPending: isUnbanPending, error: unbanError } = useWriteContract()
  const { isSuccess: isUnbanConfirmed } = useWaitForTransactionReceipt({ hash: unbanHash })

  // --- Two-step invites (consent is structural: invite → the wallet itself accepts) ---

  const { mutate: inviteMemberWrite, data: inviteHash, isPending: isInvitePending, error: inviteError } = useWriteContract()
  const { isSuccess: isInviteConfirmed } = useWaitForTransactionReceipt({ hash: inviteHash })

  useEffect(() => {
    if (isInviteConfirmed) setInviteAddress('')
  }, [isInviteConfirmed])

  // The viewer's own outstanding invite (if any) + their accept/decline response. Reverts on
  // pre-invite deployments — wagmi surfaces that as undefined, i.e. "no invite". cidex indexes
  // the same flag from MemberInvited/InviteRevoked (and clears it on accept, which emits
  // neither), so a seeded card shows the banner without a read of its own.
  const { data: myInviteDataLive, refetch: refetchMyInvite } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'invites',
    args: [id, activeAccountAddress],
    query: { enabled: liveReads && !!activeAccountAddress },
  })
  // undefined covers both "not read yet" and "this deployment predates invites and reverted" —
  // the indexed flag is the right answer in the first case and absent in the second, so the same
  // fallback serves both.
  const hasInvite =
    myInviteDataLive !== undefined ? Boolean(myInviteDataLive) : Boolean(activeAccountAddress && viewer?.is_invited)

  const { mutate: respondInvite, data: inviteRespHash, isPending: isInviteRespPending, error: inviteRespError } = useWriteContract()
  const { isSuccess: isInviteRespConfirmed } = useWaitForTransactionReceipt({ hash: inviteRespHash })

  useEffect(() => {
    if (isInviteRespConfirmed) {
      refetchMyInvite()
      refetchMyStatus()
      refetchMyCanPost()
    }
  }, [isInviteRespConfirmed])

  // --- DAO governance (set/clear the community's governance executor) ---

  const [newGovernorAddress, setNewGovernorAddress] = useState('')
  const { mutate: setGovernorWrite, data: governorHash, isPending: isGovernorPending, error: governorError } = useWriteContract()
  const { isLoading: isGovernorConfirming, isSuccess: isGovernorConfirmed } = useWaitForTransactionReceipt({ hash: governorHash })

  useEffect(() => {
    if (isGovernorConfirmed) {
      refetchGovernor()
      setNewGovernorAddress('')
    }
  }, [isGovernorConfirmed])

  const { mutate: bumpKeyVersion, data: bumpHash, isPending: isBumpPending } = useWriteContract()
  const { isLoading: isBumpConfirming, isSuccess: isBumpConfirmed } = useWaitForTransactionReceipt({ hash: bumpHash })

  const { writeContractAsync: writeVaultAsync } = useWriteContract()

  // --- Whitelist management (WhitelistGated only) ---

  const { mutate: setWhitelistedContract, data: whitelistHash, isPending: isWhitelistPending, error: whitelistError } = useWriteContract()
  const { isSuccess: isWhitelistConfirmed } = useWaitForTransactionReceipt({ hash: whitelistHash })

  useEffect(() => {
    if (isWhitelistConfirmed) {
      refetchWhitelist()
      setNewWhitelistAddress('')
      setRemovingWhitelistAddress(null)
    }
  }, [isWhitelistConfirmed])

  const banHandledRef = useRef(null)
  const rotateHandledRef = useRef(null)

  // --- Transaction feedback ---

  // Every write on this card reports itself in a toast rather than a line under its own button.
  // The card is tall and the wallet answers seconds later, so an inline line was routinely
  // scrolled out of view — and inside the Modify dialog it vanished the moment the dialog closed,
  // which is exactly when a slow confirmation lands.
  const feedbackToastRef = useRef(null)
  const showFeedback = (message, type, options) => {
    // update() returns false once the user has closed the toast — start a fresh one then, so a
    // verdict is never silently swallowed
    if (!feedbackToastRef.current?.update(message, type, options)) feedbackToastRef.current = toast(message, type, options)
  }

  // Each write's failure, labelled with the action it belongs to — wagmi holds one error object
  // per hook until that hook is used again, so identity is what tells a new failure from a
  // re-render of an old one.
  const writeFailures = [
    ['Couldn’t join', joinError],
    ['Couldn’t pay to join', payToJoinError],
    ['Couldn’t withdraw the request', cancelRequestError],
    ['Couldn’t answer the invite', inviteRespError],
    ['Couldn’t save the details', updateError],
    ['Couldn’t save the requirements', requirementsError],
    ['Couldn’t save the join price', paymentReqError],
    ['Couldn’t save the fee destination', payoutDestinationError],
    ['Couldn’t change the community’s status', statusError],
    ['Couldn’t approve the request', approveError],
    ['Couldn’t ban the member', banError],
    ['Couldn’t unban the member', unbanError],
    ['Couldn’t send the invite', inviteError],
    ['Couldn’t update the moderator', governorError],
    ['Couldn’t update the whitelist', whitelistError],
  ]
  const reportedFailureRef = useRef(null)
  useEffect(() => {
    const failure = writeFailures.find(([, error]) => error)
    if (!failure) return
    const [label, error] = failure
    if (reportedFailureRef.current === error) return
    reportedFailureRef.current = error
    console.error(`${label}:`, error)
    showFeedback(`${label} — ${asClause(describeWalletError(error, { known: KNOWN_REVERTS }))}`, 'error', { duration: ERROR_TOAST_MS })
  }, [
    joinError,
    payToJoinError,
    cancelRequestError,
    inviteRespError,
    updateError,
    requirementsError,
    paymentReqError,
    payoutDestinationError,
    statusError,
    approveError,
    banError,
    unbanError,
    inviteError,
    governorError,
    whitelistError,
  ])

  // Saving the Modify form is one morphing toast (saving → saved), the same shape the create
  // modal uses. A save can span three transactions, so "saved" waits for whichever of them the
  // submission actually started.
  const isSavingConfig = isUpdateConfirming || isRequirementsConfirming || isPaymentReqConfirming
  useEffect(() => {
    if (isSavingConfig) showFeedback('Saving your changes…', 'loading')
  }, [isSavingConfig])

  const isConfigSaved =
    isUpdateConfirmed &&
    (!requirementsHash || isRequirementsConfirmed) &&
    (editAdmission !== ADMISSION.PayToJoin || !paymentReqHash || isPaymentReqConfirmed)
  useEffect(() => {
    if (!isConfigSaved) return
    showFeedback('Changes saved.', 'success')
    // Released so the next save opens its own toast instead of morphing this one
    feedbackToastRef.current = null
  }, [isConfigSaved])

  // Refresh the requirement list on successful block confirmation
  useEffect(() => {
    if (isRequirementsConfirmed) {
      refetchRequirements()
    }
  }, [isRequirementsConfirmed, refetchRequirements])

  // Refresh Payment requirement state on successful block confirmation
  useEffect(() => {
    if (isPaymentReqConfirmed) {
      refetchPaymentRequirement()
    }
  }, [isPaymentReqConfirmed, refetchPaymentRequirement])

  // After successfully paying to join, refresh the viewer's own membership status
  useEffect(() => {
    if (isPayToJoinConfirmed) {
      setIsPayingToJoin(false)
      refetchMyStatus()
      refetchMyCanPost()
    }
  }, [isPayToJoinConfirmed, refetchMyStatus, refetchMyCanPost])

  // Refresh the community's active/archived state on successful block confirmation
  useEffect(() => {
    if (isStatusConfirmed) {
      refetchCommunity()
    }
  }, [isStatusConfirmed, refetchCommunity])

  // Load pending join/access requests from the off-chain discovery index (see plan notes on why
  // this can't be reconstructed from on-chain events alone). Fetched for anyone — not just
  // moderators — so a regular viewer can tell whether *their own* request is already pending;
  // the full-list UI itself is still moderator-only (see isManagingMembers panel).
  const refetchPendingRequests = async () => {
    if (!chainId) return
    try {
      const res = await fetch(`/api/communities/join-requests?network_id=${chainId}&community_id=${id}&contract_address=${CONTRACT_ADDRESS}`)
      const json = await res.json()
      setPendingRequests(json.success ? json.data : [])
    } catch (err) {
      console.error('Failed to load pending join requests:', err)
    }
  }

  const refetchKeyRequests = async () => {
    if (!chainId) return
    try {
      const res = await fetch(`/api/communities/key-requests?network_id=${chainId}&community_id=${id}`)
      const json = await res.json()
      setKeyRequests(json.success ? json.data : [])
    } catch (err) {
      console.error('Failed to load pending key requests:', err)
    }
  }

  const pendingGrantRequests = keyRequests.filter((r) => r.request_type === 'grant')
  const isRotationPending = keyRequests.some((r) => r.request_type === 'rotation')

  const isRequestApproval = admission === ADMISSION.RequestApproval

  // The moderator queue itself. In the grid the viewer's own standing already arrives on the row
  // (community_members.is_pending, which is what this endpoint reads too), so fetching the whole
  // queue per card would be one request per community for information the page already has.
  useEffect(() => {
    if (isRequestApproval && liveReads) {
      refetchPendingRequests()
    }
  }, [isRequestApproval, liveReads, chainId, id])

  // Lazy key delivery, member side: a member with no envelope for the current key version (e.g.
  // they were offline during a rotation) files a 'grant' request so moderators can batch-deliver.
  // Once the envelope shows up, the request cleans itself up. INSERT IGNORE server-side makes the
  // POST idempotent; the ref just avoids re-firing within this mount.
  const keyRequestFiledRef = useRef(false)
  useEffect(() => {
    if (!isEncryptionInitialized || !isMember || !activeAccountAddress || myWrappedKeyData === undefined) return

    if (myWrappedKeyData === '0x') {
      if (keyRequestFiledRef.current) return
      keyRequestFiledRef.current = true
      fetch('/api/communities/key-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          networkId: chainId,
          communityId: id,
          walletAddress: activeAccountAddress,
          requestType: 'grant',
          keyVersion,
        }),
      }).catch(() => {})
    } else if (keyRequestFiledRef.current) {
      keyRequestFiledRef.current = false
      fetch(
        `/api/communities/key-requests?network_id=${chainId}&community_id=${id}&wallet_address=${activeAccountAddress}&request_type=grant`,
        { method: 'DELETE' }
      ).catch(() => {})
    }
  }, [isEncryptionInitialized, isMember, activeAccountAddress, myWrappedKeyData, keyVersion, chainId, id])

  const myPendingRequest = pendingRequests.find((r) => r.wallet_address?.toLowerCase() === activeAccountAddress?.toLowerCase())
  // Onchain isPending is authoritative; the indexed copy is the same flag cidex re-read from
  // registry(), and the queue endpoint reads it too. Any of them pending is enough to offer the
  // requester a cancel.
  const hasPendingRequest = Boolean(myStatusData ? myStatusData[1] : viewer?.is_pending) || Boolean(myPendingRequest)

  // Pay to Join is also self-service, but pays first: native coin goes
  // straight into join()'s value; a token price needs an authorization step the contract can pull
  // from first — LSP7's authorizeOperator(spender, amount, data) for an LSP7 asset, or ERC-20's
  // approve(spender, amount) otherwise. These are not the same call: LSP7 has no transferFrom, so
  // using the wrong one here would leave join() unable to actually collect payment.
  const handlePayToJoin = async () => {
    if (!activeAccountAddress || !chainId) return

    setIsPayingToJoin(true)
    setHasInteracted(true)
    try {
      // The price is read from the contract here, never from the indexed row the card renders.
      // It decides how much this wallet approves, how much value the transaction carries, and
      // the _maxPrice ceiling below — an indexed copy one block behind could put all three on a
      // stale number, and being off by a block is not something to be off by when spending money.
      const livePayment = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: HupCommunityABI,
        functionName: 'paymentRequirements',
        args: [id],
      })
      const [token, price, isLsp7] = livePayment
      const isNative = !token || token === ZERO_ADDRESS
      if (!price || price === 0n) {
        alert("This community's join price isn't set — the creator needs to set one before anyone can pay to join.")
        setIsPayingToJoin(false)
        return
      }

      // The stored flag picks both this approval and the transfer join() pulls with. If it
      // disagrees with what the token itself reports, the wrong selector is about to be sent to
      // a contract that has no such function — the wallet's gas estimate reverts before anything
      // reaches the chain, and the creator re-saving the join price is the only fix. Say so.
      if (!isNative && (await fetchIsLsp7(publicClient, chainId, token)) !== Boolean(isLsp7)) {
        alert(
          `This community's join price is saved as ${isLsp7 ? 'an LSP7' : 'an ERC-20'} token, but the token reports the opposite. Joining would fail — the creator needs to re-save the join price from the Modify form.`
        )
        setIsPayingToJoin(false)
        return
      }

      // Both approvals pin chainId like join does, so a wallet sitting on another network is
      // switched rather than authorizing the spend on whatever chain it happens to be on.
      let approvalHash
      if (!isNative && isLsp7) {
        approvalHash = await approveTokenAsync({
          address: token,
          chainId,
          abi: [
            {
              name: 'authorizeOperator',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'operator', type: 'address' },
                { name: 'amount', type: 'uint256' },
                { name: 'operatorNotificationData', type: 'bytes' },
              ],
              outputs: [],
            },
          ],
          functionName: 'authorizeOperator',
          // join() pulls the fee from the joiner and forwards it to the payout destination, so
          // the community contract is the operator.
          args: [CONTRACT_ADDRESS, price, '0x'],
        })
      } else if (!isNative) {
        approvalHash = await approveTokenAsync({
          address: token,
          chainId,
          abi: [
            {
              name: 'approve',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'spender', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
              outputs: [{ type: 'bool' }],
            },
          ],
          functionName: 'approve',
          args: [CONTRACT_ADDRESS, price],
        })
      }
      // writeContractAsync resolves when the wallet has signed, not when the approval is mined.
      // Sending join() straight away makes the wallet estimate it against an allowance that
      // isn't there yet, and MetaMask refuses a call whose estimate reverts. Wait for inclusion.
      if (approvalHash) await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      payToJoin({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'join',
        // _maxPrice pins the ceiling to the price this screen read and approved for, so a
        // setPaymentRequirement landing between the approval and this tx reverts instead of
        // silently charging the new price against the standing allowance.
        args: [id, price],
        value: isNative ? price : 0n,
      })
    } catch (err) {
      console.error('Failed to pay to join:', err)
      setIsPayingToJoin(false)
    }
  }

  // Open and Self-serve communities still require an explicit join() — the contract's canPost()
  // checks the roster's canPost flag for everyone, and cidex mirrors that check before tagging a
  // post with a community. Without joining first, a post would publish untagged.
  const handleJoin = () => {
    if (!activeAccountAddress || !chainId) return
    setHasInteracted(true)
    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      // _maxPrice 0: this path never pays, and it makes a community that flipped to PayToJoin
      // since the screen loaded revert instead of charging.
      args: [id, 0n],
    })
  }

  // RequestApproval admission: join() files the onchain isPending flag; the offchain record that
  // makes the request discoverable to moderators is written only AFTER the tx confirms (see the
  // isJoinConfirmed effect below). Recording it here would leave a phantom queue entry whenever
  // the wallet prompt is rejected or the tx fails — approveRequest on a wallet whose onchain
  // isPending was never set reverts with NoPendingRequest.
  const handleRequestAccess = () => {
    if (!activeAccountAddress || !chainId) return
    setHasInteracted(true)

    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      // _maxPrice 0: this path never pays, and it makes a community that flipped to PayToJoin
      // since the screen loaded revert instead of charging.
      args: [id, 0n],
    })
  }

  // A RequestApproval join only sets isPending onchain — no membership, no roster change. cidex
  // indexes MembershipRequested straight into community_members.is_pending, so there is nothing to
  // file here; just re-read the queue once the tx confirms.
  useEffect(() => {
    if (!isJoinConfirmed) return

    refetchMyStatus()
    refetchMyCanPost()

    if (admission === ADMISSION.RequestApproval) {
      refetchPendingRequests()
    }
  }, [isJoinConfirmed, admission, refetchMyStatus, refetchMyCanPost])

  // Withdrawing a filed request: cancelRequest clears the onchain isPending flag the queue is
  // built from, so there is no second record left to drift out of step with it.
  const handleCancelRequest = () => {
    if (!activeAccountAddress || !chainId) return
    setHasInteracted(true)

    cancelRequestWrite({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'cancelRequest',
      args: [id],
    })
  }

  const cancelRequestHandledRef = useRef(null)
  useEffect(() => {
    if (!isCancelRequestConfirmed || !activeAccountAddress || cancelRequestHandledRef.current === cancelRequestHash) return
    cancelRequestHandledRef.current = cancelRequestHash

    refetchMyStatus()
    refetchPendingRequests()
  }, [isCancelRequestConfirmed, cancelRequestHash, activeAccountAddress, chainId, id, refetchMyStatus])

  // Refresh the on-chain community row once an update confirms
  useEffect(() => {
    if (isUpdateConfirmed) refetchCommunity()
  }, [isUpdateConfirmed, refetchCommunity])

  // Enable encrypted content: encryption is now an explicit per-community toggle (orthogonal to
  // admission mode) backed by keyVersion > 0, so enabling it later is one direct initializeKey
  // tx from the Modify dialog — no more two-tx type-change window to fall into.
  const handleEnableEncryption = async () => {
    if (!vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }
    setIsInitializingKey(true)
    try {
      const hash = await writeVaultAsync({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'initializeKey',
        args: [id, wrapContentKey(generateContentKey(), vault.identity.pubKeyHex)],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      refetchKeyVersion()
      refetchMyWrappedKey()
    } catch (err) {
      console.error('Failed to finish the community encryption setup:', err)
    } finally {
      setIsInitializingKey(false)
    }
  }

  // Member/whitelist lists are read directly from the contract's paginated getMembers/getWhitelist
  // (backed by the enumerable on-chain arrays) rather than cidex's indexed copy — correctness never
  // depends on indexer freshness. The getters are moderator-gated on-chain, so every read passes
  // `account` to make _msgSender() resolve to the connected moderator during eth_call.
  const fetchAllPaginated = async (functionName, countFunctionName) => {
    const total = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: countFunctionName,
      args: [id],
      account: activeAccountAddress,
    })

    const pageSize = 100n
    const addresses = []
    for (let offset = 0n; offset < total; offset += pageSize) {
      const page = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName,
        args: [id, offset, pageSize],
        account: activeAccountAddress,
      })
      addresses.push(...page)
    }
    return addresses
  }

  // Member lists are moderator-only: gated on-chain (getMembers/memberCount revert for
  // non-moderators) and hidden in the UI. Best-effort hiding — a determined observer can still
  // reconstruct membership from events/storage; real hiding waits for the separate ZK contract.
  const refetchMembers = async () => {
    if (!isModerator || !chainId || !CONTRACT_ADDRESS || !publicClient) return
    try {
      // A ban removes the wallet from the member roster, so nothing here can be banned — the
      // banned list is its own paginated read below
      const addresses = await fetchAllPaginated('getMembers', 'memberCount')
      setMembers(addresses.map((addr) => ({ address: addr })))
    } catch (err) {
      console.error('Failed to load community member list on-chain:', err)
    }
  }

  const refetchBanned = async () => {
    if (!isModerator || !chainId || !CONTRACT_ADDRESS || !publicClient) return
    try {
      setBannedMembers(await fetchAllPaginated('getBanned', 'bannedCount'))
    } catch (err) {
      console.error('Failed to load community banned list on-chain:', err)
    }
  }

  const refetchWhitelist = async () => {
    if (!isModerator || !chainId || !CONTRACT_ADDRESS || !publicClient) return
    try {
      const addresses = await fetchAllPaginated('getWhitelist', 'whitelistCount')
      setWhitelistEntries(addresses)
    } catch (err) {
      console.error('Failed to load community whitelist on-chain:', err)
    }
  }

  useEffect(() => {
    if (isManagingMembers) {
      refetchMembers()
      if (isModerator) {
        refetchKeyRequests()
        refetchWhitelist()
        refetchBanned()
      }
    }
  }, [isManagingMembers, id, isApproveConfirmed, isBanConfirmed, isUnbanConfirmed, isModerator])

  // Readmission is roster-only — clear the row's busy state once it confirms (the member list
  // refresh itself is handled by the effect above via isUnbanConfirmed)
  useEffect(() => {
    if (isUnbanConfirmed) setBanningAddress(null)
  }, [isUnbanConfirmed])

  // After a join request is approved on-chain: drop it from this panel right away (approveRequest
  // clears isPending, so the indexed queue follows a beat later), and if this community is
  // encrypted, grant the new member the current content key
  useEffect(() => {
    const run = async () => {
      if (!isApproveConfirmed || !approvingAddress || approveHandledRef.current === approveHash) return
      approveHandledRef.current = approveHash

      setPendingRequests((prev) => prev.filter((r) => r.wallet_address?.toLowerCase() !== approvingAddress.toLowerCase()))

      if (isEncryptionInitialized && vault.identity && myWrappedKeyData && myWrappedKeyData !== '0x') {
        try {
          const memberPubKey = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: HupCommunityABI,
            functionName: 'communityIdentityKeys',
            args: [approvingAddress],
          })
          if (memberPubKey && memberPubKey !== '0x') {
            const rawContentKey = unwrapContentKey(myWrappedKeyData, vault.identity.privKeyHex)
            const wrapped = wrapContentKey(rawContentKey, memberPubKey)
            grantKeyToMember({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'grantKey',
              args: [id, approvingAddress, wrapped],
            })
          }
        } catch (err) {
          console.error(
            'Failed to grant the community key to the newly approved member (they may not have set up their identity key yet):',
            err
          )
        }
      }

      setApprovingAddress(null)
      refetchMyStatus()
    }
    run()
  }, [isApproveConfirmed, approveHash, approvingAddress])

  // After a rejection confirms: drop it from this panel immediately — rejectRequest clears
  // isPending, so it leaves the indexed queue for every other moderator a beat later. The wallet
  // stays free to request again; rejection doesn't ban.
  const rejectHandledRef = useRef(null)
  useEffect(() => {
    if (!isRejectConfirmed || !rejectingAddress || rejectHandledRef.current === rejectHash) return
    rejectHandledRef.current = rejectHash

    setPendingRequests((prev) => prev.filter((r) => r.wallet_address?.toLowerCase() !== rejectingAddress.toLowerCase()))
    setRejectingAddress(null)
  }, [isRejectConfirmed, rejectHash, rejectingAddress])

  // After a ban/leave confirms on encrypted communities: rotate the key so the departed member
  // can't read future posts. Only a moderator can rotate (bumpKeyVersion is moderator-gated), so
  // self-leave can't do it — leave() cleared their roles in the same tx. Instead it files a
  // 'rotation' key request, which moderators see as a pending-rotation banner in the members panel.
  useEffect(() => {
    if (!isBanConfirmed || !banningAddress || banHandledRef.current === banHash) return
    banHandledRef.current = banHash

    refetchMyStatus()
    refetchMyCanPost()

    if (!isEncryptionInitialized) {
      setBanningAddress(null)
      return
    }

    const isSelfLeave = banningAddress.toLowerCase() === activeAccountAddress?.toLowerCase()
    if (isSelfLeave) {
      fetch('/api/communities/key-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: chainId, communityId: id, walletAddress: banningAddress, requestType: 'rotation' }),
      }).catch(() => {})
      setBanningAddress(null)
      return
    }

    bumpKeyVersion({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'bumpKeyVersion',
      args: [id],
    })
  }, [isBanConfirmed, banHash, banningAddress, isEncryptionInitialized])

  // After the version bump confirms: LAZY re-grant. Only the moderators get the fresh key
  // immediately (a handful of envelopes in one batch tx) — security is already achieved at this
  // instant, since new posts use the new key the departed member will never receive. Every other
  // member picks the key up on demand: their client files a 'grant' key request when it next
  // notices the missing envelope, and a moderator batch-clears the queue from the members panel.
  // This keeps rotation O(moderators) instead of O(members).
  useEffect(() => {
    const run = async () => {
      if (!isBumpConfirmed || !vault.identity || rotateHandledRef.current === bumpHash) return
      rotateHandledRef.current = bumpHash

      // Moderators are discovered on-chain (getMembers + registry), not from the indexer's copy:
      // this list decides who receives the fresh key envelopes, so it must be the authoritative
      // registry state — and the members API now requires a signed request, which would mean an
      // extra wallet popup mid-rotation for data the chain hands the moderator directly.
      let moderatorAddresses = []
      try {
        const memberAddresses = await fetchAllPaginated('getMembers', 'memberCount')
        const statuses = await Promise.all(
          memberAddresses.map((addr) =>
            publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'registry',
              args: [id, addr],
            })
          )
        )
        moderatorAddresses = memberAddresses
          .filter((addr, i) => (Boolean(statuses[i][2]) || addr.toLowerCase() === creator.toLowerCase()) && !Boolean(statuses[i][3]))
          .filter((addr) => addr.toLowerCase() !== banningAddress?.toLowerCase())
      } catch (err) {
        console.error('Failed to load the moderator list on-chain for community key rotation:', err)
      }

      const newRawContentKey = generateContentKey()

      const grantMembers = []
      const grantEnvelopes = []
      for (const memberAddress of moderatorAddresses) {
        try {
          const memberPubKey = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: HupCommunityABI,
            functionName: 'communityIdentityKeys',
            args: [memberAddress],
          })
          if (!memberPubKey || memberPubKey === '0x') continue

          grantMembers.push(memberAddress)
          grantEnvelopes.push(wrapContentKey(newRawContentKey, memberPubKey))
        } catch (err) {
          console.error('Failed to prepare the rotated key envelope for moderator', memberAddress, err)
        }
      }

      try {
        if (grantMembers.length > 0) {
          await writeVaultAsync({
            address: CONTRACT_ADDRESS,
            abi: HupCommunityABI,
            functionName: 'grantKeyBatch',
            args: [id, grantMembers, grantEnvelopes],
          })
        }

        // History policy: when enabled, chain the retiring key to the new one so members holding
        // only the current key (incl. future joiners) can still open pre-rotation posts. The old
        // key comes from this moderator's own envelope at the retiring version.
        if (historyVisible) {
          try {
            const newVersion = Number(
              await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: HupCommunityABI, functionName: 'keyVersion', args: [id] })
            )
            const myOldEnvelope = await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'wrappedKeys',
              args: [id, activeAccountAddress, BigInt(newVersion - 1)],
            })
            if (myOldEnvelope && myOldEnvelope !== '0x') {
              const oldRawKey = unwrapContentKey(myOldEnvelope, vault.identity.privKeyHex)
              const backlink = await wrapKeyWithKey(oldRawKey, newRawContentKey)
              await writeVaultAsync({
                address: CONTRACT_ADDRESS,
                abi: HupCommunityABI,
                functionName: 'publishKeyBacklink',
                args: [id, BigInt(newVersion), backlink],
              })
            }
          } catch (err) {
            // Non-fatal: rotation security is already in place — a missing backlink only means
            // this epoch boundary stays a wall until a moderator backfills it from the panel.
            console.error('Failed to publish the history backlink for this rotation:', err)
          }
        }

        // Rotation happened — the pending-rotation flag (from self-leaves) is resolved
        fetch(`/api/communities/key-requests?network_id=${chainId}&community_id=${id}&request_type=rotation`, {
          method: 'DELETE',
        }).catch(() => {})
      } catch (err) {
        console.error('Failed to grant the rotated community key to moderators:', err)
      }

      setBanningAddress(null)
      refetchKeyVersion()
      refetchMyWrappedKey()
      refetchKeyRequests()
    }
    run()
  }, [isBumpConfirmed, bumpHash])

  // Load this community's feed from cidex (the off-chain indexer) instead of a dedicated on-chain
  // feed contract. cidex only tags a post with community_id after verifying HupCommunity.canPost()
  // itself, so by the time a post shows up here the community link has already been verified —
  // see plan notes on why this replaced HupCommunityFeed.
  // Decrypt pipeline shared by the initial load and the infinite-scroll pages below
  const decryptFeedRows = async (liveRows) => {
    // Fetch the viewer's wrapped key once per distinct key version seen in this batch,
    // instead of once per post
    const distinctVersions = [
      ...new Set(
        liveRows
          .map((post) => post.content)
          .filter((content) => content?.encrypted)
          .map((content) => content.keyVersion)
      ),
    ]

    const myWrappedByVersion = {}
    if (vault.identity && distinctVersions.length > 0) {
      await Promise.all(
        distinctVersions.map(async (version) => {
          try {
            const wrapped = await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'wrappedKeys',
              args: [id, address, BigInt(version)],
            })
            if (wrapped && wrapped !== '0x') myWrappedByVersion[version] = wrapped
          } catch (err) {
            // No access to this version — post(s) under it will render as locked below
          }
        })
      )
    }

    // Raw content keys per version: direct envelopes first, then backward key-chain walking
    // for versions with no envelope (history visibility). Starting from the newest version
    // the viewer holds, each keyBacklinks[v] blob decrypts version v-1's key — so a member
    // granted only the current key can still open pre-join epochs when the community chose
    // to publish the links. A missing link simply leaves older versions locked.
    const rawKeyByVersion = {}
    for (const [version, wrapped] of Object.entries(myWrappedByVersion)) {
      try {
        rawKeyByVersion[version] = unwrapContentKey(wrapped, vault.identity.privKeyHex)
      } catch (err) {
        // Envelope not openable with this identity (e.g. pre-PIN-change) — skip
      }
    }
    const missingVersions = distinctVersions.filter((v) => !rawKeyByVersion[v])
    if (missingVersions.length > 0 && Object.keys(rawKeyByVersion).length > 0) {
      const lowestNeeded = Math.min(...missingVersions)
      let walkVersion = Math.max(...Object.keys(rawKeyByVersion).map(Number))
      while (walkVersion > lowestNeeded && rawKeyByVersion[walkVersion]) {
        try {
          const backlink = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: HupCommunityABI,
            functionName: 'keyBacklinks',
            args: [id, BigInt(walkVersion)],
          })
          if (!backlink || backlink === '0x') break
          rawKeyByVersion[walkVersion - 1] = await unwrapKeyWithKey(backlink, rawKeyByVersion[walkVersion])
          walkVersion--
        } catch (err) {
          break
        }
      }
    }

    // Keep each row in Post.jsx's own shape (id, wallet_address, created_at, content, ...) so it
    // can be handed straight to <PostCard> — only content is touched, and only to decrypt it in
    // place. Undecryptable posts are left with their raw {encrypted:true,...} envelope, which
    // Post.jsx already renders as a locked placeholder on its own.
    const decryptedPosts = await Promise.all(
      liveRows.map(async (post) => {
        const postContent = post.content
        if (!postContent || typeof postContent !== 'object' || !postContent.encrypted) return post

        const rawContentKey = rawKeyByVersion[postContent.keyVersion]
        if (!vault.identity || !rawContentKey) return post

        try {
          const decrypted = await decryptPostContent(rawContentKey, postContent.iv, postContent.ciphertext)
          return { ...post, content: decrypted }
        } catch (err) {
          return post
        }
      })
    )

    return decryptedPosts
  }

  // Live scroll position and feed height: reading them in the unmount cleanup is too late, since
  // Next may already have reset scroll for the incoming route by then.
  const lastFeedScrollYRef = useRef(0)
  const feedListRef = useRef(null)
  const lastFeedHeightRef = useRef(initialFeedCache?.feedHeight ?? 0)
  // Consumed once the restored posts have rendered.
  const pendingFeedScrollRef = useRef(initialFeedCache ? (initialFeedCache.scrollY ?? 0) : null)
  // Height held on the list while restoring: media hasn't loaded on the first frames, so without
  // it the document is too short for the scroll target and the browser clamps the jump.
  const [reservedFeedHeight, setReservedFeedHeight] = useState(initialFeedCache?.feedHeight ?? null)
  const feedSnapshotRef = useRef(null)

  // Snapshot the cacheable state every render, for the save-on-exit cleanup below.
  useEffect(() => {
    if (!hideHeader) return
    feedSnapshotRef.current = { list: communityPosts, page: feedPage, hasMore: hasMoreFeed, address: address ?? null }
    lastFeedHeightRef.current = feedListRef.current?.offsetHeight || lastFeedHeightRef.current
  })

  useEffect(() => {
    if (!hideHeader) return
    const handleScroll = () => {
      lastFeedScrollYRef.current = document.documentElement.scrollTop
      // Media loads change the height without a re-render, so re-measure here too.
      lastFeedHeightRef.current = feedListRef.current?.offsetHeight || lastFeedHeightRef.current
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [hideHeader])

  // Save on the way out — opening a post is what unmounts this page.
  useEffect(() => {
    if (!hideHeader) return
    return () => {
      const snapshot = feedSnapshotRef.current
      if (!snapshot || snapshot.list.length === 0) return
      saveFeedCache(feedCacheKey, { ...snapshot, scrollY: lastFeedScrollYRef.current, feedHeight: lastFeedHeightRef.current || null })
    }
  }, [hideHeader, feedCacheKey, saveFeedCache])

  // Restore the cached position once the hydrated posts have rendered. Reaching the target once
  // isn't enough to stop: Next's layout router scrolls the new segment to top AFTER this effect,
  // and media loads can still clamp the position — so keep re-asserting until the target survives
  // two consecutive frames. rAF callbacks run before the pending paint, so a reset that lands
  // pre-paint is corrected pre-paint and never shows.
  useLayoutEffect(() => {
    const target = pendingFeedScrollRef.current
    if (target === null || communityPosts.length === 0) return

    const deadline = performance.now() + 1500
    let frame = 0
    let stableFrames = 0
    const apply = () => {
      if (Math.abs(window.scrollY - target) < 2) {
        stableFrames += 1
      } else {
        stableFrames = 0
        // 'instant' overrides the app's global scroll-behavior: smooth — a plain scrollTo animates
        // the restore, which IS the visible top-to-position crawl.
        window.scrollTo({ top: target, behavior: 'instant' })
      }
      if (stableFrames >= 2 || performance.now() > deadline) {
        pendingFeedScrollRef.current = null
        setReservedFeedHeight(null)
        return
      }
      frame = requestAnimationFrame(apply)
    }
    apply()

    return () => cancelAnimationFrame(frame)
  }, [communityPosts])

  // Everything the loaded feed depends on, in one string. Unlocking the vault is in there because
  // decryption changes what the same rows render as, and feedRefreshKey because the composer bumps
  // it to force a reload.
  const feedParams = `${address ?? null}|${chainId}|${id}|${feedRefreshKey}|${vault.identity ? 1 : 0}`
  // Seeded on a cache hit so the mount fetch is skipped entirely; set when data is applied (not
  // when the fetch starts) so it stays correct under StrictMode's double-run.
  const appliedFeedParamsRef = useRef(initialFeedCache ? feedParams : null)

  // Initial load / refresh (page 1) — infinite scrolling appends further pages below
  useEffect(() => {
    const params = feedParams
    const fetchCommunityFeed = async () => {
      // The grid/directory view doesn't show a per-card feed (see hideHeader-gated render below) —
      // skip the fetch entirely there so browsing the directory doesn't fire one feed request per
      // visible card
      if (!chainId || !hideHeader) return
      // Already applied — hydrated from the session cache, so no page-1 refetch behind a shimmer
      if (appliedFeedParamsRef.current === params) return
      setIsFeedLoading(true)
      try {
        const response = await getPosts(1, FEED_PAGE_SIZE, chainId, null, address, id)
        const rows = response?.success ? response.data : []
        const decrypted = await decryptFeedRows(rows.filter((post) => !post.is_deleted))

        setCommunityPosts(decrypted)
        setFeedPage(1)
        setHasMoreFeed(Boolean(response?.meta?.hasMore))
        appliedFeedParamsRef.current = params
      } catch (err) {
        console.error('Failed to load community feed from cidex:', err)
      } finally {
        setIsFeedLoading(false)
      }
    }

    fetchCommunityFeed()
    // feedParams folds together every value this fetch reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedParams, hideHeader])

  // Loads the next page and appends — same shape as the home feed's scroll pagination
  const loadMoreFeed = async () => {
    if (isFeedLoading || isFeedLoadingMore || !hasMoreFeed || !chainId) return
    setIsFeedLoadingMore(true)
    try {
      const nextPage = feedPage + 1
      const response = await getPosts(nextPage, FEED_PAGE_SIZE, chainId, null, address, id)
      const rows = response?.success ? response.data : []
      const decrypted = await decryptFeedRows(rows.filter((post) => !post.is_deleted))

      setCommunityPosts((prev) => {
        const seen = new Set(prev.map((post) => post.id))
        return [...prev, ...decrypted.filter((post) => !seen.has(post.id))]
      })
      setFeedPage(nextPage)
      setHasMoreFeed(Boolean(response?.meta?.hasMore))
    } catch (err) {
      console.error('Failed to load more community posts:', err)
    } finally {
      setIsFeedLoadingMore(false)
    }
  }

  // Sentinel observer for the community feed — kept in a ref so the observer callback always
  // calls the latest closure (feedPage/hasMoreFeed) without re-attaching per render
  const feedSentinelRef = useRef(null)
  const loadMoreFeedRef = useRef(loadMoreFeed)
  loadMoreFeedRef.current = loadMoreFeed
  useEffect(() => {
    if (!hideHeader) return
    const el = feedSentinelRef.current
    if (!el) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMoreFeedRef.current()
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hideHeader, communityPosts.length])

  // Community metadata is stored on-chain as an IPFS CID only (matching how posts store just a
  // CID), not raw JSON. Only the cards that read communities() themselves need to resolve it —
  // cidex already fetched the same document and stores it on the row, so re-fetching it per card
  // was a gateway round trip for a copy the page had in hand. Declared before the early-return
  // below so this hook always runs unconditionally like the others.
  useEffect(() => {
    if (!data) return
    let cancelled = false
    const cid = data[5]

    const resolve = async () => {
      let resolved = null
      if (cid) {
        const result = await getIPFS(cid.replace('ipfs://', '').replace('://', ''))
        if (result && result.result !== false) resolved = result
      }
      if (cancelled) return
      // The gateway answer is the freshest copy, so it always wins. A failed re-resolve keeps the
      // last one that worked; with nothing at all, the derivation above falls through to the
      // indexed row, and only then to the placeholder.
      setGatewayMetadata((current) => ({ value: resolved ?? current?.value ?? null }))
    }
    resolve()

    return () => {
      cancelled = true
    }
  }, [data, id])

  // A seeded card is never in a loading state, on either surface: it has the row, and the row has
  // everything it renders. The detail page still reads the chain, but it does so behind an
  // already-painted card — every derived value above prefers the live answer once it lands.
  // Only a card given neither a row nor a chain answer has nothing to show yet.
  if (!metadata || (!data && !row)) {
    return (
      <div className={clsx(styles.card, styles.cardSkeleton)} aria-busy="true" aria-label={`Loading space #${id}`}>
        <div className={styles.cardSkeleton__cover} />
        <div className={styles.cardSkeleton__header}>
          <div className={styles.cardSkeleton__logo} />
          <div className={styles.cardSkeleton__titleGroup}>
            <div className={clsx(styles.cardSkeleton__line, styles['cardSkeleton__line--title'])} />
            <div className={clsx(styles.cardSkeleton__line, styles['cardSkeleton__line--sub'])} />
          </div>
        </div>
        <div className={clsx(styles.cardSkeleton__line, styles['cardSkeleton__line--summary'])} />
        <div className={styles.cardSkeleton__tags}>
          <div className={styles.cardSkeleton__pill} />
          <div className={styles.cardSkeleton__pill} />
          <div className={styles.cardSkeleton__pill} />
        </div>
      </div>
    )
  }

  const admissionLabel = ADMISSION_OPTIONS[admission]?.tag || ADMISSION_OPTIONS[admission]?.label || '—'
  const typeLabels = ['Discussion', 'Broadcast']

  // The editor seeds from the contract, never from the indexed row. Everything this form touches
  // is written straight back onchain, and setRequirements replaces the whole array — seeding from
  // an index that is one block behind would let a save silently revert a change someone else just
  // made. The reads are cheap here because they happen once, on opening the dialog, rather than
  // once per card on a directory page.
  //
  // Every amount in the editor is a whole-unit string too, so seeding also means scaling the raw
  // onchain integers back by their asset's decimals. When any of it fails the editor stays shut
  // rather than opening with values that would be written back wrong.
  const handleStartEditing = async () => {
    setHasInteracted(true)
    let seededRequirements
    let seededPaymentPrice
    let seededMode
    let seededPaymentToken
    let seededPaymentIsLsp7
    let seededPayoutDestination
    try {
      const readGating = (functionName) =>
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: HupCommunityABI, functionName, args: [id] })

      const [liveRequirements, liveMode, livePayment, livePayout] = await Promise.all([
        readGating('getRequirements'),
        readGating('requirementMode'),
        readGating('paymentRequirements'),
        // Reverts on pre-payout deployments, which simply means fees go to the creator
        readGating('payoutDestination').catch(() => null),
      ])

      seededRequirements = await Promise.all(
        (liveRequirements ?? []).map(async (requirement) => {
          const rType = Number(requirement.rType)
          const raw = requirement.minBalance ?? 0n
          return {
            // NativeBalance opens as a blank-asset "Token or coin balance" row — the form has one
            // choice for both, and toOnchainRequirement maps it back on save
            rType: toUiRequirementType(rType),
            asset: requirement.asset === ZERO_ADDRESS ? '' : requirement.asset,
            minBalance:
              rType === REQUIREMENT_TYPE.NativeBalance || rType === REQUIREMENT_TYPE.TokenBalance
                ? toAmountInput(raw, await fetchTokenDecimals(publicClient, chainId, requirement.asset))
                : raw.toString(),
          }
        })
      )
      seededMode = Number(liveMode ?? 0)
      editSeedRef.current = {
        requirements: (liveRequirements ?? []).map((requirement) => [
          Number(requirement.rType),
          String(requirement.asset).toLowerCase(),
          requirement.minBalance?.toString(),
        ]),
        mode: seededMode,
      }

      const liveToken = livePayment?.[0] ?? null
      const livePrice = livePayment?.[1]?.toString() ?? null
      seededPaymentToken = isNativeAsset(liveToken) ? '' : liveToken
      seededPaymentIsLsp7 = Boolean(livePayment?.[2])
      seededPaymentPrice =
        livePrice && livePrice !== '0' ? toAmountInput(livePrice, await fetchTokenDecimals(publicClient, chainId, liveToken)) : ''
      seededPayoutDestination = livePayout && livePayout !== ZERO_ADDRESS ? livePayout : null
    } catch (err) {
      console.error('Failed to read this community’s current settings from the contract:', err)
      alert('Could not load this community’s settings right now. Please try again in a moment.')
      return
    }

    setEditName(metadata.name || '')
    setEditTag(metadata.tag || '')
    // Off-list or missing slugs (communities created before categories existed) open as "Other"
    setEditCategory(normalizeCommunityCategory(metadata.category, categories))
    setEditSummary(metadata.summary || '')
    setEditDescription(metadata.description || '')
    setEditLogoUrl(metadata['logo url'] || '')
    setEditCoverUrl(metadata['cover url'] || '')
    // Splits the stored array back into the dedicated social fields plus a free-form remainder,
    // so a save round-trips links this form has no dedicated input for
    const { socials: storedSocials, extra: storedExtraLinks } = parseLinks(metadata.links ?? [])
    setEditSocials(storedSocials)
    setEditExtraLinks(storedExtraLinks)
    setEditAdmission(admission)
    setEditCommunityType(cType)
    setEditRequirements(seededRequirements)
    setEditRequirementMode(seededMode)
    setPaymentTokenAddress(seededPaymentToken)
    setPaymentPrice(seededPaymentPrice)
    setPaymentIsLsp7(seededPaymentIsLsp7)
    setEditPayoutDestination(
      seededPayoutDestination
        ? { input: seededPayoutDestination, address: seededPayoutDestination, profile: null }
        : EMPTY_RECIPIENT
    )
    setIsEditing(true)
    setIsPosting(false)
    setIsManagingMembers(false)
  }

  const handleStartPosting = () => {
    setIsPosting(true)
    setIsEditing(false)
    setIsManagingMembers(false)
  }

  const handleUpdateSubmit = async (e) => {
    e.preventDefault()

    // The destination validates before anything uploads or signs, for the same reason the
    // decimal conversions below do: unresolved input must abort the whole save, not surface
    // after the metadata is already replaced.
    if (editAdmission === ADMISSION.PayToJoin) {
      if (editPayoutDestination.input.trim() && !editPayoutDestination.address) {
        alert('Fee destination: pick a wallet from the suggestions or paste a full address — or clear the field to keep fees yourself.')
        return
      }
    }

    // Amounts convert first, before anything is uploaded or signed: every one of them is entered
    // in whole units of the asset it gates on, so each needs that asset's decimals, and a failed
    // read here must abort the whole save rather than leave the metadata already updated.
    let editedTuples
    let priceValue
    // The stored standard drives join()'s transfer path, so it is read from the token rather than
    // trusted to the form — the checkbox only exists on LUKSO, and an LSP7 on any other chain
    // would otherwise be saved as an ERC-20 and leave every paid join reverting.
    let priceIsLsp7 = paymentIsLsp7
    try {
      editedTuples = await Promise.all(
        editRequirements.map(async (row) => {
          // A blank-asset token row is the contract's NativeBalance type; fetchTokenDecimals
          // resolves that blank to the coin's decimals. NFT minimums are plain counts.
          const { rType, asset } = toOnchainRequirement(row)
          return {
            rType,
            asset,
            minBalance:
              rType === REQUIREMENT_TYPE.NativeBalance || rType === REQUIREMENT_TYPE.TokenBalance
                ? parseUnits(row.minBalance || '0', await fetchTokenDecimals(publicClient, chainId, asset))
                : BigInt(row.minBalance || '0'),
          }
        })
      )
      if (editAdmission === ADMISSION.PayToJoin && paymentPrice) {
        priceValue = paymentTokenAddress
          ? parseUnits(paymentPrice, await fetchTokenDecimals(publicClient, chainId, paymentTokenAddress))
          : parseEther(paymentPrice)
        if (paymentTokenAddress) priceIsLsp7 = priceIsLsp7 || (await fetchIsLsp7(publicClient, chainId, paymentTokenAddress))
      }
    } catch (err) {
      console.error('Failed to convert the entered amounts to their onchain units:', err)
      alert('Could not read the decimals of one of the tokens you entered. Check the address and try again.')
      return
    }

    // Same omit-when-empty rule the create modal uses: clearing every field drops the key
    // rather than writing an empty array
    const updatedLinks = buildLinks(editSocials, editExtraLinks)

    // The stamp on an edit names whoever saved this revision, not the original creator — the
    // creator is already onchain, and a document says who wrote the words it actually carries.
    const updatedMetadataObj = withAuthor({
      name: editName,
      // Dropped from the JSON when cleared rather than written empty: cidex reads a missing tag
      // as "this community grants no badge", and clearing it takes the pill off every member.
      ...(editTag.trim() ? { tag: editTag.trim() } : {}),
      category: editCategory,
      summary: editSummary,
      description: editDescription,
      'logo url': editLogoUrl,
      'cover url': editCoverUrl,
      ...(updatedLinks.length > 0 ? { links: updatedLinks } : {}),
    }, address)

    // Community metadata is stored on-chain as an IPFS CID only (MAX_METADATA_LENGTH enforces
    // this — a raw JSON blob would exceed it), matching how posts already store just a CID.
    let updatedMetadataCid
    try {
      updatedMetadataCid = await uploadPostContentToIPFS(updatedMetadataObj)
    } catch (err) {
      console.error('Failed to upload updated community metadata to IPFS:', err)
      alert('Failed to upload community metadata. Please try again.')
      return
    }

    // Execute standard community info update rule
    updateContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'updateCommunity',
      args: [id, editAdmission, editCommunityType, updatedMetadataCid],
    })

    // Replace the whole requirement list (creator-only setter) whenever the editor differs
    // from what's onchain — one tx swaps the entire configuration atomically
    const onchainKey = JSON.stringify(editSeedRef.current.requirements)
    const editedKey = JSON.stringify(editedTuples.map((r) => [r.rType, r.asset.toLowerCase(), r.minBalance.toString()]))
    const modeChanged = editRequirements.length > 1 && editSeedRef.current.mode !== editRequirementMode
    if (onchainKey !== editedKey || modeChanged) {
      updateRequirementsWrite({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setRequirements',
        args: [id, editedTuples, editRequirementMode],
      })
    }

    if (priceValue !== undefined) {
      updatePaymentRequirement({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setPaymentRequirement',
        args: [id, paymentTokenAddress || ZERO_ADDRESS, priceValue, priceIsLsp7],
      })
    }

    // Re-point the join-fee destination when the editor differs from what's onchain (empty
    // editor = zero address = back to the creator). Validated in the guard above, so the input
    // is either empty or fully resolved here.
    if (editAdmission === ADMISSION.PayToJoin) {
      const editedDestination = editPayoutDestination.address || null
      if ((editedDestination ?? '').toLowerCase() !== (payoutDestination ?? '').toLowerCase()) {
        updatePayoutDestination({
          address: CONTRACT_ADDRESS,
          chainId,
          abi: HupCommunityABI,
          functionName: 'setPayoutDestination',
          args: [id, editedDestination || ZERO_ADDRESS],
        })
      }
    }
  }

  const handleApprove = (memberAddress) => {
    setApprovingAddress(memberAddress)
    approveRequest({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'approveRequest',
      args: [id, memberAddress],
    })
  }

  const handleReject = (memberAddress) => {
    setRejectingAddress(memberAddress)
    rejectRequestWrite({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'rejectRequest',
      args: [id, memberAddress],
    })
  }

  const handleBan = (memberAddress) => {
    setBanningAddress(memberAddress)
    banMember({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setBanStatus',
      args: [id, memberAddress, true],
    })
  }

  const handleUnban = (memberAddress) => {
    setBanningAddress(memberAddress)
    unbanMember({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setBanStatus',
      args: [id, memberAddress, false],
    })
  }

  const handleSetGovernor = (e) => {
    e.preventDefault()
    if (!newGovernorAddress) return
    setGovernorWrite({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setGovernor',
      args: [id, newGovernorAddress],
    })
  }

  const handleClearGovernor = () => {
    setGovernorWrite({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setGovernor',
      args: [id, '0x0000000000000000000000000000000000000000'],
    })
  }

  const handleAddToWhitelist = (e) => {
    e.preventDefault()
    if (!newWhitelistAddress.address) return

    setWhitelistedContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setWhitelisted',
      args: [id, newWhitelistAddress.address, true],
    })
  }

  const handleRemoveFromWhitelist = (walletAddress) => {
    setRemovingWhitelistAddress(walletAddress)
    setWhitelistedContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setWhitelisted',
      args: [id, walletAddress, false],
    })
  }

  // Reuses the ban write hook so the confirmation effect fires either way — but the effect
  // branches on self-leave: a departing member can't rotate the key (moderator-only), so their
  // browser files a pending-rotation request for moderators instead of attempting the doomed tx.
  const handleLeave = () => {
    setHasInteracted(true)
    setBanningAddress(activeAccountAddress)
    banMember({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'leave',
      args: [id],
    })
  }

  // Manual rotation trigger for moderators (also how a pending self-leave rotation gets resolved).
  // The bump-confirmed effect above handles the rest: fresh key, batch-grant to moderators, clear
  // the pending-rotation flag.
  const handleRotateKey = () => {
    if (!vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }
    bumpKeyVersion({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'bumpKeyVersion',
      args: [id],
    })
  }

  const handleToggleHistoryVisibility = async () => {
    try {
      setIsTogglingHistory(true)
      await writeVaultAsync({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setHistoryVisibility',
        args: [id, !historyVisible],
      })
      refetchHistoryVisible()
    } catch (err) {
      console.error('Failed to update the history visibility policy:', err)
    } finally {
      setIsTogglingHistory(false)
    }
  }

  // Retroactive history: bridges epoch walls left by rotations that ran while the policy was off
  // (or before it existed). For each version missing its backlink, this moderator's own append-only
  // envelopes provide both the older and newer raw keys — so the link can be published after the
  // fact. One tx per missing link; versions whose envelopes this moderator lacks are skipped.
  const handleBackfillBacklinks = async () => {
    if (!vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }
    setIsBackfilling(true)
    try {
      const readBytes = (functionName, args) =>
        publicClient.readContract({ address: CONTRACT_ADDRESS, abi: HupCommunityABI, functionName, args })

      for (let version = 2; version <= keyVersion; version++) {
        const existing = await readBytes('keyBacklinks', [id, BigInt(version)])
        if (existing && existing !== '0x') continue

        const [olderEnvelope, newerEnvelope] = await Promise.all([
          readBytes('wrappedKeys', [id, activeAccountAddress, BigInt(version - 1)]),
          readBytes('wrappedKeys', [id, activeAccountAddress, BigInt(version)]),
        ])
        if (!olderEnvelope || olderEnvelope === '0x' || !newerEnvelope || newerEnvelope === '0x') continue

        const olderRaw = unwrapContentKey(olderEnvelope, vault.identity.privKeyHex)
        const newerRaw = unwrapContentKey(newerEnvelope, vault.identity.privKeyHex)
        const backlink = await wrapKeyWithKey(olderRaw, newerRaw)

        await writeVaultAsync({
          address: CONTRACT_ADDRESS,
          abi: HupCommunityABI,
          functionName: 'publishKeyBacklink',
          args: [id, BigInt(version), backlink],
        })
      }
    } catch (err) {
      console.error('Failed to backfill history key links:', err)
    } finally {
      setIsBackfilling(false)
    }
  }

  // Batch-clears the pending 'grant' key requests: verify each requester is still a member, wrap
  // the current master key to their registered pubkey, deliver up to MAX_BATCH_SIZE per tx via
  // grantKeyBatch, then drop the fulfilled rows.
  const handleGrantPendingKeys = async () => {
    if (!vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }
    if (!myWrappedKeyData || myWrappedKeyData === '0x') {
      alert("You don't hold the current key version yourself yet — rotate or ask another moderator to grant you first.")
      return
    }

    setIsGrantingBatch(true)
    try {
      const rawContentKey = unwrapContentKey(myWrappedKeyData, vault.identity.privKeyHex)

      const grantMembers = []
      const grantEnvelopes = []
      const skippedNoIdentity = []
      for (const req of pendingGrantRequests) {
        try {
          const [statusData, memberPubKey] = await Promise.all([
            publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'registry',
              args: [id, req.wallet_address],
            }),
            publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'communityIdentityKeys',
              args: [req.wallet_address],
            }),
          ])

          const isStillMember = Boolean(statusData?.[0]) && !statusData?.[3]
          if (!isStillMember) {
            // Stale request from someone who left/was banned since — drop it, never grant
            fetch(
              `/api/communities/key-requests?network_id=${chainId}&community_id=${id}&wallet_address=${req.wallet_address}&request_type=grant`,
              { method: 'DELETE' }
            ).catch(() => {})
            continue
          }
          if (!memberPubKey || memberPubKey === '0x') {
            // No mailbox: the member never registered an identity key on THIS contract (each
            // deployment starts a fresh registry). Leave the request pending, but tell the
            // moderator — silently skipping here made the button look broken.
            skippedNoIdentity.push(req.wallet_address)
            continue
          }

          grantMembers.push(req.wallet_address)
          grantEnvelopes.push(wrapContentKey(rawContentKey, memberPubKey))
        } catch (err) {
          console.error('Failed to prepare key envelope for', req.wallet_address, err)
        }
      }

      const BATCH_SIZE = 100 // mirrors the contract's MAX_BATCH_SIZE
      for (let i = 0; i < grantMembers.length; i += BATCH_SIZE) {
        const memberChunk = grantMembers.slice(i, i + BATCH_SIZE)
        const envelopeChunk = grantEnvelopes.slice(i, i + BATCH_SIZE)

        await writeVaultAsync({
          address: CONTRACT_ADDRESS,
          chainId,
          abi: HupCommunityABI,
          functionName: 'grantKeyBatch',
          args: [id, memberChunk, envelopeChunk],
        })

        await Promise.all(
          memberChunk.map((memberAddress) =>
            fetch(
              `/api/communities/key-requests?network_id=${chainId}&community_id=${id}&wallet_address=${memberAddress}&request_type=grant`,
              { method: 'DELETE' }
            ).catch(() => {})
          )
        )
      }

      setGrantSkippedAddresses(skippedNoIdentity)
      refetchKeyRequests()
    } catch (err) {
      console.error('Failed to grant pending keys:', err)
      alert(err.shortMessage || err.message || 'Failed to grant pending keys.')
    } finally {
      setIsGrantingBatch(false)
    }
  }

  const handleToggleStatus = () => {
    setHasInteracted(true)
    setStatusContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setCommunityStatus',
      args: [id, !isActive],
    })
  }

  // Extracted so the compact grid card and the standalone detail page's spacious header (which
  // skips the logo/title/summary/tags block below via hideHeader, since the page already shows
  // its own version of that) can both render the exact same action buttons without duplication.
  const actionButtons = (
    <>
      <button
        type="button"
        className={styles.card__postTriggerBtn}
        disabled={!isActive || (cType === 1 && !isModerator) || canPost === false}
        title={
          !isActive
            ? 'This space is archived — reactivate it to post'
            : cType === 1 && !isModerator
              ? 'This is a Broadcast channel — only the creator/moderators can post'
              : canPost === false
                ? 'Join this space to post'
                : undefined
        }
        onClick={handleStartPosting}
      >
        Write Post
      </button>
      {!isOwner && !isMember && admission === ADMISSION.Open && (
        <button type="button" className={styles.card__editBtn} disabled={!isActive || isJoinPending} onClick={handleJoin}>
          {isJoinPending ? 'Joining...' : 'Join'}
        </button>
      )}
      {!isOwner && !isMember && admission === ADMISSION.RequestApproval && !hasPendingRequest && (
        <button type="button" className={styles.card__editBtn} disabled={!isActive || isJoinPending} onClick={handleRequestAccess}>
          {isJoinPending ? 'Requesting...' : 'Request Access'}
        </button>
      )}
      {!isOwner && !isMember && admission === ADMISSION.RequestApproval && hasPendingRequest && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={isCancelRequestPending}
          title="Your request is waiting for a moderator — withdraw it here"
          onClick={handleCancelRequest}
        >
          {isCancelRequestPending ? 'Cancelling...' : 'Cancel Request'}
        </button>
      )}
      {!isOwner && !isMember && admission === ADMISSION.SelfServeIfEligible && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={!isActive || isJoinPending || amIEligible === false}
          title={amIEligible === false ? "Your wallet doesn't meet this community's requirements yet" : undefined}
          onClick={handleJoin}
        >
          {isJoinPending ? 'Joining...' : amIEligible === false ? 'Not Eligible' : 'Join'}
        </button>
      )}
      {!isOwner && !isMember && admission === ADMISSION.PayToJoin && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={!isActive || !hasValidPaymentRequirement || isPayToJoinPending || isPayToJoinConfirming}
          onClick={handlePayToJoin}
        >
          {isPayingToJoin && (isPayToJoinPending || isPayToJoinConfirming)
            ? 'Paying...'
            : !hasValidPaymentRequirement
              ? 'Price Not Set'
              : `Pay ${paymentPriceWithSymbol} & Join`}
        </button>
      )}
      {!isOwner && isMember && (
        <button
          type="button"
          className={styles.card__cancelBtn}
          disabled={isBanPending && banningAddress === activeAccountAddress}
          onClick={handleLeave}
        >
          {isBanPending && banningAddress === activeAccountAddress ? 'Leaving...' : 'Leave'}
        </button>
      )}
      {isModerator && (
        // Moderation surfaces are first-class icon buttons rather than a hidden menu:
        // Members opens the management modal, the gear opens community settings (Modify).
        <button
          type="button"
          className={styles.card__editBtn}
          aria-label="Members & moderation"
          title="Members & moderation"
          onClick={() => {
            setHasInteracted(true)
            refetchMembers()
            setIsManagingMembers(true)
            setIsEditing(false)
            setIsPosting(false)
          }}
        >
          <UsersIcon size={16} />
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          className={styles.card__editBtn}
          aria-label="Community settings"
          title="Community settings"
          onClick={handleStartEditing}
        >
          <GearSixIcon size={16} />
        </button>
      )}
    </>
  )

  // Requirement chips shared by the directory card's header tags and the detail page's
  // labeled requirements row — one fragment so the two surfaces can't drift. NftTag resolves
  // collection names; the ALL/ANY chip only matters once there's more than one entry.
  const hasJoinPrice = admission === ADMISSION.PayToJoin && hasValidPaymentRequirement
  const requirementChips = (
    <>
      {requirementsList.length > 1 && (
        <span className={styles.card__tag} title="How the requirements below combine">
          {requirementMode === 1 ? 'ANY of' : 'ALL of'}
        </span>
      )}
      {requirementsList.map((req, index) => {
        const rType = Number(req.rType)
        if (rType === REQUIREMENT_TYPE.NftBalance)
          return (
            <NftTag
              key={index}
              tokenAddress={req.asset}
              chainId={chainId}
              minBalance={req.minBalance?.toString()}
              // Only the indexed shape carries these; a live-read requirement leaves them
              // undefined and the chip resolves the asset itself, exactly as before
              resolvedName={req.assetName}
            />
          )
        if (rType === REQUIREMENT_TYPE.TokenBalance)
          return (
            <TokenRequirementTag
              key={index}
              address={req.asset}
              chainId={chainId}
              minBalance={req.minBalance}
              className={styles.card__tag}
              resolvedMeta={req.assetDecimals === undefined ? null : { symbol: req.assetSymbol, decimals: req.assetDecimals }}
            />
          )
        if (rType === REQUIREMENT_TYPE.NativeBalance)
          return (
            <span key={index} className={styles.card__tag}>
              min {formatEther(req.minBalance ?? 0n)} {nativeCurrency.symbol}
            </span>
          )
        if (rType === REQUIREMENT_TYPE.Whitelisted)
          return (
            <span key={index} className={styles.card__tag}>
              Whitelist
            </span>
          )
        return (
          <span key={index} className={styles.card__tag}>
            Follows creator
          </span>
        )
      })}
      {hasJoinPrice && (
        <span className={styles.card__tag} title={isPaymentNative ? undefined : `Contract: ${savedPaymentToken}`}>
          💰 {paymentPriceWithSymbol} to join
        </span>
      )}
      {hasJoinPrice && payoutDestination && (
        <span className={styles.card__tag} title={`All join fees go to ${payoutDestination}`}>
          Fees go to {`${payoutDestination.slice(0, 6)}…${payoutDestination.slice(-4)}`}
        </span>
      )}
    </>
  )

  // Website + socials the creator saved in the metadata's links array. The detail page renders
  // its own copy from the indexed row (CommunityDetails), so this only shows on the directory
  // card — hideHeader skips the whole header block it belongs to.
  const communityLinks = displayLinks(metadata.links)

  // Modify and Manage Members open as NativeDialog modals (CardDialog below) rather than
  // expanding the card inline, so the card itself never stretches the directory grid
  return (
    <div className={hideHeader ? undefined : styles.card}>
      <>
          {hideHeader ? (
            <>
              {/* The detail page's own header (indexed data) has no requirement info, so the
                  gating chips get their own labeled row here — a visitor should see what a
                  "Not Eligible" join button is actually asking for */}
              {(requirementsList.length > 0 || hasJoinPrice) && (
                <div className={styles.card__requirements}>
                  <span
                    className={styles.card__requirementsLabel}
                    title={
                      admission === ADMISSION.SelfServeIfEligible
                        ? 'Checked automatically when you join — meet them and you’re in instantly'
                        : 'You need to meet these to take part here'
                    }
                  >
                    Requirements
                  </span>
                  <div className={styles.card__tags}>{requirementChips}</div>
                </div>
              )}
              <div className={styles.card__actionRow} style={{ marginBottom: '1.25rem' }}>
                {actionButtons}
              </div>
            </>
          ) : (
            <>
              <Link href={`/communities/${chainId}/${id}`} className={styles.card__link}>
                {metadata['cover url'] ? (
                  <img src={resolveStorageImageUrl(metadata['cover url'], { width: 800 }) || metadata['cover url']} alt="" className={styles.card__cover} />
                ) : (
                  <div className={styles.card__cover} aria-hidden="true" />
                )}
                <div className={styles.card__header}>
                  {metadata['logo url'] ? (
                    <img
                      src={resolveStorageImageUrl(metadata['logo url'], { width: 200 }) || metadata['logo url']}
                      alt={metadata.name}
                      className={styles.card__logo}
                    />
                  ) : (
                    <div className={clsx(styles.card__logo, styles['card__logo--placeholder'])} aria-hidden="true">
                      {(metadata.name || `#${id}`).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={styles.card__titleGroup}>
                    {/* Clamped to two lines in the stylesheet — the title attribute carries the
                        full name on hover, and the community page shows it in full */}
                    <h3 className={styles.card__title} title={metadata.name || undefined}>
                      {metadata.name || `Community #${id}`}
                    </h3>
                    {/* Not a <Link>: the whole card header is already wrapped in one, and
                        anchors can't nest — route imperatively instead */}
                    <span
                      className={styles.card__creator}
                      role="link"
                      tabIndex={0}
                      title="View creator profile"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        router.push(`/${creator}`)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          e.stopPropagation()
                          router.push(`/${creator}`)
                        }
                      }}
                    >
                      By <CreatorName address={creator} />
                    </span>
                  </div>
                </div>

                <p className={styles.card__summary}>{metadata.summary || metadata.description}</p>

                <div className={styles.card__tags} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  {/* Unknown/missing slugs render as "Other" — see config/communityCategories.js */}
                  <span className={styles.card__tag} title="Category">
                    {getCommunityCategory(metadata.category, categories).label}
                  </span>
                  <span className={styles.card__tag}>{admissionLabel}</span>
                  <span className={styles.card__tag}>{typeLabels[cType]}</span>
                  {/* Indexed member count, passed down from the directory's API rows (the card
                      itself never queries it — the on-chain getters are moderator-gated) */}
                  {memberCount !== null && (
                    <span className={styles.card__tag}>
                      {new Intl.NumberFormat(undefined, { notation: 'compact' }).format(memberCount)}{' '}
                      {Number(memberCount) === 1 ? 'member' : 'members'}
                    </span>
                  )}
                  {!isActive && (
                    <span className={styles.card__tag} title="This space is archived — no new posts or joins until reactivated">
                      Archived
                    </span>
                  )}
                  {isEncryptionInitialized && (
                    <span className={styles.card__tag} title="Post content is end-to-end encrypted for members">
                      🔒 Encrypted
                    </span>
                  )}
                  {governor && (
                    <span className={styles.card__tag} title={`Governed by ${governor} — creator-level powers are held by a governance contract`}>
                      🏛 DAO
                    </span>
                  )}

                  {requirementChips}
                </div>
              </Link>

              {/* Outside the header <Link> on purpose — anchors can't nest, and each of these
                  navigates off-app rather than into the community */}
              {communityLinks.length > 0 && (
                <div className={styles.card__links}>
                  {communityLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link.url}
                      className={styles.card__linkChip}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {link.title}
                    </a>
                  ))}
                </div>
              )}

              <div className={styles.card__actionRow}>{actionButtons}</div>
            </>
          )}

          {/* Member of an encrypted community without a working key mailbox (locked vault or
              unregistered identity): tell THEM directly — moderators can't deliver a key to a
              wallet with no registered public key, and shouldn't have to chase members 1:1.
              VaultUnlockPrompt renders the right action for whichever half is missing. */}
          {isMember && isEncryptionInitialized && (!vault.identity || vault.needsRegistration) && <VaultUnlockPrompt vault={vault} />}

          {/* Two-step invite, invitee side: a moderator invited this wallet, but membership is a
              public onchain signal — it only happens if the viewer accepts here themselves */}
          {hasInvite && !isMember && (
            <div className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')} style={{ marginTop: '1rem' }}>
              <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>You're invited to this community</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem' }}>
                A moderator invited you. Nothing happens unless you accept — declining removes the invite.
              </p>
              <div className="flex align-items-center gap-050">
                <button
                  type="button"
                  className={styles.card__submit}
                  style={{ width: 'auto', padding: '0.5rem 1.1rem' }}
                  disabled={isInviteRespPending}
                  onClick={() => {
                    setHasInteracted(true)
                    respondInvite({
                      address: CONTRACT_ADDRESS,
                      chainId,
                      abi: HupCommunityABI,
                      functionName: 'acceptInvite',
                      args: [id],
                    })
                  }}
                >
                  {isInviteRespPending ? 'Confirm Wallet...' : 'Accept & Join'}
                </button>
                <button
                  type="button"
                  className={styles.card__cancelBtn}
                  disabled={isInviteRespPending}
                  onClick={() => {
                    setHasInteracted(true)
                    respondInvite({
                      address: CONTRACT_ADDRESS,
                      chainId,
                      abi: HupCommunityABI,
                      functionName: 'declineInvite',
                      args: [id],
                    })
                  }}
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Sub-Feed Component Layer — detail page (hideHeader) only; the directory grid doesn't need it */}
          {hideHeader && (
            <div className={styles.feed}>
              <h4 className={styles.feed__title}>Recent Updates</h4>
              {isFeedLoading ? (
                <div className={styles.feed__loading}>Syncing feed events...</div>
              ) : communityPosts.length === 0 ? (
                <div className={styles.feed__empty}>No posts published in this space yet.</div>
              ) : (
                // minHeight holds the document tall enough for a restore to land in one jump while
                // the media in the restored posts is still loading; it's released once the scroll
                // position sticks.
                <div
                  className={styles.feed__list}
                  ref={feedListRef}
                  style={reservedFeedHeight ? { minHeight: `${reservedFeedHeight}px` } : undefined}
                >
                  {communityPosts.map((post, i) => (
                    // Same open-on-click affordance as the home/trending feeds: the row
                    // navigates to the post's thread view (text selection doesn't trigger it)
                    <div
                      key={post.id}
                      // A restored feed must repaint identically in place — no entrance replay
                      className={clsx('pointer', !initialFeedCache && ['animate', 'fade'])}
                      onPointerDown={rememberCardPointerDown}
                      onMouseEnter={() => router.prefetch(`/networks/${post.network_id ?? chainId}/${post.id}`)}
                      onTouchStart={() => router.prefetch(`/networks/${post.network_id ?? chainId}/${post.id}`)}
                      onClick={(e) => {
                        if (isTextSelectionDrag(e)) return
                        // Hand the row to the post store first, exactly as the home feed does: the
                        // detail page paints that copy immediately instead of shimmering while its
                        // own fetch runs
                        setCurrentPost(post)
                        router.push(`/networks/${post.network_id ?? chainId}/${post.id}`)
                      }}
                    >
                      <PostCard item={post} chainId={chainId} actions={['like', 'comment', 'share', 'repost', 'tip', 'view', 'bookmark']} />
                      {i < communityPosts.length - 1 && <hr />}
                    </div>
                  ))}
                  {/* Infinite scroll: observed sentinel pulls the next page into view */}
                  <div ref={feedSentinelRef} aria-hidden="true" />
                  {isFeedLoadingMore && <div className={styles.feed__empty}>Loading more posts...</div>}
                </div>
              )}
            </div>
          )}
      </>

      <CardDialog
        open={isManagingMembers}
        onClose={() => setIsManagingMembers(false)}
        className={styles.cardDialog}
        label={`Manage members of ${metadata.name || `Space #${id}`}`}
      >
        <DialogHeader
          title={`Manage members — ${metadata.name || `Space #${id}`}`}
          cancelLabel="Close"
          compact
          onCancel={() => setIsManagingMembers(false)}
        />
        <div className={clsx(styles.cardDialog__body, styles.card__form)}>

          {/* The member roster itself — previously this panel only held the type-specific
              sections (encryption/whitelist/requests), so for e.g. a Public community it
              rendered completely empty despite being titled "Manage Members" */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h5 style={{ fontSize: '0.95rem' }}>
              Members{members.length > 0 ? ` (${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(members.length)})` : ''}
            </h5>
            {/* Two-step invite — the join path for Private (invite-only) communities. The invite
                grants nothing by itself: the wallet must accept it from the community card, so
                nobody can be conscripted onto a public roster. For encrypted communities the key
                envelope is delivered after acceptance via the lazy grant-request queue below. */}
            <form
              className="flex align-items-center gap-050"
              style={{ margin: '0.5rem 0 0.75rem' }}
              onSubmit={(e) => {
                e.preventDefault()
                if (!inviteAddress.address) return
                inviteMemberWrite({
                  address: CONTRACT_ADDRESS,
                  chainId,
                  abi: HupCommunityABI,
                  functionName: 'inviteMember',
                  args: [id, inviteAddress.address],
                })
              }}
            >
              <RecipientField
                className={styles.card__recipient}
                label={null}
                inputClassName={styles.card__input}
                value={inviteAddress}
                onChange={setInviteAddress}
                viewer={address ?? null}
                placeholder="Name, ENS, or 0x… wallet to invite"
              />
              <button
                type="submit"
                className={styles.card__submit}
                style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                disabled={!inviteAddress.address || isInvitePending}
              >
                {isInvitePending ? 'Confirm Wallet...' : 'Invite'}
              </button>
            </form>
            {isInviteConfirmed && (
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                ✓ Invite sent — they become a member once they accept it from this community's card.
              </p>
            )}
            {members.length === 0 ? (
              <p className={styles.feed__empty}>No members found yet.</p>
            ) : (
              members.map((member) => (
                <div key={member.address} className="flex justify-content-between align-items-center gap-050" style={{ padding: '0.5rem 0' }}>
                  <div className="flex align-items-center gap-050">
                    <Profile creator={member.address} networkId={chainId} variant="fullWithoutTime" />
                    {member.address.toLowerCase() === creator.toLowerCase() && <span className={styles.card__tag}>Creator</span>}
                  </div>
                  {member.address.toLowerCase() !== creator.toLowerCase() && (
                    <button
                      type="button"
                      className={styles.card__cancelBtn}
                      disabled={isBanPending && banningAddress === member.address}
                      onClick={() => handleBan(member.address)}
                    >
                      {isBanPending && banningAddress === member.address ? 'Banning...' : 'Ban'}
                    </button>
                  )}
                </div>
              ))
            )}

            {/* Banned wallets live outside the member roster (a ban is a kick plus a flag), so
                they are read from the contract's own banned list — unbanning only lifts the
                flag; the wallet rejoins through the community's admission mode. */}
            {bannedMembers.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h5 style={{ fontSize: '0.95rem' }}>Banned</h5>
                {bannedMembers.map((address) => (
                  <div key={address} className="flex justify-content-between align-items-center gap-050" style={{ padding: '0.5rem 0' }}>
                    <div className="flex align-items-center gap-050">
                      <Profile creator={address} networkId={chainId} variant="fullWithoutTime" />
                      <span className={styles.card__tag}>Banned</span>
                    </div>
                    <button
                      type="button"
                      className={styles.card__editBtn}
                      disabled={isUnbanPending && banningAddress === address}
                      onClick={() => handleUnban(address)}
                    >
                      {isUnbanPending && banningAddress === address ? 'Unbanning...' : 'Unban'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DAO governance: point creator-level authority at a governance executor. UI writes
              are creator-only in practice (a governor is a contract executing by proposal). */}
          {isOwner && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Governance</h5>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0.75rem' }}>
                Hand this community's controls to a governance contract (a Governor timelock or Safe) to run it as a DAO — it gains
                creator-level powers alongside you. For a full handover, transfer the creator role to it afterwards.
              </p>
              {governor ? (
                <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                  <span style={{ fontSize: '0.8rem', fontFamily: 'monospace' }} title={governor}>
                    🏛 {governor.slice(0, 8)}...{governor.slice(-6)}
                  </span>
                  <button
                    type="button"
                    className={styles.card__cancelBtn}
                    disabled={isGovernorPending || isGovernorConfirming}
                    onClick={handleClearGovernor}
                  >
                    {isGovernorPending ? 'Confirm Wallet...' : isGovernorConfirming ? 'Removing...' : 'Remove Governor'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSetGovernor} className="flex align-items-center gap-050">
                  <input
                    className={styles.card__input}
                    placeholder="0x... governance contract"
                    value={newGovernorAddress}
                    onChange={(e) => setNewGovernorAddress(e.target.value)}
                  />
                  <button
                    type="submit"
                    className={styles.card__submit}
                    style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                    disabled={isGovernorPending || isGovernorConfirming || !newGovernorAddress}
                  >
                    {isGovernorPending ? 'Confirm Wallet...' : isGovernorConfirming ? 'Setting...' : 'Set Governor'}
                  </button>
                </form>
              )}
            </div>
          )}

          {isModerator && isEncryptionInitialized && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Encryption Key</h5>

              {isRotationPending && (
                <div className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')} style={{ marginBottom: '0.75rem' }}>
                  ⚠️ A member left this community. Rotate the key so they can't read new posts.
                </div>
              )}

              <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Current key version: {keyVersion}</span>
                <button
                  type="button"
                  className={styles.card__editBtn}
                  disabled={isBumpPending || isBumpConfirming}
                  onClick={handleRotateKey}
                >
                  {isBumpPending ? 'Confirm Wallet...' : isBumpConfirming ? 'Rotating...' : 'Rotate Key'}
                </button>
              </div>

              <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                  title="When on, key rotations publish a backward link so members joining later can still read older posts. When off, each rotation is a wall: new members only read posts from their join epoch onward."
                >
                  New members can read history: <strong>{historyVisible ? 'Yes' : 'No'}</strong>
                </span>
                <button type="button" className={styles.card__editBtn} disabled={isTogglingHistory} onClick={handleToggleHistoryVisibility}>
                  {isTogglingHistory ? 'Confirm Wallet...' : historyVisible ? 'Turn Off' : 'Turn On'}
                </button>
              </div>

              {historyVisible && keyVersion > 1 && (
                <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                  <span
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                    title="Publishes any missing backward links for rotations that happened while history was off, using your own key envelopes. One wallet confirmation per missing epoch."
                  >
                    Older epochs may still be walled off
                  </span>
                  <button type="button" className={styles.card__editBtn} disabled={isBackfilling} onClick={handleBackfillBacklinks}>
                    {isBackfilling ? 'Backfilling...' : 'Backfill History Links'}
                  </button>
                </div>
              )}

              {pendingGrantRequests.length > 0 && (
                <>
                  <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {pendingGrantRequests.length} member{pendingGrantRequests.length > 1 ? 's' : ''} waiting for the current key
                    </span>
                    <button
                      type="button"
                      className={styles.card__submit}
                      style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                      disabled={isGrantingBatch}
                      onClick={handleGrantPendingKeys}
                    >
                      {isGrantingBatch ? 'Granting...' : `Grant Keys (${pendingGrantRequests.length})`}
                    </button>
                  </div>
                  {pendingGrantRequests.map((req) => (
                    <div
                      key={req.wallet_address}
                      style={{ padding: '0.25rem 0', fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}
                    >
                      {req.wallet_address.slice(0, 8)}...{req.wallet_address.slice(-6)}
                      {grantSkippedAddresses.includes(req.wallet_address) && (
                        <span style={{ marginLeft: '0.5rem', fontFamily: 'inherit' }}>
                          ⚠ no encryption identity on this network yet
                        </span>
                      )}
                    </div>
                  ))}
                  {grantSkippedAddresses.length > 0 && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      ⚠ {grantSkippedAddresses.length} member{grantSkippedAddresses.length > 1 ? 's' : ''} can't receive the key yet:
                      they must unlock their Security Vault once (Settings → Security) so their encryption identity gets registered on
                      this network — their request stays queued until then.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {isModerator && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Whitelist</h5>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0.75rem' }}>
                Wallets here pass the "Whitelisted" requirement type (configure requirements in Settings).
              </p>
              <form onSubmit={handleAddToWhitelist} className="flex align-items-center gap-050" style={{ marginBottom: '0.75rem' }}>
                <RecipientField
                  className={styles.card__recipient}
                  label={null}
                  inputClassName={styles.card__input}
                  value={newWhitelistAddress}
                  onChange={setNewWhitelistAddress}
                  viewer={address ?? null}
                  placeholder="Name, ENS, or 0x… wallet address"
                />
                <button
                  type="submit"
                  className={styles.card__submit}
                  style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                  disabled={isWhitelistPending || !newWhitelistAddress.address}
                >
                  {isWhitelistPending && !removingWhitelistAddress ? 'Adding...' : 'Add'}
                </button>
              </form>
              {whitelistEntries.length === 0 ? (
                <p className={styles.feed__empty}>No wallets whitelisted yet.</p>
              ) : (
                whitelistEntries.map((walletAddress) => (
                  <div key={walletAddress} className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                    <span>
                      {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
                    </span>
                    <button
                      type="button"
                      className={styles.card__cancelBtn}
                      disabled={isWhitelistPending && removingWhitelistAddress === walletAddress}
                      onClick={() => handleRemoveFromWhitelist(walletAddress)}
                    >
                      {isWhitelistPending && removingWhitelistAddress === walletAddress ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {isModerator && isRequestApproval && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Pending Requests</h5>
              {pendingRequests.length === 0 ? (
                <p className={styles.feed__empty}>No pending requests.</p>
              ) : (
                pendingRequests.map((req) => (
                  <div key={req.wallet_address} className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                    <Profile creator={req.wallet_address} networkId={chainId} variant="fullWithoutTime" />
                    <div className="flex gap-050">
                      <button
                        type="button"
                        className={styles.card__submit}
                        style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                        disabled={isApprovePending && approvingAddress === req.wallet_address}
                        onClick={() => handleApprove(req.wallet_address)}
                      >
                        {isApprovePending && approvingAddress === req.wallet_address ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className={styles.card__cancelBtn}
                        disabled={isRejectPending && rejectingAddress === req.wallet_address}
                        onClick={() => handleReject(req.wallet_address)}
                      >
                        {isRejectPending && rejectingAddress === req.wallet_address ? 'Rejecting...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </CardDialog>

      <CardDialog
        open={isEditing}
        onClose={() => setIsEditing(false)}
        className={styles.cardDialog}
        label={`Modify ${metadata.name || `Space #${id}`}`}
      >
        <DialogHeader title={`Modify ${metadata.name || `Space #${id}`}`} compact onCancel={() => setIsEditing(false)} />
        <form className={clsx(styles.cardDialog__body, styles.card__form)} onSubmit={handleUpdateSubmit}>

          <div className={styles.card__row}>
            <div className={styles.card__field}>
              <label className={styles.card__label}>Admission (how people get in)</label>
              <OptionPicker
                ariaLabel="Admission mode"
                triggerClassName={styles.card__select}
                value={editAdmission}
                onChange={setEditAdmission}
                options={ADMISSION_OPTIONS.map((option) => {
                  // Same rule as the create modal — token-gated with no requirements admits
                  // exactly who Open does. Exempt when it's already the community's mode: this
                  // form writes the enum onchain, so silently downgrading it isn't ours to do.
                  const locked =
                    option.value === ADMISSION.SelfServeIfEligible &&
                    editRequirements.length === 0 &&
                    editAdmission !== ADMISSION.SelfServeIfEligible
                  return { ...option, disabled: locked, disabledNote: SELF_SERVE_HINTS.locked }
                })}
              />
              {editAdmission === ADMISSION.SelfServeIfEligible && editRequirements.length === 0 && (
                <p className={clsx(styles.optionNote, styles['optionNote--warn'])}>{SELF_SERVE_HINTS.redundant}</p>
              )}
            </div>

            <div className={styles.card__field}>
              <label className={styles.card__label}>Who can post</label>
              <OptionPicker
                ariaLabel="Channel type"
                triggerClassName={styles.card__select}
                value={editCommunityType}
                onChange={setEditCommunityType}
                options={COMMUNITY_TYPE_OPTIONS}
              />
            </div>
          </div>

          {/* Composable requirement editor — same rows as the create modal. Works with
              ERC-721/LSP8 collections and ERC-20/LSP7 tokens (balanceOf is selector-compatible
              in both pairs). */}
          <div className={styles.card__field}>
            <label className={styles.card__label}>Requirements (optional) — what members must hold or be</label>
            {editRequirements.map((row, index) => {
              const meta = REQUIREMENT_TYPE_OPTIONS[row.rType]
              return (
                <div key={index} className="flex align-items-center gap-050" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <select
                    className={styles.card__select}
                    style={{ width: 'auto' }}
                    title={meta?.note}
                    value={row.rType}
                    // Reset the minimum on type change: a decimal entered for native would
                    // break the integer BigInt conversion token/NFT rows use
                    onChange={(e) =>
                      setEditRequirements((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, rType: Number(e.target.value), minBalance: '1' } : r))
                      )
                    }
                  >
                    {REQUIREMENT_TYPE_CHOICES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {meta?.needsAsset && row.rType === REQUIREMENT_TYPE.TokenBalance && (
                    <TokenAssetInput
                      chainId={chainId}
                      value={row.asset}
                      onChange={(asset) => setEditRequirements((rows) => rows.map((r, i) => (i === index ? { ...r, asset } : r)))}
                      inputClassName={styles.card__input}
                      style={{ flex: 1, minWidth: '220px' }}
                      allowNative={Boolean(meta.assetOptional)}
                      required={!meta.assetOptional}
                    />
                  )}
                  {meta?.needsAsset && row.rType !== REQUIREMENT_TYPE.TokenBalance && (
                    <input
                      className={styles.card__input}
                      style={{ flex: 1, minWidth: '180px' }}
                      placeholder="0x... collection address"
                      value={row.asset}
                      onChange={(e) =>
                        setEditRequirements((rows) => rows.map((r, i) => (i === index ? { ...r, asset: e.target.value } : r)))
                      }
                      required
                    />
                  )}
                  {meta?.needsMin && (
                    <>
                      <input
                        className={styles.card__input}
                        style={{ width: '130px' }}
                        type="number"
                        min="0"
                        // Coin and token minimums are whole units (decimals allowed); NFT
                        // minimums are a count of items, so they stay integers
                        step={row.rType === REQUIREMENT_TYPE.NftBalance ? '1' : 'any'}
                        placeholder={row.rType === REQUIREMENT_TYPE.NftBalance ? 'minimum' : 'e.g. 0.001'}
                        value={row.minBalance}
                        onChange={(e) =>
                          setEditRequirements((rows) => rows.map((r, i) => (i === index ? { ...r, minBalance: e.target.value } : r)))
                        }
                      />
                      {row.rType === REQUIREMENT_TYPE.TokenBalance && <TokenUnitHint address={row.asset} chainId={chainId} />}
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.card__cancelBtn}
                    aria-label="Remove requirement"
                    onClick={() => setEditRequirements((rows) => rows.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            <div className="flex align-items-center gap-050" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.card__editBtn}
                disabled={editRequirements.length >= 10}
                onClick={() => setEditRequirements((rows) => [...rows, { rType: 2, asset: '', minBalance: '1' }])}
              >
                + Add requirement
              </button>
              {editRequirements.length >= 2 && (
                <select
                  className={styles.card__select}
                  style={{ width: 'auto' }}
                  value={editRequirementMode}
                  onChange={(e) => setEditRequirementMode(Number(e.target.value))}
                  aria-label="How requirements combine"
                >
                  {REQUIREMENT_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Encrypted content: an explicit toggle now, orthogonal to admission. Enabling is a
              one-shot initializeKey; there's no "off" that decrypts history (epoch semantics). */}
          <div className={styles.card__field}>
            <label className={styles.card__label}>Encrypted content 🔒</label>
            {isEncryptionInitialized ? (
              <p className={styles.optionNote}>
                Enabled — posts seal with the community key. Manage keys and rotation from Members & moderation.
              </p>
            ) : vault.identity ? (
              <>
                <button
                  type="button"
                  className={styles.card__editBtn}
                  style={{ width: 'fit-content' }}
                  disabled={isInitializingKey}
                  onClick={handleEnableEncryption}
                >
                  {isInitializingKey ? 'Confirming...' : 'Enable encryption'}
                </button>
                <p className={styles.optionNote}>{ENCRYPTION_NOTES.off}</p>
              </>
            ) : (
              <VaultUnlockPrompt vault={vault} />
            )}
          </div>

          {/* Conditional Input UI layer for handling Pay to Join configuration */}
          {editAdmission === ADMISSION.PayToJoin && (
            <div
              className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')}
              style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Join price</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem' }}>
                Each new member pays this once, and it goes to you. Leave the token blank to charge in{' '}
                {nativeCurrency.symbol || 'the network’s coin'}, or search a token by name / paste its address. Enter the price the way
                you’d say it (e.g. 0.5).
              </p>
              <div className={styles.card__field}>
                <label className={styles.card__label}>Payment token (blank = {nativeCurrency.symbol || 'the network’s coin'})</label>
                <TokenAssetInput
                  chainId={chainId}
                  value={paymentTokenAddress}
                  onChange={(address, picked) => {
                    setPaymentTokenAddress(address)
                    // A search result knows whether it's an LSP7; a pasted address keeps the checkbox
                    if (picked) setPaymentIsLsp7(Boolean(picked.isLsp7))
                  }}
                  inputClassName={styles.card__input}
                />
              </div>
              {/* LSP7 is LUKSO's token standard — only worth asking there */}
              {paymentTokenAddress && chainId === 42 && (
                <div
                  className={styles.card__field}
                  style={{ marginTop: '0.5rem', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}
                >
                  <input type="checkbox" id="paymentIsLsp7" checked={paymentIsLsp7} onChange={(e) => setPaymentIsLsp7(e.target.checked)} />
                  <label htmlFor="paymentIsLsp7" className={styles.card__label} style={{ margin: 0 }}>
                    This is a LUKSO (LSP7) token
                  </label>
                </div>
              )}
              <div className={styles.card__field} style={{ marginTop: '0.5rem' }}>
                <label className={styles.card__label}>
                  Price <AssetUnitLabel address={paymentTokenAddress} chainId={chainId} />
                </label>
                <input
                  type="number"
                  step="any"
                  className={styles.card__input}
                  placeholder="0.01"
                  min="0"
                  value={paymentPrice}
                  onChange={(e) => setPaymentPrice(e.target.value)}
                  required={editAdmission === ADMISSION.PayToJoin}
                />
              </div>
              <div className={styles.card__field} style={{ marginTop: '0.75rem' }}>
                <label className={styles.card__label}>Fee destination (optional)</label>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem' }}>
                  Every join fee is sent to this address in full, the moment someone joins — leave empty to
                  receive it yourself. Changes apply to joins from then on and are public.
                </p>
                <RecipientField
                  label={null}
                  inputClassName={styles.card__input}
                  value={editPayoutDestination}
                  onChange={setEditPayoutDestination}
                  viewer={activeAccountAddress ?? null}
                  placeholder="Name, ENS, or 0x… wallet / contract address"
                  hint="Contracts work too: a Safe, DAO treasury, or splitter contract can share fees between wallets under rules you control. Make sure it can receive the payment asset — joins fail while it can't."
                />
              </div>
            </div>
          )}

          <div className={styles.card__field}>
            <label className={styles.card__label}>Name</label>
            <input className={styles.card__input} value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Tag (optional)</label>
            <input
              className={styles.card__input}
              placeholder="e.g., ALPHA"
              value={editTag}
              onChange={(e) => setEditTag(normalizeTag(e.target.value))}
              maxLength={MAX_TAG_LENGTH}
            />
            <p className={styles.card__hint}>
              Up to {MAX_TAG_LENGTH} characters, worn by members next to their name. Clearing it removes the badge from
              everyone wearing it.
            </p>
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Category</label>
            <select className={styles.card__select} value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
              {categories.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Short summary</label>
            <input className={styles.card__input} value={editSummary} onChange={(e) => setEditSummary(e.target.value)} required />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Description</label>
            <textarea
              className={styles.card__textarea}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              required
            />
          </div>

          <ImagePicker label="Logo" value={editLogoUrl} onChange={setEditLogoUrl} />

          <ImagePicker label="Cover image" value={editCoverUrl} onChange={setEditCoverUrl} />

          <BrandingLinksFields
            socials={editSocials}
            onSocialsChange={setEditSocials}
            extraLinks={editExtraLinks}
            onExtraLinksChange={setEditExtraLinks}
            disabled={isUpdatePending || isUpdateConfirming}
          />

          <button
            type="submit"
            className={styles.card__submit}
            disabled={
              isUpdatePending ||
              isUpdateConfirming ||
              isRequirementsPending ||
              isRequirementsConfirming ||
              isPaymentReqPending ||
              isPaymentReqConfirming
            }
          >
            {isUpdatePending || isRequirementsPending || isPaymentReqPending
              ? 'Confirm Wallet...'
              : isUpdateConfirming || isRequirementsConfirming || isPaymentReqConfirming
                ? 'Updating Block...'
                : 'Save Configuration'}
          </button>

          {/* Archive is a reversible freeze (lived in the old three-dot menu): posting and
              joining stop for everyone, content/members/keys stay, and the community is
              delisted from the public directory until reactivated */}
          <button
            type="button"
            className={styles.card__cancelBtn}
            disabled={isStatusPending || isStatusConfirming}
            onClick={handleToggleStatus}
          >
            {isStatusPending || isStatusConfirming
              ? 'Confirm Wallet...'
              : isActive
                ? 'Archive community (reversible)'
                : 'Reactivate community'}
          </button>

          {/* Progress, the saved confirmation, and any failure all live in the toast now —
              see the transaction feedback effects above. A toast outlives this dialog, so a
              confirmation that lands after it closes is still seen. */}
        </form>
      </CardDialog>

      {/* One editor for the whole app: the same NewPost composer used everywhere, in community
          mode — it seals/tags content for this community and submits on this community's chain */}
      {isPosting && (
        <>
          {isEncryptionInitialized && (!vault.identity || vault.needsRegistration) ? (
            <div className={styles.card__form}>
              <VaultUnlockPrompt vault={vault} />
              <button type="button" className={styles.card__cancelBtn} onClick={() => setIsPosting(false)}>
                Close
              </button>
            </div>
          ) : (
            <NewPost
              actionType="post"
              communityTarget={{ communityId: id, networkId: chainId, name: metadata.name || `Space #${id}` }}
              onClose={() => setIsPosting(false)}
              onConfirmed={() => setFeedRefreshKey((k) => k + 1)}
            />
          )}
        </>
      )}
    </div>
  )
}

// Top-level layout entry default page export module
export default function CommunitiesPage() {
  const vault = useCommunityVault()
  const { address: activeAccountAddress } = useAccount()
  const { categories } = useCommunityCategories()

  // The category chip row scrolls sideways; arrows + edge fades come from the same hook as the
  // NFT collections rail, since a hidden scrollbar alone leaves people unaware of the rest
  const categoryRailRef = useRef(null)
  const { canScrollLeft, canScrollRight, scrollByPage } = useRailScroll(categoryRailRef, [categories])
  const categoryRailOverflows = canScrollLeft || canScrollRight

  // Always-mounted creation modal (matches the app's other modals): opening and closing go
  // through this handle, so a half-filled form survives an accidental close
  const createModalRef = useRef(null)

  // Chains that actually have a HupCommunity deployment — the network filter's option list
  const communityChains = config.chains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.community)

  // Network filter: defaults to All Networks so every deployed chain's communities are visible
  // without switching the wallet, still narrowable to a single network. CommunityCard is
  // chain-aware (networkId prop) so cards from other networks read correctly.
  const [selectedNetworkId, setSelectedNetworkId] = useState('all')
  const isAllNetworks = selectedNetworkId === 'all'
  const directoryNetworkId = isAllNetworks ? null : Number(selectedNetworkId)
  const directoryContractAddress = isAllNetworks ? null : CONTRACTS[`chain${directoryNetworkId}`]?.community

  // Directory is searchable/paginated from cidex's indexed `communities` table (from
  // CommunityCreated/CommunityUpdated events) instead of iterating every on-chain id client-side.
  // HupCommunity.communities(id) stays the source of truth for gating; CommunityCard already
  // reads it directly for anything that actually needs live/authoritative data.
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  // Public/Private split: 'public' = plaintext content, 'private' = encrypted content
  // (indexed is_encrypted flag from KeyInitialized) — resolved by the API's visibility param
  const [visibilityFilter, setVisibilityFilter] = useState('all')
  // Category slug from config/communityCategories.js, or 'all' — resolved by the API's
  // category param against cidex's indexed `communities.category`
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [communityRows, setCommunityRows] = useState([])
  const [directoryPage, setDirectoryPage] = useState(1)
  const [totalCommunities, setTotalCommunities] = useState(0)
  const [hasMoreCommunities, setHasMoreCommunities] = useState(false)
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState('')

  // Debounce keystrokes into the actual query — same 400ms rhythm as the app's search page.
  // Trimmed so a trailing space can't sneak into the LIKE term and match nothing.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Monotonic fetch counter: debounced keystrokes can leave several directory requests in
  // flight, and a slow older response must not overwrite the newest query's results
  const directoryFetchSeqRef = useRef(0)

  // `quiet` skips the loading state: a poll that repeats every few seconds would otherwise
  // flash the directory's skeleton over content that is already on screen.
  const fetchDirectory = async (page = 1, append = false, { quiet = false } = {}) => {
    if (isAllNetworks ? communityChains.length === 0 : !directoryNetworkId || !directoryContractAddress) return null
    const fetchSeq = ++directoryFetchSeqRef.current
    if (!quiet) setIsDirectoryLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (isAllNetworks) {
        // Every deployed network at once — pinning each network to its current contract address
        // keeps stale rows from retired deployments out of the directory
        params.set('contracts', communityChains.map((chain) => `${chain.id}:${CONTRACTS[`chain${chain.id}`].community}`).join(','))
      } else {
        params.set('network_id', directoryNetworkId)
        params.set('contract_address', directoryContractAddress)
      }
      if (searchQuery) params.set('search', searchQuery)
      if (visibilityFilter !== 'all') params.set('visibility', visibilityFilter)
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      // Default sort brings communities the connected wallet created to the top of the directory
      if (activeAccountAddress) params.set('viewer_address', activeAccountAddress)

      const res = await fetch(`/api/v1/networks/communities?${params.toString()}`)
      const json = await res.json()
      if (fetchSeq !== directoryFetchSeqRef.current) return // stale response — a newer fetch owns the state now
      if (!json.success) throw new Error(json.error || 'Failed to load communities')

      setCommunityRows((prev) => (append ? [...prev, ...json.data] : json.data))
      setHasMoreCommunities(Boolean(json.meta?.hasMore))
      setTotalCommunities(Number(json.meta?.total ?? 0))
      setDirectoryPage(page)
      setDirectoryError('')
      // Handed back so a caller waiting on a specific community can tell whether this page
      // already contains it — see waitForCommunityToIndex
      return json.data
    } catch (err) {
      if (fetchSeq !== directoryFetchSeqRef.current) return null
      console.error('Failed to load community directory from cidex:', err)
      setDirectoryError(err.message || 'Failed to load communities')
      return null
    } finally {
      if (!quiet && fetchSeq === directoryFetchSeqRef.current) setIsDirectoryLoading(false)
    }
  }

  // cidex reads the CommunityCreated event a few seconds behind the receipt, so the single
  // refetch fired the moment a create confirms reliably misses the new row — which is why the
  // directory used to need a manual page reload. Retry on a widening backoff until the row
  // shows up, then stop; if indexing is further behind than this, the next natural refresh
  // picks it up.
  const INDEXING_BACKOFF_MS = [0, 1500, 3000, 5000, 8000, 12000]
  const waitForCommunityToIndex = async (communityId) => {
    for (const delay of INDEXING_BACKOFF_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      const rows = await fetchDirectory(1, false, { quiet: delay > 0 })
      // A create with no id decoded (or a fetch that lost its race) just takes the first refresh
      if (communityId == null || !rows) return
      if (rows.some((row) => String(row.id) === String(communityId))) return
    }
  }

  useEffect(() => {
    fetchDirectory(1, false)
  }, [selectedNetworkId, directoryContractAddress, searchQuery, visibilityFilter, categoryFilter, activeAccountAddress])

  return (
    <>
      <PageTitle name="Communities" />
      
      <div className={clsx('__container')} data-width="medium">
        {/* First element of the page, outside the container — same placement as the search page */}
        <label className={clsx(styles.search, 'rounded-full')}>
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <input
            type="search"
            className={styles.search__input}
            placeholder="Search communities..."
            aria-label="Search communities"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
      </div>

      <div className={clsx(styles.page, 'animate', 'fade')}>
        <div className={clsx('__container', styles.page__container)} data-width="medium">
          <div className={styles.directory}>
            <div className={styles.directory__header}>
              <select
                className={styles.directory__networkSelect}
                value={selectedNetworkId}
                onChange={(e) => setSelectedNetworkId(e.target.value)}
                aria-label="Filter communities by network"
              >
                <option value="all">All Networks</option>
                {communityChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <div className={styles.directory__visibilityTabs} role="group" aria-label="Filter communities by visibility">
                {[
                  ['all', 'All'],
                  ['public', 'Public'],
                  ['private', 'Private'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={clsx(
                      styles.directory__visibilityTab,
                      visibilityFilter === value && styles['directory__visibilityTab--active']
                    )}
                    aria-pressed={visibilityFilter === value}
                    onClick={() => setVisibilityFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex align-items-center gap-050">
                {/* "Syncing..." only before the very first response — on later refetches the
                    previous total stays put so the header row doesn't resize and shift */}
                <span className={styles.directory__count}>
                  {isDirectoryLoading && communityRows.length === 0 && totalCommunities === 0 ? 'Syncing...' : `${totalCommunities} Total`}
                </span>
                <button type="button" className={styles.createTrigger} onClick={() => createModalRef.current?.open()}>
                  New Community
                </button>
              </div>
            </div>

            {/* Category chips: one row that scrolls sideways rather than wrapping into a wall of
                pills, with arrows once it overflows. 'all' is a chip too so the active state always
                shows. The list comes from the community_categories table via the hook. */}
            <div className={styles.directory__categoryRow}>
              <div
                ref={categoryRailRef}
                className={clsx(
                  styles.directory__categories,
                  canScrollLeft && styles['directory__categories--moreLeft'],
                  canScrollRight && styles['directory__categories--moreRight']
                )}
                role="group"
                aria-label="Filter communities by category"
              >
                {[{ slug: 'all', label: 'All topics' }, ...categories].map((option) => (
                  <button
                    key={option.slug}
                    type="button"
                    className={clsx(styles.directory__category, categoryFilter === option.slug && styles['directory__category--active'])}
                    aria-pressed={categoryFilter === option.slug}
                    onClick={() => setCategoryFilter(option.slug)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {/* Only once the row actually overflows — arrows on a row that fits would promise
                  more chips than there are */}
              {categoryRailOverflows && (
                <div className={styles.directory__categoryArrows}>
                  <button
                    type="button"
                    className={styles.directory__categoryArrow}
                    aria-label="Scroll categories left"
                    disabled={!canScrollLeft}
                    onClick={() => scrollByPage(-1)}
                  >
                    <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.directory__categoryArrow}
                    aria-label="Scroll categories right"
                    disabled={!canScrollRight}
                    onClick={() => scrollByPage(1)}
                  >
                    <CaretRightIcon size={14} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {directoryError && <div className={styles.manager__error}>Failed to load community directory: {directoryError}</div>}

            <div className={clsx(styles.directory__grid, isDirectoryLoading && styles['directory__grid--loading'])}>
              {communityRows.length === 0 && !isDirectoryLoading ? (
                <p className={styles.directory__empty}>
                  {searchQuery
                    ? 'No communities match your search.'
                    : categoryFilter !== 'all'
                      ? `No ${getCommunityCategory(categoryFilter, categories).label} communities here yet.`
                      : visibilityFilter !== 'all'
                        ? `No ${visibilityFilter} communities here yet.`
                        : 'No communities found. Be the first to create one!'}
                </p>
              ) : (
                communityRows.map((row) => (
                  <CommunityCard
                    key={`${row.network_id}-${row.id}`}
                    id={Number(row.id)}
                    networkId={Number(row.network_id)}
                    memberCount={Number(row.member_count ?? 0)}
                    row={row}
                  />
                ))
              )}
            </div>

            {hasMoreCommunities && (
              <div className="flex justify-content-center p-100">
                <button
                  type="button"
                  className={styles.manager__submit}
                  style={{ width: 'auto', padding: '0.65rem 1.5rem' }}
                  onClick={() => fetchDirectory(directoryPage + 1, true)}
                  disabled={isDirectoryLoading}
                >
                  {isDirectoryLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>

          <CreateCommunityModal
            ref={createModalRef}
            vault={vault}
            vaultPrompt={<VaultUnlockPrompt vault={vault} />}
            onCreated={(newCommunityId) => {
              // Close first, then keep refreshing in the background until cidex has the row —
              // the modal is done either way, and the directory fills itself in without the
              // user reaching for reload
              createModalRef.current?.close()
              waitForCommunityToIndex(newCommunityId)
            }}
          />
        </div>
      </div>
    </>
  )
}
