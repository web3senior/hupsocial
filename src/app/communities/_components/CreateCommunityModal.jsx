'use client'

// Community creation modal — same NativeDialog primitive as the app's other modals (true
// top-layer modality: click-blocking backdrop, focus trap, native Esc). Entirely separate
// from the NewPost composer: this one deploys a community on HupCommunity, NewPost
// publishes content to Hup core.

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { formatEther, parseEther, decodeEventLog } from 'viem'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import DialogHeader from '@/components/ui/DialogHeader'
import HupCommunityABI from '@/abis/HupCommunity'
import { getActiveChain } from '@/lib/communication'
import { uploadObjectToIPFS } from '@/lib/ipfs'
import { generateContentKey, wrapContentKey, isEncryptedMembershipType } from '@/lib/communityVault'
import ImagePicker from './ImagePicker'
import { MEMBERSHIP_OPTIONS, COMMUNITY_TYPE_OPTIONS } from '../membershipOptions'
import styles from '../page.module.scss'

const CreateCommunityModal = forwardRef(function CreateCommunityModal({ vault, vaultPrompt, onClose, onCreated }, ref) {
  const [, activeChainContracts] = getActiveChain()
  const CONTRACT_ADDRESS = activeChainContracts?.community

  // Stays mounted for the whole page life (like the app's other modals) so a half-filled
  // form survives close/reopen — the parent opens and closes it through this handle
  const dialogRef = useRef(null)
  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [membershipType, setMembershipType] = useState(0)
  const [communityType, setCommunityType] = useState(0)

  // Per-type gating requirements — stored on the contract via follow-up setter txs after
  // createCommunity confirms (the create call itself has no requirement parameters)
  const [nftAddress, setNftAddress] = useState('')
  const [nftMinBalance, setNftMinBalance] = useState('1')
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenMinBalance, setTokenMinBalance] = useState('1')
  const [paymentToken, setPaymentToken] = useState('')
  const [paymentPrice, setPaymentPrice] = useState('')
  const [paymentIsLsp7, setPaymentIsLsp7] = useState(false)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [configError, setConfigError] = useState('')

  const needsNft = membershipType === 3 || membershipType === 5
  const needsToken = membershipType === 4 || membershipType === 5
  const needsPayment = membershipType === 7

  // Community creation fee, set by the contract admin (0 by default) — read live so the form
  // always reflects the actual on-chain requirement instead of assuming it's free
  const { data: creationFeeData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'fee',
  })
  const creationFee = creationFeeData ?? 0n

  // Anti-spam creation cooldown (contract-enforced, per wallet — 1 hour by default): surfaced
  // proactively so the user learns about it from a note instead of a reverted transaction
  const { address: accountAddress } = useAccount()
  const { data: creationCooldownData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'creationCooldown',
  })
  const { data: lastCreatedAtData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'lastCommunityCreatedAt',
    args: [accountAddress],
    query: { enabled: !!accountAddress },
  })

  // Minute-level tick so the remaining-time note counts down while the modal sits open
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  const cooldownRemainingSec = (() => {
    if (!creationCooldownData || !lastCreatedAtData) return 0
    const readyAtMs = (Number(lastCreatedAtData) + Number(creationCooldownData)) * 1000
    return Math.max(0, Math.ceil((readyAtMs - nowTick) / 1000))
  })()

  const { mutate: writeContract, data: hash, isPending, error: createError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })
  const { mutateAsync: writeSetterAsync } = useWriteContract()

  const isCreatingEncrypted = isEncryptedMembershipType(membershipType)

  // createCommunity has no requirement parameters, so gated types need follow-up setter txs.
  // The new community's id comes from the CommunityCreated event in the creation receipt —
  // only after the requirements land does the page get notified (directory refresh + close),
  // so a gated community is never left half-configured with the modal already gone.
  const configuredRef = useRef(null)
  useEffect(() => {
    const run = async () => {
      if (!isConfirmed || !receipt || configuredRef.current === hash) return
      configuredRef.current = hash

      let newCommunityId = null
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: HupCommunityABI, data: log.data, topics: log.topics })
          if (decoded.eventName === 'CommunityCreated') {
            newCommunityId = decoded.args.id
            break
          }
        } catch {
          // Not a HupCommunity event (e.g. the key-init events) — skip
        }
      }

      const hasFollowUps =
        newCommunityId !== null && ((needsNft && nftAddress) || (needsToken && tokenAddress) || (needsPayment && paymentPrice))

      if (hasFollowUps) {
        setIsConfiguring(true)
        setConfigError('')
        try {
          if (needsNft && nftAddress) {
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setNftRequirement',
              args: [newCommunityId, nftAddress, BigInt(nftMinBalance || '1')],
            })
          }
          if (needsToken && tokenAddress) {
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setTokenRequirement',
              args: [newCommunityId, tokenAddress, BigInt(tokenMinBalance || '1')],
            })
          }
          if (needsPayment && paymentPrice) {
            // Native-coin prices are entered in whole coin units (parseEther); token prices are
            // entered directly in the token's smallest unit — same convention as the edit form
            const priceValue = paymentToken ? BigInt(paymentPrice) : parseEther(paymentPrice)
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setPaymentRequirement',
              args: [newCommunityId, paymentToken || '0x0000000000000000000000000000000000000000', priceValue, paymentIsLsp7],
            })
          }
        } catch (err) {
          console.error('Community created, but configuring its gating requirements failed:', err)
          setConfigError(
            'Community created, but its gating setup was not completed — finish it from the Modify form.',
          )
          setIsConfiguring(false)
          return // keep the modal open so the error is seen; user closes manually
        }
        setIsConfiguring(false)
      }

      onCreated?.()
    }
    run()
  }, [isConfirmed, receipt, hash])

  // Known createCommunity reverts, translated to something a user can act on — the raw
  // shortMessage for a custom error is just the error name (or worse, hex)
  const friendlyCreateError = (() => {
    if (!createError) return null
    const raw = `${createError.shortMessage || ''} ${createError.message || ''}`
    if (raw.includes('CreationCooldownActive'))
      return 'You created a community recently — the anti-spam cooldown is 1 hour per wallet. Try again in a few minutes.'
    if (raw.includes('MaxCommunitiesReached')) return 'This wallet has reached the maximum number of communities it can create.'
    if (raw.includes('InsufficientFee')) return 'The transaction value does not match the current creation fee.'
    return createError.shortMessage || createError.message
  })()

  const handleCreate = async (e) => {
    e.preventDefault()

    if (isCreatingEncrypted && !vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }

    const metadataObj = {
      name,
      summary,
      description,
      'logo url': logoUrl,
      'cover url': coverUrl,
    }

    // Community metadata is stored on-chain as an IPFS CID only (MAX_METADATA_LENGTH enforces
    // this — a raw JSON blob would exceed it), matching how posts already store just a CID.
    let metadataCid
    try {
      metadataCid = await uploadObjectToIPFS(metadataObj)
    } catch (err) {
      console.error('Failed to upload community metadata to IPFS:', err)
      alert('Failed to upload community metadata. Please try again.')
      return
    }

    // Encrypted types get their content key generated + wrapped to the creator's own identity key
    // right here, so createCommunity can initialize it atomically in the same transaction — no
    // second signature, and no window where the community is gated but not yet encrypted.
    const initialWrappedKey = isCreatingEncrypted ? wrapContentKey(generateContentKey(), vault.identity.pubKeyHex) : '0x'

    writeContract({
      address: CONTRACT_ADDRESS,
      abi: HupCommunityABI,
      functionName: 'createCommunity',
      args: [membershipType, communityType, metadataCid, initialWrappedKey],
      value: creationFee,
    })
  }

  return (
    <NativeDialog ref={dialogRef} className={styles.createModal} aria-label="New community form" onClose={onClose}>
      <DialogHeader title="New community" onCancel={() => dialogRef.current?.close()} />

      <div className={styles.createModal__body}>
        <p className={styles.manager__subtitle} style={{ marginBottom: '1.25rem' }}>
          Deploy an onchain community registry with custom gating rules.
        </p>

        <form className={styles.manager__form} onSubmit={handleCreate}>
          <div className={styles.manager__row}>
            <div className={styles.manager__field}>
              <label className={styles.manager__label}>Membership rule (gating)</label>
              <select
                className={styles.manager__select}
                value={membershipType}
                onChange={(e) => setMembershipType(Number(e.target.value))}
              >
                {MEMBERSHIP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className={styles.optionNote}>{MEMBERSHIP_OPTIONS[membershipType]?.note}</p>
            </div>

            <div className={styles.manager__field}>
              <label className={styles.manager__label}>Channel type (permissions)</label>
              <select
                className={styles.manager__select}
                value={communityType}
                onChange={(e) => setCommunityType(Number(e.target.value))}
              >
                {COMMUNITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className={styles.optionNote}>{COMMUNITY_TYPE_OPTIONS[communityType]?.note}</p>
            </div>
          </div>

          {needsNft && (
            <div className={styles.manager__row}>
              <div className={styles.manager__field}>
                <label className={styles.manager__label}>NFT contract address</label>
                <input
                  className={styles.manager__input}
                  placeholder="0x..."
                  value={nftAddress}
                  onChange={(e) => setNftAddress(e.target.value)}
                  required
                />
              </div>
              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Minimum NFT balance</label>
                <input
                  className={styles.manager__input}
                  type="number"
                  min="1"
                  value={nftMinBalance}
                  onChange={(e) => setNftMinBalance(e.target.value)}
                />
              </div>
            </div>
          )}

          {needsToken && (
            <div className={styles.manager__row}>
              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Token contract address</label>
                <input
                  className={styles.manager__input}
                  placeholder="0x..."
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  required
                />
              </div>
              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Minimum token balance (smallest unit)</label>
                <input
                  className={styles.manager__input}
                  type="number"
                  min="1"
                  value={tokenMinBalance}
                  onChange={(e) => setTokenMinBalance(e.target.value)}
                />
              </div>
            </div>
          )}

          {needsPayment && (
            <>
              <div className={styles.manager__row}>
                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>Payment token address (blank = native coin)</label>
                  <input
                    className={styles.manager__input}
                    placeholder="0x... or leave blank"
                    value={paymentToken}
                    onChange={(e) => setPaymentToken(e.target.value)}
                  />
                </div>
                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>Price {paymentToken ? '(smallest unit)' : '(native coin)'}</label>
                  <input
                    className={styles.manager__input}
                    placeholder={paymentToken ? 'e.g. 1000000' : 'e.g. 0.5'}
                    value={paymentPrice}
                    onChange={(e) => setPaymentPrice(e.target.value)}
                    required
                  />
                </div>
              </div>
              {paymentToken && (
                <label className={styles.manager__label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={paymentIsLsp7} onChange={(e) => setPaymentIsLsp7(e.target.checked)} />
                  This token is an LSP7 asset (not ERC-20)
                </label>
              )}
              <p className={styles.manager__subtitle}>Payments go directly to you (the creator) when someone joins.</p>
            </>
          )}

          {membershipType === 6 && (
            <p className={styles.manager__subtitle}>
              Whitelist entries are added after creation — open the community's ⋯ menu → Manage community.
            </p>
          )}

          {membershipType === 8 && (
            <p className={styles.manager__subtitle}>
              Members must follow you via the on-chain Follower System to be eligible.
            </p>
          )}

          {needsNft || needsToken || needsPayment ? (
            <p className={styles.manager__subtitle}>
              Creating this community takes one extra wallet confirmation after the create transaction, to store the
              gating requirement on-chain.
            </p>
          ) : null}

          {isCreatingEncrypted && (!vault.identity || vault.needsRegistration) && vaultPrompt}

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Community name</label>
            <input
              className={styles.manager__input}
              placeholder="e.g., Alpha Node"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Short summary</label>
            <input
              className={styles.manager__input}
              placeholder="A brief tagline for the community"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
            />
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Full description</label>
            <textarea
              className={styles.manager__textarea}
              placeholder="Detailed rules, manifesto, and purpose..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <ImagePicker
            label="Logo"
            value={logoUrl}
            onChange={setLogoUrl}
            fieldClassName={styles.manager__field}
            labelClassName={styles.manager__label}
          />

          <ImagePicker
            label="Cover image"
            value={coverUrl}
            onChange={setCoverUrl}
            fieldClassName={styles.manager__field}
            labelClassName={styles.manager__label}
          />

          {creationFee > 0n && (
            <p className={styles.manager__subtitle}>
              Creation fee: {formatEther(creationFee)} native coin
            </p>
          )}

          {cooldownRemainingSec > 0 && (
            <div className="alert alert--info" style={{ fontSize: '0.85rem' }}>
              ⏳ Anti-spam cooldown: each wallet can create one community per hour. You can create your next one{' '}
              {new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(Math.ceil(cooldownRemainingSec / 60), 'minute')}.
            </div>
          )}

          <button
            type="submit"
            className={clsx(styles.manager__submit, { [styles['manager__submit--loading']]: isPending || isConfirming })}
            disabled={isPending || isConfirming || (isCreatingEncrypted && !vault.identity) || cooldownRemainingSec > 0}
          >
            {isPending
              ? 'Confirm in Wallet...'
              : isConfirming
              ? 'Mining Tx...'
              : creationFee > 0n
              ? `Create Community (${formatEther(creationFee)})`
              : 'Create Community'}
          </button>
        </form>

        {hash && (
          <div className={styles.manager__monitor}>
            <p className={styles.manager__tx}>Tx: <span>{hash}</span></p>
            {isConfirming && <p className={styles.manager__status}>Waiting for block confirmation...</p>}
            {isConfiguring && <p className={styles.manager__status}>Community created — confirm the gating requirement transaction in your wallet...</p>}
            {isConfirmed && !isConfiguring && <p className={clsx(styles.manager__status, styles['manager__status--success'])}>Community Successfully Registered!</p>}
          </div>
        )}

        {friendlyCreateError && <div className={styles.manager__error}>Error: {friendlyCreateError}</div>}

        {configError && <div className={styles.manager__error}>{configError}</div>}
      </div>
    </NativeDialog>
  )
})

export default CreateCommunityModal
