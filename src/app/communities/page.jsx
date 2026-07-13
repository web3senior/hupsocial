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
import { formatEther, parseEther } from 'viem'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageTitle from '@/components/PageTitle'
import Profile from '@/components/Profile'
import NativePopover from '@/components/ui/NativePopover'
import { DotsThreeIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
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
  isEncryptedMembershipType,
} from '@/lib/communityVault'
import { getActiveChain } from '@/lib/communication'
import { config, CONTRACTS } from '@/config/wagmi'
import { getPosts } from '@/lib/api'
import { getIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import ImagePicker from './_components/ImagePicker'
import CreateCommunityModal from './_components/CreateCommunityModal'
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

// Dedicated presentation sub-component to isolate ERC-721 naming hooks safely
function NftTag({ tokenAddress, minBalance }) {
  const { data: nftName } = useReadContract({
    address: tokenAddress,
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
export function CommunityCard({ id, networkId = null, hideHeader = false }) {
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
  const [editMembershipType, setEditMembershipType] = useState(0)
  const [editCommunityType, setEditCommunityType] = useState(0)

  // NFT Requirement Input States
  const [nftContractAddress, setNftContractAddress] = useState('')
  const [minNftBalance, setMinNftBalance] = useState('1')

  // Token Requirement Input States (address(0) tokenAddress means the native coin)
  const [tokenContractAddress, setTokenContractAddress] = useState('')
  const [minTokenBalance, setMinTokenBalance] = useState('1')

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
  const [approvingAddress, setApprovingAddress] = useState(null)
  const [banningAddress, setBanningAddress] = useState(null)
  const [whitelistEntries, setWhitelistEntries] = useState([])
  const [newWhitelistAddress, setNewWhitelistAddress] = useState('')
  const [removingWhitelistAddress, setRemovingWhitelistAddress] = useState(null)

  // Lazy key-delivery state: pending 'grant' requests (members missing the current-version
  // envelope) and whether a rotation is pending (someone self-left; only a moderator can rotate)
  const [keyRequests, setKeyRequests] = useState([])
  const [isGrantingBatch, setIsGrantingBatch] = useState(false)
  const [isTogglingHistory, setIsTogglingHistory] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)
  // Three-dot menu view: 'root' (Members/Modify/Archive) or 'members' (the member list)
  const [menuView, setMenuView] = useState('root')

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
  const membershipType = data ? Number(data[2]) : null
  const cType = data ? Number(data[3]) : null
  const isActive = data ? Boolean(data[5]) : true
  const isOwner = Boolean(activeAccountAddress && creator && activeAccountAddress.toLowerCase() === creator.toLowerCase())
  const isEncryptedType = isEncryptedMembershipType(membershipType)

  // Read data directly from the automatically generated public mapping getter
  const { data: nftRequirementData, refetch: refetchNftRequirements } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'nftRequirements',
    args: [id],
  })

  const { data: tokenRequirementData, refetch: refetchTokenRequirements } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'tokenRequirements',
    args: [id],
  })

  const { data: paymentRequirementData, refetch: refetchPaymentRequirement } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'paymentRequirements',
    args: [id],
  })

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

  // Live whitelist check — lets the "Join" button for WhitelistGated communities disable itself
  // proactively instead of letting the viewer submit a join() that's guaranteed to revert
  const { data: amIWhitelisted } = useReadContract({
    address: CONTRACT_ADDRESS,
    chainId,
    abi: HupCommunityABI,
    functionName: 'whitelist',
    args: [id, activeAccountAddress],
    query: { enabled: !!activeAccountAddress && membershipType === 6 },
  })

  // Joining a Request-Based community (join() is a no-op on-chain for Private/NFT/Token-Gated —
  // see handleRequestAccess for how those are handled instead)
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

  // Contract modification hook for setting NFT configuration requirements
  const { mutate: updateNftRequirement, data: nftHash, isPending: isNftPending, error: nftError } = useWriteContract()

  const { isLoading: isNftConfirming, isSuccess: isNftConfirmed } = useWaitForTransactionReceipt({ hash: nftHash })

  // Contract modification hook for setting Token configuration requirements
  const { mutate: updateTokenRequirement, data: tokenReqHash, isPending: isTokenReqPending, error: tokenReqError } = useWriteContract()

  const { isLoading: isTokenReqConfirming, isSuccess: isTokenReqConfirmed } = useWaitForTransactionReceipt({ hash: tokenReqHash })

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

  const { mutate: grantKeyToMember, data: grantHash } = useWriteContract()
  useWaitForTransactionReceipt({ hash: grantHash })

  const approveHandledRef = useRef(null)

  // --- Member management: ban + key rotation ---

  const { mutate: banMember, data: banHash, isPending: isBanPending, error: banError } = useWriteContract()
  const { isSuccess: isBanConfirmed } = useWaitForTransactionReceipt({ hash: banHash })

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

  // Refresh NFT requirement state on successful block confirmation
  useEffect(() => {
    if (isNftConfirmed) {
      refetchNftRequirements()
    }
  }, [isNftConfirmed, refetchNftRequirements])

  // Refresh Token requirement state on successful block confirmation
  useEffect(() => {
    if (isTokenReqConfirmed) {
      refetchTokenRequirements()
    }
  }, [isTokenReqConfirmed, refetchTokenRequirements])

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

  const isRequestableMembershipType =
    membershipType === 1 || membershipType === 3 || membershipType === 4 || membershipType === 5 || membershipType === 8

  useEffect(() => {
    if (isRequestableMembershipType) {
      refetchPendingRequests()
    }
  }, [isRequestableMembershipType, chainId, id])

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

  // WhitelistGated is self-service: join() either succeeds immediately or reverts with
  // NotWhitelisted — there's no "pending" state to track off-chain like RequestBased/NFT/Token
  // gated need, so this stays a separate handler rather than folding into handleRequestAccess.
  const handleJoinWhitelisted = () => {
    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      args: [id],
    })
  }

  // Pay to Join is also self-service, like WhitelistGated, but pays first: native coin goes
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

  // Public communities still require an explicit join() — the contract's canPost() checks the
  // roster's canPost flag even for Public, and cidex mirrors that check before tagging a post
  // with a community. Without joining first, a post would publish untagged (no community badge).
  const handleJoinPublic = () => {
    if (!activeAccountAddress || !chainId) return
    joinCommunity({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'join',
      args: [id],
    })
  }

  const handleRequestAccess = async () => {
    if (!activeAccountAddress || !chainId) return

    if (membershipType === 1) {
      joinCommunity({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'join',
        args: [id],
      })
    }

    // join() is a no-op on-chain for NFT/Token-Gated (no roster branch in HupCommunity.sol), so
    // the off-chain request is the only signal a moderator has to go grant access
    try {
      await fetch('/api/communities/join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: chainId, communityId: id, walletAddress: activeAccountAddress }),
      })
      refetchPendingRequests()
    } catch (err) {
      console.error('Failed to record the access request:', err)
    }
  }

  useEffect(() => {
    if (isJoinConfirmed) {
      refetchMyStatus()
      refetchMyCanPost()
    }
  }, [isJoinConfirmed, refetchMyStatus, refetchMyCanPost])

  // Refresh the on-chain community row once an update confirms — membershipType drives the
  // composer's encrypt-or-not decision, so it must not stay stale after a type change.
  useEffect(() => {
    if (isUpdateConfirmed) refetchCommunity()
  }, [isUpdateConfirmed, refetchCommunity])

  // Plaintext → encrypted type change: once updateCommunity confirms, initialize the encryption
  // key (keyVersion 0 → 1) by wrapping a fresh content key to the creator's own identity — the
  // same wrap creation performs atomically. Without this the community *claims* to be private
  // but keeps posting plaintext. initializeKey is creator-only and one-shot on the contract, so
  // the guards mirror that instead of discovering it via a revert.
  const initKeyHandledRef = useRef(null)
  useEffect(() => {
    const run = async () => {
      if (!isUpdateConfirmed || initKeyHandledRef.current === updateHash) return
      if (!isOwner || isEncryptionInitialized || !isEncryptedMembershipType(editMembershipType)) return
      if (!vault.identity) {
        // Vault got locked between submit and confirmation — reprompt; the effect re-runs once
        // the identity is derived (it's in the dependency list), so nothing is lost.
        vault.setShowPinPrompt(true)
        return
      }
      initKeyHandledRef.current = updateHash

      try {
        await writeVaultAsync({
          address: CONTRACT_ADDRESS,
          abi: HupCommunityABI,
          functionName: 'initializeKey',
          args: [id, wrapContentKey(generateContentKey(), vault.identity.pubKeyHex)],
        })
        refetchKeyVersion()
      } catch (err) {
        console.error('Failed to initialize the community encryption key after the type change:', err)
      }
    }
    run()
  }, [isUpdateConfirmed, updateHash, isOwner, isEncryptionInitialized, editMembershipType, vault.identity])

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
        if (membershipType === 6) refetchWhitelist()
      }
    }
  }, [isManagingMembers, id, isApproveConfirmed, isBanConfirmed, membershipType, isModerator])

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
    const cid = data[4]

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
    return <div className={clsx(styles.card, styles['card--loading'])}>Loading space #{id}...</div>
  }

  const membershipLabels = [
    'Public',
    'Request-Based',
    'Private',
    'NFT-Gated',
    'Token-Gated',
    'NFT + Token Gated',
    'Whitelisted',
    'Pay to Join',
    'Follower-Gated',
  ]
  const typeLabels = ['Discussion', 'Broadcast']

  // Auto-generated mapping getters return fields in structural definition order
  // This layout structure maps fields as: [address tokenAddress, uint256 minimumBalance]
  const savedNftAddress = nftRequirementData ? nftRequirementData[0] : null
  const savedNftMinBalance = nftRequirementData ? nftRequirementData[1]?.toString() : null
  const hasValidNftAddress = savedNftAddress && savedNftAddress !== '0x0000000000000000000000000000000000000000'

  const savedTokenAddress = tokenRequirementData ? tokenRequirementData[0] : null
  const savedTokenMinBalance = tokenRequirementData ? tokenRequirementData[1]?.toString() : null
  const hasValidTokenRequirement = tokenRequirementData && savedTokenMinBalance !== '0'

  const savedPaymentToken = paymentRequirementData ? paymentRequirementData[0] : null
  const savedPaymentPrice = paymentRequirementData ? paymentRequirementData[1]?.toString() : null
  const savedPaymentIsLsp7 = Boolean(paymentRequirementData?.[2])
  const hasValidPaymentRequirement = paymentRequirementData && savedPaymentPrice !== '0'
  const isPaymentNative = !savedPaymentToken || savedPaymentToken === '0x0000000000000000000000000000000000000000'

  const handleStartEditing = () => {
    setEditName(metadata.name || '')
    setEditSummary(metadata.summary || '')
    setEditDescription(metadata.description || '')
    setEditLogoUrl(metadata['logo url'] || '')
    setEditCoverUrl(metadata['cover url'] || '')
    setEditMembershipType(membershipType)
    setEditCommunityType(cType)
    setNftContractAddress(savedNftAddress || '')
    setMinNftBalance(savedNftMinBalance || '1')
    setTokenContractAddress(
      savedTokenAddress && savedTokenAddress !== '0x0000000000000000000000000000000000000000' ? savedTokenAddress : ''
    )
    setMinTokenBalance(savedTokenMinBalance || '1')
    setPaymentTokenAddress(isPaymentNative ? '' : savedPaymentToken)
    setPaymentPrice(savedPaymentPrice || '')
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

    // Switching a plaintext community to an encrypted type needs the vault unlocked up front:
    // right after the type change confirms, a follow-up initializeKey tx (see the effect below)
    // wraps a fresh content key to the creator's identity. Creation does this atomically via
    // createCommunity's initialWrappedKey param — updateCommunity has no key parameter.
    if (isEncryptedMembershipType(editMembershipType) && !isEncryptionInitialized && !vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }

    const updatedMetadataObj = {
      name: editName,
      summary: editSummary,
      description: editDescription,
      'logo url': editLogoUrl,
      'cover url': editCoverUrl,
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
      args: [id, editMembershipType, editCommunityType, updatedMetadataCid],
    })

    // Trigger update rule targeting public mapping setter when membership rule needs an NFT check
    if ((editMembershipType === 3 || editMembershipType === 5) && nftContractAddress) {
      updateNftRequirement({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setNftRequirement',
        args: [id, nftContractAddress, BigInt(minNftBalance)],
      })
    }

    // Trigger update rule targeting public mapping setter when membership rule needs a token check
    if (editMembershipType === 4 || editMembershipType === 5) {
      updateTokenRequirement({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setTokenRequirement',
        args: [id, tokenContractAddress || '0x0000000000000000000000000000000000000000', BigInt(minTokenBalance || '1')],
      })
    }

    // Trigger update rule targeting public mapping setter when membership rule is Pay to Join.
    // Native-coin prices are entered in whole coin units (parseEther); token prices are entered
    // directly in the token's smallest unit, same convention as the NFT/Token min-balance fields.
    if (editMembershipType === 7 && paymentPrice) {
      const priceValue = paymentTokenAddress ? BigInt(paymentPrice) : parseEther(paymentPrice)
      updatePaymentRequirement({
        address: CONTRACT_ADDRESS,
        chainId,
        abi: HupCommunityABI,
        functionName: 'setPaymentRequirement',
        args: [id, paymentTokenAddress || '0x0000000000000000000000000000000000000000', priceValue, paymentIsLsp7],
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

  const handleAddToWhitelist = (e) => {
    e.preventDefault()
    if (!newWhitelistAddress) return

    setWhitelistedContract({
      address: CONTRACT_ADDRESS,
      chainId,
      abi: HupCommunityABI,
      functionName: 'setWhitelisted',
      args: [id, newWhitelistAddress, true],
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
          if (!memberPubKey || memberPubKey === '0x') continue // no mailbox yet — leave the request pending

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
      {!isOwner && !isMember && membershipType === 0 && (
        <button type="button" className={styles.card__editBtn} disabled={!isActive || isJoinPending} onClick={handleJoinPublic}>
          {isJoinPending ? 'Joining...' : 'Join'}
        </button>
      )}
      {!isOwner && !isMember && isRequestableMembershipType && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={
            !isActive ||
            isJoinPending ||
            Boolean(myPendingRequest) ||
            ((membershipType === 3 || membershipType === 4 || membershipType === 5 || membershipType === 8) && !myCanPostLive)
          }
          onClick={handleRequestAccess}
        >
          {isJoinPending
            ? 'Requesting...'
            : myPendingRequest
              ? 'Request Pending'
              : (membershipType === 3 || membershipType === 4 || membershipType === 5 || membershipType === 8) && !myCanPostLive
                ? `Requires ${membershipType === 3 ? 'NFT' : membershipType === 4 ? 'Token' : membershipType === 5 ? 'NFT + Token' : 'Follow'}`
                : 'Request Access'}
        </button>
      )}
      {!isOwner && !isMember && membershipType === 6 && (
        <button
          type="button"
          className={styles.card__editBtn}
          disabled={!isActive || isJoinPending || amIWhitelisted === false}
          title={amIWhitelisted === false ? "Your wallet is not on this space's whitelist" : undefined}
          onClick={handleJoinWhitelisted}
        >
          {isJoinPending ? 'Joining...' : amIWhitelisted === false ? 'Not Whitelisted' : 'Join'}
        </button>
      )}
      {!isOwner && !isMember && membershipType === 7 && (
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
              : `Pay ${isPaymentNative ? formatEther(BigInt(savedPaymentPrice || '0')) : savedPaymentPrice} & Join`}
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
      {/* Post.jsx-style three-dot menu holding the management actions; the Members item swaps
          the popover to the member-list view (AddTabMenu's view-switching pattern) */}
      {isModerator && (
        <NativePopover
          placement="bottom-end"
          trigger={
            <button type="button" className={styles.card__editBtn} aria-label="Community options">
              <DotsThreeIcon size={16} />
            </button>
          }
          onToggle={(e) => {
            if (e.newState === 'closed') setMenuView('root')
          }}
        >
          {({ close }) => (
            <div className={styles.card__membersPopover}>
              {menuView === 'root' && (
                <>
                  <button
                    type="button"
                    className={styles.card__menuItem}
                    onClick={() => {
                      refetchMembers()
                      setMenuView('members')
                    }}
                  >
                    Members
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      className={styles.card__menuItem}
                      onClick={() => {
                        close()
                        handleStartEditing()
                      }}
                    >
                      Modify
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      className={styles.card__menuItem}
                      disabled={isStatusPending || isStatusConfirming}
                      onClick={() => {
                        close()
                        handleToggleStatus()
                      }}
                    >
                      {isStatusPending || isStatusConfirming ? 'Confirm Wallet...' : isActive ? 'Archive' : 'Reactivate'}
                    </button>
                  )}
                </>
              )}

              {menuView === 'members' && (
                <>
                  <button type="button" className={styles.card__menuItem} onClick={() => setMenuView('root')}>
                    ← Back
                  </button>
                  {members.length === 0 ? (
                    <p className={styles.feed__empty}>No members found yet.</p>
                  ) : (
                    members.map((member) => (
                      <div
                        key={member.address}
                        className="flex justify-content-between align-items-center gap-050"
                        style={{ padding: '0.35rem 0' }}
                      >
                        <Profile creator={member.address} networkId={chainId} variant="fullWithoutTime" />
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
                  <button
                    type="button"
                    className={styles.card__editBtn}
                    style={{ width: '100%', marginTop: '0.5rem' }}
                    onClick={() => {
                      close()
                      setIsManagingMembers(true)
                      setIsEditing(false)
                      setIsPosting(false)
                    }}
                  >
                    Manage community
                  </button>
                </>
              )}
            </div>
          )}
        </NativePopover>
      )}
    </>
  )

  // isPosting no longer expands the card — the composer is the app-wide NewPost fixed popup
  const isExpanded = isEditing || isManagingMembers

  return (
    <div className={hideHeader ? undefined : styles.card} style={!hideHeader && isExpanded ? { gridColumn: '1 / -1' } : undefined}>
      {!isEditing && !isManagingMembers && (
        <>
          {hideHeader ? (
            <div className={styles.card__actionRow} style={{ marginBottom: '1.25rem' }}>
              {actionButtons}
            </div>
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
                      By {creator.slice(0, 6)}...{creator.slice(-4)}
                    </span>
                  </div>
                </div>

                <p className={styles.card__summary}>{metadata.summary || metadata.description}</p>

                <div className={styles.card__tags} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <span className={styles.card__tag}>{membershipLabels[membershipType]}</span>
                  <span className={styles.card__tag}>{typeLabels[cType]}</span>
                  {!isActive && (
                    <span className={styles.card__tag} title="This space is archived — no new posts or joins until reactivated">
                      Archived
                    </span>
                  )}
                  {isEncryptedType && (
                    <span className={styles.card__tag} title="Post content is end-to-end encrypted for members">
                      {isEncryptionInitialized ? '🔒 Encrypted' : '🔒 Encryption pending'}
                    </span>
                  )}

                  {/* Render the extracted sub-component to eliminate the rule-of-hooks error */}
                  {(membershipType === 3 || membershipType === 5) && hasValidNftAddress && (
                    <NftTag tokenAddress={savedNftAddress} minBalance={savedNftMinBalance} />
                  )}
                  {(membershipType === 4 || membershipType === 5) && hasValidTokenRequirement && (
                    <span className={styles.card__tag} title={`Contract: ${savedTokenAddress}`}>
                      Token: min {savedTokenMinBalance}{' '}
                      {savedTokenAddress === '0x0000000000000000000000000000000000000000' ? 'native coin' : ''}
                    </span>
                  )}
                  {membershipType === 7 && hasValidPaymentRequirement && (
                    <span className={styles.card__tag} title={isPaymentNative ? undefined : `Contract: ${savedPaymentToken}`}>
                      💰 {isPaymentNative ? `${formatEther(BigInt(savedPaymentPrice || '0'))} native coin` : `${savedPaymentPrice} (token)`}{' '}
                      to join
                    </span>
                  )}
                </div>
              </Link>

              <div className={styles.card__actionRow}>{actionButtons}</div>
            </>
          )}

          {joinError && <div className={styles.card__error}>Error: {joinError.shortMessage || joinError.message}</div>}

          {statusError && <div className={styles.card__error}>Error: {statusError.shortMessage || statusError.message}</div>}

          {banError && banningAddress === activeAccountAddress && (
            <div className={styles.card__error}>Error: {banError.shortMessage || banError.message}</div>
          )}

          {payToJoinError && <div className={styles.card__error}>Error: {payToJoinError.shortMessage || payToJoinError.message}</div>}

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
                    <div key={post.id} className="animate fade">
                      <PostCard item={post} chainId={chainId} actions={['like', 'comment', 'share', 'repost', 'view', 'bookmark']} />
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
      )}

      {isManagingMembers && (
        <div className={styles.card__form}>
          <div className={styles.card__formHeader}>
            <h4 className={styles.card__formTitle}>Manage Members — {metadata.name || `Space #${id}`}</h4>
            <button type="button" className={styles.card__cancelBtn} onClick={() => setIsManagingMembers(false)}>
              Close
            </button>
          </div>

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
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {isModerator && membershipType === 6 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>Whitelist</h5>
              <form onSubmit={handleAddToWhitelist} className="flex align-items-center gap-050" style={{ marginBottom: '0.75rem' }}>
                <input
                  className={styles.card__input}
                  placeholder="0x... wallet address"
                  value={newWhitelistAddress}
                  onChange={(e) => setNewWhitelistAddress(e.target.value)}
                />
                <button
                  type="submit"
                  className={styles.card__submit}
                  style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                  disabled={isWhitelistPending || !newWhitelistAddress}
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

          {isModerator && isRequestableMembershipType && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem' }}>{membershipType === 1 ? 'Pending Requests' : 'Access Requests'}</h5>
              {pendingRequests.length === 0 ? (
                <p className={styles.feed__empty}>No pending requests.</p>
              ) : (
                pendingRequests.map((req) => (
                  <div key={req.wallet_address} className="flex justify-content-between align-items-center" style={{ padding: '0.5rem 0' }}>
                    <Profile creator={req.wallet_address} networkId={chainId} variant="fullWithoutTime" />
                    <button
                      type="button"
                      className={styles.card__submit}
                      style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
                      disabled={isApprovePending && approvingAddress === req.wallet_address}
                      onClick={() => handleApprove(req.wallet_address)}
                    >
                      {isApprovePending && approvingAddress === req.wallet_address ? 'Approving...' : 'Approve'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {(approveError || banError) && (
            <div className={styles.card__error}>
              Error: {approveError?.shortMessage || approveError?.message || banError?.shortMessage || banError?.message}
            </div>
          )}
        </div>
      )}

      {isEditing && (
        <form className={styles.card__form} onSubmit={handleUpdateSubmit}>
          <div className={styles.card__formHeader}>
            <h4 className={styles.card__formTitle}>Modify {metadata.name || `Space #${id}`}</h4>
            <button type="button" className={styles.card__cancelBtn} onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>

          <div className={styles.card__row}>
            <div className={styles.card__field}>
              <label className={styles.card__label}>Membership rule</label>
              <select
                className={styles.card__select}
                value={editMembershipType}
                onChange={(e) => setEditMembershipType(Number(e.target.value))}
              >
                <option value={0}>Public</option>
                <option value={1}>Request-Based</option>
                <option value={2}>Private (Invite Only)</option>
                <option value={3}>NFT-Gated</option>
                <option value={4}>Token-Gated</option>
                <option value={5}>NFT + Token Gated</option>
                <option value={6}>Whitelisted</option>
                <option value={7}>Pay to Join</option>
                <option value={8}>Follower-Gated</option>
              </select>
            </div>

            <div className={styles.card__field}>
              <label className={styles.card__label}>Channel type</label>
              <select
                className={styles.card__select}
                value={editCommunityType}
                onChange={(e) => setEditCommunityType(Number(e.target.value))}
              >
                <option value={0}>Discussion (Members can post)</option>
                <option value={1}>Broadcast (Read-only for members)</option>
              </select>
            </div>
          </div>

          {/* Conditional Input UI layer for handling smart NFT registration gating configuration properties */}
          {(editMembershipType === 3 || editMembershipType === 5) && (
            <div
              className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')}
              style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>NFT Gating Configuration</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem' }}>
                Works with ERC-721 or LUKSO LSP8 (LSP8's `balanceOf` matches ERC-721's selector).
              </p>
              <div className={styles.card__field}>
                <label className={styles.card__label}>NFT token address</label>
                <input
                  className={styles.card__input}
                  placeholder="0x..."
                  value={nftContractAddress}
                  onChange={(e) => setNftContractAddress(e.target.value)}
                  required={editMembershipType === 3 || editMembershipType === 5}
                />
              </div>
              <div className={styles.card__field} style={{ marginTop: '0.5rem' }}>
                <label className={styles.card__label}>Minimum NFT balance threshold</label>
                <input
                  type="number"
                  className={styles.card__input}
                  placeholder="1"
                  min="1"
                  value={minNftBalance}
                  onChange={(e) => setMinNftBalance(e.target.value)}
                  required={editMembershipType === 3 || editMembershipType === 5}
                />
              </div>
            </div>
          )}

          {/* Conditional Input UI layer for handling token gating configuration properties */}
          {(editMembershipType === 4 || editMembershipType === 5) && (
            <div
              className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')}
              style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Token Gating Configuration</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem' }}>
                Works with the native coin, ERC-20, or LUKSO LSP7 (LSP7's `balanceOf` matches ERC-20's selector). Leave the address blank to
                gate on the native coin balance instead.
              </p>
              <div className={styles.card__field}>
                <label className={styles.card__label}>Token contract address (blank = native coin)</label>
                <input
                  className={styles.card__input}
                  placeholder="0x... (leave blank for native coin)"
                  value={tokenContractAddress}
                  onChange={(e) => setTokenContractAddress(e.target.value)}
                />
              </div>
              <div className={styles.card__field} style={{ marginTop: '0.5rem' }}>
                <label className={styles.card__label}>Minimum token balance threshold</label>
                <input
                  type="number"
                  className={styles.card__input}
                  placeholder="1"
                  min="1"
                  value={minTokenBalance}
                  onChange={(e) => setMinTokenBalance(e.target.value)}
                  required={editMembershipType === 4 || editMembershipType === 5}
                />
              </div>
            </div>
          )}

          {/* Conditional Input UI layer for handling Pay to Join configuration */}
          {editMembershipType === 7 && (
            <div
              className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')}
              style={{ marginTop: '1rem', marginBottom: '1rem' }}
            >
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Pay to Join Configuration</h5>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem' }}>
                Payment goes straight to your wallet at join time. Leave the token address blank to price in the native coin (whole-coin
                units); fill it in to price in an ERC-20 or LSP7 token (smallest unit, e.g. wei for an 18-decimal token) — check the LSP7
                box below if it's an LSP7 asset, since its transfer mechanism differs from ERC-20's.
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
                <label className={styles.card__label}>Price {paymentTokenAddress ? '(smallest unit)' : '(native coin)'}</label>
                <input
                  type="number"
                  step="any"
                  className={styles.card__input}
                  placeholder={paymentTokenAddress ? '1000000000000000000' : '0.01'}
                  min="0"
                  value={paymentPrice}
                  onChange={(e) => setPaymentPrice(e.target.value)}
                  required={editMembershipType === 7}
                />
              </div>
            </div>
          )}

          {isEncryptedMembershipType(editMembershipType) && !isEncryptionInitialized && (!vault.identity || vault.needsRegistration) && (
            <VaultUnlockPrompt vault={vault} />
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

          <button
            type="submit"
            className={styles.card__submit}
            disabled={
              isUpdatePending ||
              isUpdateConfirming ||
              isNftPending ||
              isNftConfirming ||
              isTokenReqPending ||
              isTokenReqConfirming ||
              isPaymentReqPending ||
              isPaymentReqConfirming
            }
          >
            {isUpdatePending || isNftPending || isTokenReqPending || isPaymentReqPending
              ? 'Confirm Wallet...'
              : isUpdateConfirming || isNftConfirming || isTokenReqConfirming || isPaymentReqConfirming
                ? 'Updating Block...'
                : 'Save Configuration'}
          </button>

          {(updateHash || nftHash || tokenReqHash || paymentReqHash) && (
            <div className={styles.card__monitor}>
              {updateHash && (
                <p className={styles.card__tx}>
                  Metadata Tx: <span>{updateHash}</span>
                </p>
              )}
              {nftHash && (
                <p className={styles.card__tx}>
                  NFT Requirement Tx: <span>{nftHash}</span>
                </p>
              )}
              {tokenReqHash && (
                <p className={styles.card__tx}>
                  Token Requirement Tx: <span>{tokenReqHash}</span>
                </p>
              )}
              {paymentReqHash && (
                <p className={styles.card__tx}>
                  Payment Requirement Tx: <span>{paymentReqHash}</span>
                </p>
              )}
              {(isUpdateConfirming || isNftConfirming || isTokenReqConfirming || isPaymentReqConfirming) && (
                <p className={styles.card__status}>Waiting for confirmation...</p>
              )}
              {isUpdateConfirmed &&
                (editMembershipType !== 3 || isNftConfirmed) &&
                (editMembershipType !== 4 || isTokenReqConfirmed) &&
                (editMembershipType !== 5 || (isNftConfirmed && isTokenReqConfirmed)) &&
                (editMembershipType !== 7 || isPaymentReqConfirmed) && (
                  <p className={clsx(styles.card__status, styles['card__status--success'])}>Changes committed on-chain!</p>
                )}
            </div>
          )}

          {(updateError || nftError || tokenReqError || paymentReqError) && (
            <div className={styles.card__error}>
              Error:{' '}
              {updateError?.shortMessage ||
                updateError?.message ||
                nftError?.shortMessage ||
                nftError?.message ||
                tokenReqError?.shortMessage ||
                tokenReqError?.message ||
                paymentReqError?.shortMessage ||
                paymentReqError?.message}
            </div>
          )}
        </form>
      )}

      {/* One editor for the whole app: the same NewPost composer used everywhere, in community
          mode — it seals/tags content for this community and submits on this community's chain */}
      {isPosting && (
        <>
          {isEncryptionInitialized && isEncryptedType && (!vault.identity || vault.needsRegistration) ? (
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
  const chainId = useChainId()
  const { address: activeAccountAddress } = useAccount()

  const [showCreateModal, setShowCreateModal] = useState(false)

  // Chains that actually have a HupCommunity deployment — the network filter's option list
  const communityChains = config.chains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.community)

  // Network filter: defaults to the wallet's chain, browsable to any deployed network.
  // CommunityCard is chain-aware (networkId prop) so cards from other networks read correctly.
  const [selectedNetworkId, setSelectedNetworkId] = useState(null)
  const directoryNetworkId = selectedNetworkId ?? chainId
  const directoryContractAddress = CONTRACTS[`chain${directoryNetworkId}`]?.community

  // Directory is searchable/paginated from cidex's indexed `communities` table (from
  // CommunityCreated/CommunityUpdated events) instead of iterating every on-chain id client-side.
  // HupCommunity.communities(id) stays the source of truth for gating; CommunityCard already
  // reads it directly for anything that actually needs live/authoritative data.
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
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
    if (!directoryNetworkId || !directoryContractAddress) return
    const fetchSeq = ++directoryFetchSeqRef.current
    setIsDirectoryLoading(true)
    try {
      const params = new URLSearchParams({ network_id: directoryNetworkId, contract_address: directoryContractAddress, page, limit: 20 })
      if (searchQuery) params.set('search', searchQuery)
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
  }, [directoryNetworkId, directoryContractAddress, searchQuery, activeAccountAddress])

  const communityIds = communityRows.map((row) => Number(row.id))

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
                value={directoryNetworkId ?? ''}
                onChange={(e) => setSelectedNetworkId(Number(e.target.value))}
                aria-label="Filter communities by network"
              >
                {communityChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <div className="flex align-items-center gap-050">
                <span className={styles.directory__count}>
                  {isDirectoryLoading && directoryPage === 1 ? 'Syncing...' : `${totalCommunities} Total`}
                </span>
                <button type="button" className={styles.createTrigger} onClick={() => setShowCreateModal(true)}>
                  New Community
                </button>
              </div>
            </div>

            {directoryError && <div className={styles.manager__error}>Failed to load community directory: {directoryError}</div>}

            <div className={styles.directory__grid}>
              {communityIds.length === 0 && !isDirectoryLoading ? (
                <p className={styles.directory__empty}>
                  {searchQuery ? 'No communities match your search.' : 'No communities found. Be the first to create one!'}
                </p>
              ) : (
                communityIds.map((id) => <CommunityCard key={`${directoryNetworkId}-${id}`} id={id} networkId={directoryNetworkId} />)
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

          {showCreateModal && (
            <CreateCommunityModal
              vault={vault}
              vaultPrompt={<VaultUnlockPrompt vault={vault} />}
              onClose={() => setShowCreateModal(false)}
              onCreated={() => {
                // Best-effort directory refresh — subject to cidex's indexing lag, same as the
                // global post feed, so the new entry may take a few seconds to show
                fetchDirectory(1, false)
                setShowCreateModal(false)
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}
