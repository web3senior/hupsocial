'use client'

import { useState, useEffect, useRef } from 'react'
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
import { GearSixIcon, MagnifyingGlassIcon, UsersIcon } from '@phosphor-icons/react'
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
import { getIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { rememberCardPointerDown, isTextSelectionDrag } from '@/lib/cardClick'
import { buildLinks, displayLinks, emptySocials, parseLinks } from '@/lib/socialLinks'
import BrandingLinksFields from './_components/BrandingLinksFields'
import ImagePicker from './_components/ImagePicker'
import CreateCommunityModal from './_components/CreateCommunityModal'
import { AssetUnitLabel, TokenRequirementTag, TokenUnitHint } from './_components/TokenAmount'
import {
  ZERO_ADDRESS,
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
  REQUIREMENT_MODE_OPTIONS,
  ENCRYPTION_NOTES,
  SELF_SERVE_HINTS,
} from './membershipOptions'
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
          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Encryption identity not registered on this network</h5>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem' }}>
            Your vault is unlocked, but this network's community contract doesn't know your public key yet — without it, moderators can't
            grant you community keys here.
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
function NftTag({ tokenAddress, chainId, minBalance }) {
  const { data: nftName } = useReadContract({
    address: tokenAddress,
    chainId,
    abi: [{ name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }],
    functionName: 'name',
  })

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
export function CommunityCard({ id, networkId = null, hideHeader = false, memberCount = null }) {
  const { address, isConnected } = useConnection()
  const { address: activeAccountAddress } = useAccount()
  const activeChainId = useChainId()
  // Chain-aware: an explicit networkId (directory filter / detail route) pins every read and
  // write to that chain — reads via a chain-bound public client, writes via wagmi's chainId
  // param (which prompts a network switch when the wallet is elsewhere).
  const chainId = networkId ? Number(networkId) : activeChainId
  const publicClient = usePublicClient({ chainId })
  const vault = useCommunityVault()
  const router = useRouter()
  const CONTRACT_ADDRESS = CONTRACTS[`chain${chainId}`]?.community

  const [metadata, setMetadata] = useState(null)

  const [isEditing, setIsEditing] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [isManagingMembers, setIsManagingMembers] = useState(false)
  const [communityPosts, setCommunityPosts] = useState([])
  const [isFeedLoading, setIsFeedLoading] = useState(false)

  // Update states for inline modifications
  const [editName, setEditName] = useState('')
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

  // Payment Requirement Input States (blank paymentTokenAddress means the native coin)
  const [paymentTokenAddress, setPaymentTokenAddress] = useState('')
  const [paymentPrice, setPaymentPrice] = useState('')
  const [paymentIsLsp7, setPaymentIsLsp7] = useState(false)
  const [isPayingToJoin, setIsPayingToJoin] = useState(false)

  // New post content inputs
  // Bumped by the NewPost community composer once its tx confirms, so the feed reloads
  const [feedRefreshKey, setFeedRefreshKey] = useState(0)
  // Infinite-scroll paging for the community feed (detail page only)
  const [feedPage, setFeedPage] = useState(1)
  const [hasMoreFeed, setHasMoreFeed] = useState(false)
  const [isFeedLoadingMore, setIsFeedLoadingMore] = useState(false)

  // Member management state
  const [pendingRequests, setPendingRequests] = useState([])
  const [members, setMembers] = useState([])
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
  })

  // Safe-to-use-before-loaded derived values so hooks below can reference them unconditionally
  const creator = data ? data[1] : null
  const admission = data ? Number(data[2]) : null
  const cType = data ? Number(data[3]) : null
  // Indices track the Community struct's field order (id, creator, admission, cType, isActive,
  // metadata) — isActive sits before metadata so it packs into the creator slot onchain.
  const isActive = data ? Boolean(data[4]) : true
  const isOwner = Boolean(activeAccountAddress && creator && activeAccountAddress.toLowerCase() === creator.toLowerCase())

  // The community's composable requirement list + its ALL/ANY combinator (empty = no gating)
  const { data: requirementsData, refetch: refetchRequirements } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'getRequirements',
    args: [id],
  })
  const requirementsList = requirementsData ?? []

  const { data: requirementModeData } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'requirementMode',
    args: [id],
    query: { enabled: requirementsList.length > 1 },
  })

  const { data: paymentRequirementData, refetch: refetchPaymentRequirement } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'paymentRequirements',
    args: [id],
  })

  // Unpacked next to its read (rather than further down with the rest of the render values) so
  // the metadata hook below stays above this component's loading return.
  const savedPaymentToken = paymentRequirementData ? paymentRequirementData[0] : null
  const savedPaymentPrice = paymentRequirementData ? paymentRequirementData[1]?.toString() : null
  const savedPaymentIsLsp7 = Boolean(paymentRequirementData?.[2])
  const hasValidPaymentRequirement = Boolean(paymentRequirementData) && savedPaymentPrice !== '0'
  const isPaymentNative = isNativeAsset(savedPaymentToken)

  // The join price is stored in the smallest unit of whichever asset it's priced in — it only
  // becomes a number anyone can read once scaled by that asset's decimals
  const nativeCurrency = getNativeCurrency(chainId)
  const paymentMeta = useTokenMeta(savedPaymentToken, chainId)
  const paymentPriceLabel = formatTokenDisplay(savedPaymentPrice, paymentMeta.decimals)
  const paymentPriceWithSymbol = paymentPriceLabel === null ? '…' : `${paymentPriceLabel} ${paymentMeta.symbol}`.trim()

  // Current viewer's membership status (isMember, isPending, isModerator, isBanned, canPost)
  const { data: myStatusData, refetch: refetchMyStatus } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'registry',
    args: [id, activeAccountAddress],
    query: { enabled: !!activeAccountAddress },
  })
  const isModerator = isOwner || Boolean(myStatusData?.[2])
  const isMember = Boolean(myStatusData?.[0])

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
    query: { enabled: !!activeAccountAddress },
  })

  // Live composite eligibility (requirement list + optional module) — lets the Self-serve
  // Join button disable itself proactively instead of submitting a join() that will revert
  const { data: amIEligible } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'isEligible',
    args: [activeAccountAddress, id],
    query: { enabled: !!activeAccountAddress && admission === ADMISSION.SelfServeIfEligible },
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
  })
  const keyVersion = keyVersionData ? Number(keyVersionData) : 0
  const isEncryptionInitialized = keyVersion > 0

  // History policy: when true, rotations publish backward key-chain links so members holding
  // only the current key (including future joiners) can decrypt pre-rotation posts.
  const { data: historyVisibleData, refetch: refetchHistoryVisible } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'historyVisibleToNewMembers',
    args: [id],
  })
  const historyVisible = Boolean(historyVisibleData)

  // DAO mode: the community's optional governance executor (creator-level powers onchain).
  // Reverts on pre-governor deployments — wagmi surfaces that as undefined, i.e. "no governor".
  const { data: governorData, refetch: refetchGovernor } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'governors',
    args: [id],
  })
  const governor = governorData && governorData !== '0x0000000000000000000000000000000000000000' ? governorData : null

  // The viewer's own wrapped copy of the current content key
  const { data: myWrappedKeyData, refetch: refetchMyWrappedKey } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'wrappedKeys',
    args: [id, activeAccountAddress, BigInt(keyVersion || 0)],
    query: { enabled: isEncryptionInitialized && !!activeAccountAddress },
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
  // pre-invite deployments — wagmi surfaces that as undefined, i.e. "no invite".
  const { data: myInviteData, refetch: refetchMyInvite } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'invites',
    args: [id, activeAccountAddress],
    query: { enabled: !!activeAccountAddress },
  })

  const { mutate: respondInvite, data: inviteRespHash, isPending: isInviteRespPending, error: inviteRespError } = useWriteContract()
  const { isSuccess: isInviteRespConfirmed } = useWaitForTransactionReceipt({ hash: inviteRespHash })

  useEffect(() => {
    if (isInviteRespConfirmed) {
      refetchMyInvite()
      refetchMyStatus()
      refetchMyCanPost()
    }
  }, [isInviteRespConfirmed])

  // --- Join-fee earnings (pull-payment ledger: join() accrues, the creator withdraws) ---

  const { data: joinPayoutsData, refetch: refetchJoinPayouts } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'joinPayouts',
    args: [activeAccountAddress],
    query: { enabled: !!activeAccountAddress && isOwner },
  })

  const { mutate: withdrawPayouts, data: withdrawHash, isPending: isWithdrawPending, error: withdrawError } = useWriteContract()
  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawConfirmed } = useWaitForTransactionReceipt({ hash: withdrawHash })

  useEffect(() => {
    if (isWithdrawConfirmed) refetchJoinPayouts()
  }, [isWithdrawConfirmed, refetchJoinPayouts])

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
      const res = await fetch(`/api/communities/join-requests?network_id=${chainId}&community_id=${id}`)
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

  useEffect(() => {
    if (isRequestApproval) {
      refetchPendingRequests()
    }
  }, [isRequestApproval, chainId, id])

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

  // Pay to Join is also self-service, but pays first: native coin goes
  // straight into join()'s value; a token price needs an authorization step the contract can pull
  // from first — LSP7's authorizeOperator(spender, amount, data) for an LSP7 asset, or ERC-20's
  // approve(spender, amount) otherwise. These are not the same call: LSP7 has no transferFrom, so
  // using the wrong one here would leave join() unable to actually collect payment.
  const handlePayToJoin = async () => {
    if (!activeAccountAddress || !paymentRequirementData) return
    const [token, price, isLsp7] = paymentRequirementData
    const isNative = !token || token === '0x0000000000000000000000000000000000000000'

    setIsPayingToJoin(true)
    try {
      if (!isNative && isLsp7) {
        await approveTokenAsync({
          address: token,
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
          args: [CONTRACT_ADDRESS, price, '0x'],
        })
      } else if (!isNative) {
        await approveTokenAsync({
          address: token,
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
      payToJoin({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'join',
        args: [id],
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
    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      args: [id],
    })
  }

  // RequestApproval admission: join() files the onchain isPending flag; the offchain record that
  // makes the request discoverable to moderators is written only AFTER the tx confirms (see the
  // isJoinConfirmed effect below). Recording it here would leave a phantom queue entry whenever
  // the wallet prompt is rejected or the tx fails — approveRequest on a wallet whose onchain
  // isPending was never set reverts with NoPendingRequest.
  const handleRequestAccess = () => {
    if (!activeAccountAddress || !chainId) return

    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      args: [id],
    })
  }

  // Once the confirmed join() was a RequestApproval request (it only sets isPending, not
  // membership), file the offchain discovery record — guarded per-hash so a re-render can't
  // double-post the same confirmation.
  const requestRecordedRef = useRef(null)
  useEffect(() => {
    if (!isJoinConfirmed) return

    refetchMyStatus()
    refetchMyCanPost()

    if (admission === ADMISSION.RequestApproval && activeAccountAddress && requestRecordedRef.current !== joinHash) {
      requestRecordedRef.current = joinHash
      fetch('/api/communities/join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: chainId, communityId: id, walletAddress: activeAccountAddress }),
      })
        .then(() => refetchPendingRequests())
        .catch((err) => console.error('Failed to record the access request:', err))
    }
  }, [isJoinConfirmed, joinHash, admission, activeAccountAddress, refetchMyStatus, refetchMyCanPost])

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
      const addresses = await fetchAllPaginated('getMembers', 'memberCount')
      const statuses = await Promise.all(
        addresses.map((addr) =>
          publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: HupCommunityABI,
            functionName: 'registry',
            args: [id, addr],
          })
        )
      )
      setMembers(addresses.map((addr, i) => ({ address: addr, isBanned: Boolean(statuses[i][3]) })))
    } catch (err) {
      console.error('Failed to load community member list on-chain:', err)
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
      }
    }
  }, [isManagingMembers, id, isApproveConfirmed, isBanConfirmed, isUnbanConfirmed, isModerator])

  // Readmission is roster-only — clear the row's busy state once it confirms (the member list
  // refresh itself is handled by the effect above via isUnbanConfirmed)
  useEffect(() => {
    if (isUnbanConfirmed) setBanningAddress(null)
  }, [isUnbanConfirmed])

  // After a join request is approved on-chain: drop it from the discovery index, and if this
  // community is encrypted, grant the new member the current content key
  useEffect(() => {
    const run = async () => {
      if (!isApproveConfirmed || !approvingAddress || approveHandledRef.current === approveHash) return
      approveHandledRef.current = approveHash

      fetch(`/api/communities/join-requests?network_id=${chainId}&community_id=${id}&wallet_address=${approvingAddress}`, {
        method: 'DELETE',
      }).catch(() => {})

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

  // After a rejection confirms: drop the request from the off-chain discovery index so it
  // disappears for every moderator, and from this panel immediately. The wallet stays free to
  // request again later — rejection only clears isPending, it doesn't ban.
  const rejectHandledRef = useRef(null)
  useEffect(() => {
    if (!isRejectConfirmed || !rejectingAddress || rejectHandledRef.current === rejectHash) return
    rejectHandledRef.current = rejectHash

    fetch(`/api/communities/join-requests?network_id=${chainId}&community_id=${id}&wallet_address=${rejectingAddress}`, {
      method: 'DELETE',
    }).catch(() => {})

    setPendingRequests((prev) => prev.filter((r) => r.wallet_address?.toLowerCase() !== rejectingAddress.toLowerCase()))
    setRejectingAddress(null)
  }, [isRejectConfirmed, rejectHash, rejectingAddress])

  // Self-heal phantom queue entries: an approveRequest that reverts NoPendingRequest (0xcc2c06e8)
  // means the offchain record exists but the wallet's onchain isPending was never set — its join()
  // tx was rejected or failed after the record was written (possible for rows created before the
  // record-after-confirm fix). Drop the orphaned record so the queue matches the chain; the wallet
  // can simply request again.
  const staleRequestHandledRef = useRef(null)
  useEffect(() => {
    if (!approveError || !approvingAddress || staleRequestHandledRef.current === approveError) return
    const text = `${approveError.shortMessage || ''} ${approveError.message || ''}`
    if (!text.includes('NoPendingRequest') && !text.includes('0xcc2c06e8')) return
    staleRequestHandledRef.current = approveError

    fetch(`/api/communities/join-requests?network_id=${chainId}&community_id=${id}&wallet_address=${approvingAddress}`, {
      method: 'DELETE',
    }).catch(() => {})

    setPendingRequests((prev) => prev.filter((r) => r.wallet_address?.toLowerCase() !== approvingAddress.toLowerCase()))
    setApprovingAddress(null)
  }, [approveError, approvingAddress])

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

  // Initial load / refresh (page 1) — infinite scrolling appends further pages below
  useEffect(() => {
    const fetchCommunityFeed = async () => {
      // The grid/directory view doesn't show a per-card feed (see hideHeader-gated render below) —
      // skip the fetch entirely there so browsing the directory doesn't fire one feed request per
      // visible card
      if (!chainId || !hideHeader) return
      setIsFeedLoading(true)
      try {
        const response = await getPosts(1, FEED_PAGE_SIZE, chainId, null, address, id)
        const rows = response?.success ? response.data : []
        const decrypted = await decryptFeedRows(rows.filter((post) => !post.is_deleted))

        setCommunityPosts(decrypted)
        setFeedPage(1)
        setHasMoreFeed(Boolean(response?.meta?.hasMore))
      } catch (err) {
        console.error('Failed to load community feed from cidex:', err)
      } finally {
        setIsFeedLoading(false)
      }
    }

    fetchCommunityFeed()
  }, [id, chainId, address, feedRefreshKey, vault.identity, hideHeader])

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
  // CID), not raw JSON — resolve it client-side since this reads communities() live from chain
  // rather than through cidex's already-resolved DB copy. Declared before the early-return below
  // so this hook always runs unconditionally like the others.
  useEffect(() => {
    if (!data) return
    let cancelled = false
    const cid = data[5]

    const resolve = async () => {
      let resolved = { name: `Space #${id}`, summary: 'Invalid metadata payload structure' }
      if (cid) {
        const result = await getIPFS(cid.replace('ipfs://', '').replace('://', ''))
        if (result && result.result !== false) resolved = result
      }
      if (!cancelled) setMetadata(resolved)
    }
    resolve()

    return () => {
      cancelled = true
    }
  }, [data, id])

  if (isLoading || !data || !metadata) {
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

  const admissionLabel = ADMISSION_OPTIONS[admission]?.label || '—'
  const typeLabels = ['Discussion', 'Broadcast']

  // Every amount in the editor is a whole-unit string, so seeding means scaling the raw onchain
  // integers back by their asset's decimals. The reads are near-always cache hits (the card's own
  // tags resolved the same assets); when one genuinely fails the editor stays shut rather than
  // opening with a number that would be written back wrong.
  const handleStartEditing = async () => {
    let seededRequirements
    let seededPaymentPrice
    try {
      seededRequirements = await Promise.all(
        requirementsList.map(async (row) => {
          const rType = Number(row.rType)
          const raw = row.minBalance ?? 0n
          return {
            rType,
            asset: row.asset === ZERO_ADDRESS ? '' : row.asset,
            minBalance:
              rType === REQUIREMENT_TYPE.NativeBalance
                ? formatEther(raw)
                : rType === REQUIREMENT_TYPE.TokenBalance
                  ? toAmountInput(raw, await fetchTokenDecimals(publicClient, chainId, row.asset))
                  : raw.toString(),
          }
        })
      )
      seededPaymentPrice = hasValidPaymentRequirement
        ? toAmountInput(savedPaymentPrice, await fetchTokenDecimals(publicClient, chainId, savedPaymentToken))
        : ''
    } catch (err) {
      console.error('Failed to read the decimals of this community’s gating assets:', err)
      alert('Could not load this community’s token settings right now. Please try again in a moment.')
      return
    }

    setEditName(metadata.name || '')
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
    setEditRequirementMode(Number(requirementModeData ?? 0))
    setPaymentTokenAddress(isPaymentNative ? '' : savedPaymentToken)
    setPaymentPrice(seededPaymentPrice)
    setPaymentIsLsp7(savedPaymentIsLsp7)
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

    // Amounts convert first, before anything is uploaded or signed: every one of them is entered
    // in whole units of the asset it gates on, so each needs that asset's decimals, and a failed
    // read here must abort the whole save rather than leave the metadata already updated.
    let editedTuples
    let priceValue
    try {
      editedTuples = await Promise.all(
        editRequirements.map(async (row) => ({
          rType: row.rType,
          asset: row.asset || ZERO_ADDRESS,
          // NFT minimums are plain collection counts — they scale by nothing
          minBalance:
            row.rType === REQUIREMENT_TYPE.NativeBalance
              ? parseEther(row.minBalance || '0')
              : row.rType === REQUIREMENT_TYPE.TokenBalance
                ? parseUnits(row.minBalance || '0', await fetchTokenDecimals(publicClient, chainId, row.asset))
                : BigInt(row.minBalance || '0'),
        }))
      )
      if (editAdmission === ADMISSION.PayToJoin && paymentPrice) {
        priceValue = paymentTokenAddress
          ? parseUnits(paymentPrice, await fetchTokenDecimals(publicClient, chainId, paymentTokenAddress))
          : parseEther(paymentPrice)
      }
    } catch (err) {
      console.error('Failed to convert the entered amounts to their onchain units:', err)
      alert('Could not read the decimals of one of the tokens you entered. Check the address and try again.')
      return
    }

    // Same omit-when-empty rule the create modal uses: clearing every field drops the key
    // rather than writing an empty array
    const updatedLinks = buildLinks(editSocials, editExtraLinks)

    const updatedMetadataObj = {
      name: editName,
      summary: editSummary,
      description: editDescription,
      'logo url': editLogoUrl,
      'cover url': editCoverUrl,
      ...(updatedLinks.length > 0 ? { links: updatedLinks } : {}),
    }

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
    const onchainKey = JSON.stringify(
      requirementsList.map((r) => [Number(r.rType), r.asset.toLowerCase(), r.minBalance?.toString()])
    )
    const editedKey = JSON.stringify(editedTuples.map((r) => [r.rType, r.asset.toLowerCase(), r.minBalance.toString()]))
    const modeChanged = editRequirements.length > 1 && Number(requirementModeData ?? 0) !== editRequirementMode
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
        args: [id, paymentTokenAddress || ZERO_ADDRESS, priceValue, paymentIsLsp7],
      })
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
        disabled={!isActive || (cType === 1 && !isModerator) || myCanPostLive === false}
        title={
          !isActive
            ? 'This space is archived — reactivate it to post'
            : cType === 1 && !isModerator
              ? 'This is a Broadcast channel — only the creator/moderators can post'
              : myCanPostLive === false
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
      {!isOwner && !isMember && admission === ADMISSION.RequestApproval && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={!isActive || isJoinPending || Boolean(myPendingRequest)}
          onClick={handleRequestAccess}
        >
          {isJoinPending ? 'Requesting...' : myPendingRequest ? 'Request Pending' : 'Request Access'}
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
          {Number(requirementModeData ?? 0) === 1 ? 'ANY of' : 'ALL of'}
        </span>
      )}
      {requirementsList.map((req, index) => {
        const rType = Number(req.rType)
        if (rType === REQUIREMENT_TYPE.NftBalance)
          return <NftTag key={index} tokenAddress={req.asset} chainId={chainId} minBalance={req.minBalance?.toString()} />
        if (rType === REQUIREMENT_TYPE.TokenBalance)
          return (
            <TokenRequirementTag
              key={index}
              address={req.asset}
              chainId={chainId}
              minBalance={req.minBalance}
              className={styles.card__tag}
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
                        ? 'Checked by the contract when you join — meeting them admits you instantly'
                        : 'Your wallet must meet these to participate here'
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
                    <h3 className={styles.card__title}>{metadata.name || `Community #${id}`}</h3>
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

          {joinError && <div className={styles.card__error}>Error: {joinError.shortMessage || joinError.message}</div>}

          {statusError && <div className={styles.card__error}>Error: {statusError.shortMessage || statusError.message}</div>}

          {banError && banningAddress === activeAccountAddress && (
            <div className={styles.card__error}>Error: {banError.shortMessage || banError.message}</div>
          )}

          {payToJoinError && <div className={styles.card__error}>Error: {payToJoinError.shortMessage || payToJoinError.message}</div>}

          {/* Member of an encrypted community without a working key mailbox (locked vault or
              unregistered identity): tell THEM directly — moderators can't deliver a key to a
              wallet with no registered public key, and shouldn't have to chase members 1:1.
              VaultUnlockPrompt renders the right action for whichever half is missing. */}
          {isMember && isEncryptionInitialized && (!vault.identity || vault.needsRegistration) && <VaultUnlockPrompt vault={vault} />}

          {/* Two-step invite, invitee side: a moderator invited this wallet, but membership is a
              public onchain signal — it only happens if the viewer accepts here themselves */}
          {Boolean(myInviteData) && !isMember && (
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
                  onClick={() =>
                    respondInvite({
                      address: CONTRACT_ADDRESS,
                      chainId,
                      abi: HupCommunityABI,
                      functionName: 'acceptInvite',
                      args: [id],
                    })
                  }
                >
                  {isInviteRespPending ? 'Confirm Wallet...' : 'Accept & Join'}
                </button>
                <button
                  type="button"
                  className={styles.card__cancelBtn}
                  disabled={isInviteRespPending}
                  onClick={() =>
                    respondInvite({
                      address: CONTRACT_ADDRESS,
                      chainId,
                      abi: HupCommunityABI,
                      functionName: 'declineInvite',
                      args: [id],
                    })
                  }
                >
                  Decline
                </button>
              </div>
              {inviteRespError && (
                <div className={styles.card__error}>Error: {inviteRespError?.shortMessage || inviteRespError?.message}</div>
              )}
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
                <div className={styles.feed__list}>
                  {communityPosts.map((post, i) => (
                    // Same open-on-click affordance as the home/trending feeds: the row
                    // navigates to the post's thread view (text selection doesn't trigger it)
                    <div
                      key={post.id}
                      className="animate fade pointer"
                      onPointerDown={rememberCardPointerDown}
                      onClick={(e) => {
                        if (isTextSelectionDrag(e)) return
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
          title={`Manage Members — ${metadata.name || `Space #${id}`}`}
          cancelLabel="Close"
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
            {inviteError && <div className={styles.card__error}>Error: {inviteError?.shortMessage || inviteError?.message}</div>}
            {members.length === 0 ? (
              <p className={styles.feed__empty}>No members found yet.</p>
            ) : (
              members.map((member) => (
                <div key={member.address} className="flex justify-content-between align-items-center gap-050" style={{ padding: '0.5rem 0' }}>
                  <div className="flex align-items-center gap-050">
                    <Profile creator={member.address} networkId={chainId} variant="fullWithoutTime" />
                    {member.address.toLowerCase() === creator.toLowerCase() && <span className={styles.card__tag}>Creator</span>}
                    {member.isBanned && <span className={styles.card__tag}>Banned</span>}
                  </div>
                  {member.address.toLowerCase() !== creator.toLowerCase() &&
                    (member.isBanned ? (
                      <button
                        type="button"
                        className={styles.card__editBtn}
                        disabled={isUnbanPending && banningAddress === member.address}
                        onClick={() => handleUnban(member.address)}
                      >
                        {isUnbanPending && banningAddress === member.address ? 'Unbanning...' : 'Unban'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.card__cancelBtn}
                        disabled={isBanPending && banningAddress === member.address}
                        onClick={() => handleBan(member.address)}
                      >
                        {isBanPending && banningAddress === member.address ? 'Banning...' : 'Ban'}
                      </button>
                    ))}
                </div>
              ))
            )}
          </div>

          {/* Join-fee earnings: paid joins accrue to an onchain ledger (pull-over-push, so a
              non-payable creator address can never brick admissions) — withdraw from here.
              The ledger is per-creator across all their communities on this contract. */}
          {isOwner && Boolean(joinPayoutsData) && joinPayoutsData > 0n && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Earnings</h5>
              <div className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Collected join fees (all your communities): {formatEther(joinPayoutsData)} {nativeCurrency.symbol}
                </span>
                <button
                  type="button"
                  className={styles.card__submit}
                  style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                  disabled={isWithdrawPending || isWithdrawConfirming}
                  onClick={() =>
                    withdrawPayouts({
                      address: CONTRACT_ADDRESS,
                      chainId,
                      abi: HupCommunityABI,
                      functionName: 'withdrawJoinPayouts',
                      args: [],
                    })
                  }
                >
                  {isWithdrawPending ? 'Confirm Wallet...' : isWithdrawConfirming ? 'Withdrawing...' : 'Withdraw'}
                </button>
              </div>
              {withdrawError && <div className={styles.card__error}>Error: {withdrawError?.shortMessage || withdrawError?.message}</div>}
            </div>
          )}

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
              {governorError && (
                <div className={styles.card__error}>Error: {governorError?.shortMessage || governorError?.message}</div>
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
              {whitelistError && <div className={styles.card__error}>Error: {whitelistError?.shortMessage || whitelistError?.message}</div>}
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

          {(approveError || banError || unbanError) && (
            <div className={styles.card__error}>
              Error:{' '}
              {`${approveError?.shortMessage || ''}${approveError?.message || ''}`.match(/NoPendingRequest|0xcc2c06e8/)
                ? 'This request no longer exists onchain — the wallet’s join transaction never confirmed. The stale entry was removed; they can request again.'
                : approveError?.shortMessage ||
                  approveError?.message ||
                  banError?.shortMessage ||
                  banError?.message ||
                  unbanError?.shortMessage ||
                  unbanError?.message}
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
        <DialogHeader title={`Modify ${metadata.name || `Space #${id}`}`} onCancel={() => setIsEditing(false)} />
        <form className={clsx(styles.cardDialog__body, styles.card__form)} onSubmit={handleUpdateSubmit}>

          <div className={styles.card__row}>
            <div className={styles.card__field}>
              <label className={styles.card__label}>Membership rule</label>
              <select
                className={styles.card__select}
                value={editAdmission}
                onChange={(e) => setEditAdmission(Number(e.target.value))}
              >
                {ADMISSION_OPTIONS.map((option) => {
                  // Same rule as the create modal — self-serve with no requirements admits
                  // exactly who Open does. Exempt when it's already the community's mode: this
                  // form writes the enum onchain, so silently downgrading it isn't ours to do.
                  const locked =
                    option.value === ADMISSION.SelfServeIfEligible &&
                    editRequirements.length === 0 &&
                    editAdmission !== ADMISSION.SelfServeIfEligible
                  return (
                    <option key={option.value} value={option.value} disabled={locked} title={locked ? SELF_SERVE_HINTS.locked : option.note}>
                      {locked ? `${option.label} ${SELF_SERVE_HINTS.lockedSuffix}` : option.label}
                    </option>
                  )
                })}
              </select>
              <p className={styles.optionNote}>{ADMISSION_OPTIONS[editAdmission]?.note}</p>
              {editAdmission === ADMISSION.SelfServeIfEligible && editRequirements.length === 0 && (
                <p className={clsx(styles.optionNote, styles['optionNote--warn'])}>{SELF_SERVE_HINTS.redundant}</p>
              )}
            </div>

            <div className={styles.card__field}>
              <label className={styles.card__label}>Channel type</label>
              <select
                className={styles.card__select}
                value={editCommunityType}
                onChange={(e) => setEditCommunityType(Number(e.target.value))}
              >
                {COMMUNITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className={styles.optionNote}>{COMMUNITY_TYPE_OPTIONS[editCommunityType]?.note}</p>
            </div>
          </div>

          {/* Composable requirement editor — same rows as the create modal. Works with
              ERC-721/LSP8 collections and ERC-20/LSP7 tokens (balanceOf is selector-compatible
              in both pairs). */}
          <div className={styles.card__field}>
            <label className={styles.card__label}>Requirements — what members must hold or be (optional)</label>
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
                    {REQUIREMENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {meta?.needsAsset && (
                    <input
                      className={styles.card__input}
                      style={{ flex: 1, minWidth: '180px' }}
                      placeholder="0x... contract address"
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
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Pay to Join Configuration</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem' }}>
                Payment goes straight to your wallet at join time. Leave the token address blank to price in {nativeCurrency.symbol || 'the native coin'}; fill it in to price in an ERC-20 or LSP7 token — check the LSP7 box below if it's an LSP7 asset, since its
                transfer mechanism differs from ERC-20's. Either way the price is a whole-token amount, exactly as a holder would say it.
              </p>
              <div className={styles.card__field}>
                <label className={styles.card__label}>Payment token address (blank = native coin)</label>
                <input
                  className={styles.card__input}
                  placeholder="0x... (leave blank for native coin)"
                  value={paymentTokenAddress}
                  onChange={(e) => setPaymentTokenAddress(e.target.value)}
                />
              </div>
              {paymentTokenAddress && (
                <div
                  className={styles.card__field}
                  style={{ marginTop: '0.5rem', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}
                >
                  <input type="checkbox" id="paymentIsLsp7" checked={paymentIsLsp7} onChange={(e) => setPaymentIsLsp7(e.target.checked)} />
                  <label htmlFor="paymentIsLsp7" className={styles.card__label} style={{ margin: 0 }}>
                    This token is an LSP7 asset (not ERC-20)
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
            </div>
          )}

          <div className={styles.card__field}>
            <label className={styles.card__label}>Name</label>
            <input className={styles.card__input} value={editName} onChange={(e) => setEditName(e.target.value)} required />
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

          {(updateHash || requirementsHash || paymentReqHash) && (
            <div className={styles.card__monitor}>
              {updateHash && (
                <p className={styles.card__tx}>
                  Metadata Tx: <span>{updateHash}</span>
                </p>
              )}
              {requirementsHash && (
                <p className={styles.card__tx}>
                  Requirements Tx: <span>{requirementsHash}</span>
                </p>
              )}
              {paymentReqHash && (
                <p className={styles.card__tx}>
                  Payment Requirement Tx: <span>{paymentReqHash}</span>
                </p>
              )}
              {(isUpdateConfirming || isRequirementsConfirming || isPaymentReqConfirming) && (
                <p className={styles.card__status}>Waiting for confirmation...</p>
              )}
              {isUpdateConfirmed &&
                (!requirementsHash || isRequirementsConfirmed) &&
                (editAdmission !== ADMISSION.PayToJoin || !paymentReqHash || isPaymentReqConfirmed) && (
                  <p className={clsx(styles.card__status, styles['card__status--success'])}>Changes committed onchain!</p>
                )}
            </div>
          )}

          {(updateError || requirementsError || paymentReqError) && (
            <div className={styles.card__error}>
              Error:{' '}
              {updateError?.shortMessage ||
                updateError?.message ||
                requirementsError?.shortMessage ||
                requirementsError?.message ||
                paymentReqError?.shortMessage ||
                paymentReqError?.message}
            </div>
          )}
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

  const fetchDirectory = async (page = 1, append = false) => {
    if (isAllNetworks ? communityChains.length === 0 : !directoryNetworkId || !directoryContractAddress) return
    const fetchSeq = ++directoryFetchSeqRef.current
    setIsDirectoryLoading(true)
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
    } catch (err) {
      if (fetchSeq !== directoryFetchSeqRef.current) return
      console.error('Failed to load community directory from cidex:', err)
      setDirectoryError(err.message || 'Failed to load communities')
    } finally {
      if (fetchSeq === directoryFetchSeqRef.current) setIsDirectoryLoading(false)
    }
  }

  useEffect(() => {
    fetchDirectory(1, false)
  }, [selectedNetworkId, directoryContractAddress, searchQuery, visibilityFilter, activeAccountAddress])

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

            {directoryError && <div className={styles.manager__error}>Failed to load community directory: {directoryError}</div>}

            <div className={clsx(styles.directory__grid, isDirectoryLoading && styles['directory__grid--loading'])}>
              {communityRows.length === 0 && !isDirectoryLoading ? (
                <p className={styles.directory__empty}>
                  {searchQuery
                    ? 'No communities match your search.'
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
            onCreated={() => {
              // Best-effort directory refresh — subject to cidex's indexing lag, same as the
              // global post feed, so the new entry may take a few seconds to show
              fetchDirectory(1, false)
              createModalRef.current?.close()
            }}
          />
        </div>
      </div>
    </>
  )
}
