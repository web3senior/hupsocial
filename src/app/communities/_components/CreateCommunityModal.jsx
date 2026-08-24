'use client'

// Community creation modal — same NativeDialog primitive as the app's other modals (true
// top-layer modality: click-blocking backdrop, focus trap, native Esc). Entirely separate
// from the NewPost composer: this one deploys a community on HupCommunity, NewPost
// publishes content to Hup core.

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, usePublicClient } from 'wagmi'
import { formatEther, parseEther, parseUnits, decodeEventLog } from 'viem'
import clsx from 'clsx'
import NativeDialog from '@/components/ui/NativeDialog'
import DialogHeader from '@/components/ui/DialogHeader'
import { toast } from '@/components/NextToast'
import HupCommunityABI from '@/abis/HupCommunity'
import { getActiveChain } from '@/lib/communication'
import { uploadObjectToIPFS } from '@/lib/ipfs'
import { generateContentKey, wrapContentKey } from '@/lib/communityVault'
import { buildLinks, emptySocials } from '@/lib/socialLinks'
import BrandingLinksFields from './BrandingLinksFields'
import ImagePicker from './ImagePicker'
import { AssetUnitLabel, TokenUnitHint } from './TokenAmount'
import TokenAssetInput from './TokenAssetInput'
import RecipientField from '@/components/ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import OptionPicker from './OptionPicker'
import { ZERO_ADDRESS, fetchIsLsp7, fetchTokenDecimals, getNativeCurrency } from '../tokenUnits'
import { MAX_TAG_LENGTH, normalizeTag } from '../communityTag'
import { DEFAULT_COMMUNITY_CATEGORY } from '@/config/communityCategories'
import useCommunityCategories from '@/hooks/useCommunityCategories'
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
} from '../membershipOptions'
import styles from '../page.module.scss'

// A half-filled form survives a full page refresh too: every field mirrors into this
// localStorage draft, restored on mount and dropped once a community is actually created.
const DRAFT_STORAGE_KEY = 'hup_community_create_draft'

const CreateCommunityModal = forwardRef(function CreateCommunityModal({ vault, vaultPrompt, onClose, onCreated }, ref) {
  const [activeChain, activeChainContracts] = getActiveChain()
  const CONTRACT_ADDRESS = activeChainContracts?.community
  const chainId = activeChain?.id
  const publicClient = usePublicClient({ chainId })
  const nativeCurrency = getNativeCurrency(chainId)
  const isLuksoChain = chainId === 42 || chainId === 4201
  const { categories } = useCommunityCategories()

  // Stays mounted for the whole page life (like the app's other modals) so a half-filled
  // form survives close/reopen — the parent opens and closes it through this handle
  const dialogRef = useRef(null)
  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [category, setCategory] = useState(DEFAULT_COMMUNITY_CATEGORY)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [socials, setSocials] = useState(emptySocials)
  const [extraLinks, setExtraLinks] = useState([])
  const [admission, setAdmission] = useState(ADMISSION.Open)
  const [communityType, setCommunityType] = useState(0)

  // The three orthogonal axes: admission mode above, the composable requirement list here,
  // and the encrypted-content flag. Requirements land via a follow-up setRequirements tx
  // after createCommunity confirms (the create call itself has no requirement parameters).
  const [requirements, setRequirements] = useState([])
  const [requirementMode, setRequirementMode] = useState(0)
  const [encrypted, setEncrypted] = useState(false)
  const [paymentToken, setPaymentToken] = useState('')
  const [paymentPrice, setPaymentPrice] = useState('')
  const [paymentIsLsp7, setPaymentIsLsp7] = useState(false)
  // Join-fee destination (RecipientField shape); empty = fees go to the creator. A contract
  // address (Safe, DAO, splitter) is fine — it withdraws from the ledger under its own rules.
  const [payoutDestination, setPayoutDestination] = useState(EMPTY_RECIPIENT)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [configError, setConfigError] = useState('')

  // Draft restore runs in an effect, not the state initializers — effects never run during
  // SSR, so the server-rendered markup and the first client render always agree.
  const suppressNextDraftSaveRef = useRef(true)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      setName(draft.name ?? '')
      setTag(draft.tag ?? '')
      setCategory(draft.category ?? DEFAULT_COMMUNITY_CATEGORY)
      setSummary(draft.summary ?? '')
      setDescription(draft.description ?? '')
      setLogoUrl(draft.logoUrl ?? '')
      setCoverUrl(draft.coverUrl ?? '')
      // Merged over the empty shapes so a draft written before a field existed stays valid
      setSocials({ ...emptySocials, ...(draft.socials ?? {}) })
      setExtraLinks(Array.isArray(draft.extraLinks) ? draft.extraLinks : [])
      setAdmission(draft.admission ?? ADMISSION.Open)
      setCommunityType(draft.communityType ?? 0)
      setRequirements(Array.isArray(draft.requirements) ? draft.requirements : [])
      setRequirementMode(draft.requirementMode ?? 0)
      setEncrypted(Boolean(draft.encrypted))
      setPaymentToken(draft.paymentToken ?? '')
      setPaymentPrice(draft.paymentPrice ?? '')
      setPaymentIsLsp7(Boolean(draft.paymentIsLsp7))
      setPayoutDestination(draft.payoutDestination?.input ? draft.payoutDestination : EMPTY_RECIPIENT)
    } catch {
      // Unreadable draft (corrupt JSON, blocked storage) — start clean
    }
  }, [])

  useEffect(() => {
    // Suppressed on mount: that run still sees the pristine initial values, and writing them
    // would clobber the stored draft before the restore effect's setStates have applied
    if (suppressNextDraftSaveRef.current) {
      suppressNextDraftSaveRef.current = false
      return
    }
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          name,
          tag,
          category,
          summary,
          description,
          logoUrl,
          coverUrl,
          socials,
          extraLinks,
          admission,
          communityType,
          requirements,
          requirementMode,
          encrypted,
          paymentToken,
          paymentPrice,
          paymentIsLsp7,
          payoutDestination,
        })
      )
    } catch {
      // Storage full or blocked — the form still works, it just won't survive a refresh
    }
  }, [name, tag, category, summary, description, logoUrl, coverUrl, socials, extraLinks, admission, communityType, requirements, requirementMode, encrypted, paymentToken, paymentPrice, paymentIsLsp7, payoutDestination])

  // Fields go back to their initial values once a community is fully created — the parent
  // closes the modal at that point, and reopening it with the created community's data still
  // filled in would invite an accidental duplicate. The reset's own save-effect run is
  // suppressed so it doesn't immediately re-write a pristine draft.
  const resetForm = () => {
    suppressNextDraftSaveRef.current = true
    setTxSteps([])
    setName('')
    setTag('')
    setCategory(DEFAULT_COMMUNITY_CATEGORY)
    setSummary('')
    setDescription('')
    setLogoUrl('')
    setCoverUrl('')
    setSocials(emptySocials)
    setExtraLinks([])
    setAdmission(ADMISSION.Open)
    setCommunityType(0)
    setRequirements([])
    setRequirementMode(0)
    setEncrypted(false)
    setPaymentToken('')
    setPaymentPrice('')
    setPaymentIsLsp7(false)
  }

  const needsPayment = admission === ADMISSION.PayToJoin
  const isSelfAdmit = admission === ADMISSION.Open || admission === ADMISSION.SelfServeIfEligible || admission === ADMISSION.PayToJoin

  // Self-serve with an empty requirement list is indistinguishable from Open onchain
  // (isEligible() is true for everyone), so the option stays locked until a requirement
  // exists — and emptying the list again drops back to Open rather than deploying the duplicate.
  const selfServeLocked = requirements.length === 0
  useEffect(() => {
    if (selfServeLocked && admission === ADMISSION.SelfServeIfEligible) setAdmission(ADMISSION.Open)
  }, [selfServeLocked, admission])

  const addRequirement = () => setRequirements((rows) => [...rows, { rType: 2, asset: '', minBalance: '1' }])
  const updateRequirement = (index, patch) =>
    setRequirements((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const removeRequirement = (index) => setRequirements((rows) => rows.filter((_, i) => i !== index))

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

  // Tx progress lives in one morphing toast (loading → success) instead of status rows
  // pinned under the form — a toast also outlives the modal, so closing it early doesn't
  // hide the confirmation the user is still waiting on.
  // Multi-transaction progress: creating can take up to four signatures (create, requirements,
  // price, destination). Rendered as a checklist in place of the form so each wallet prompt is
  // announced instead of appearing out of nowhere.
  const [txSteps, setTxSteps] = useState([])
  const stepTo = (key, status) => setTxSteps((steps) => steps.map((step) => (step.key === key ? { ...step, status } : step)))

  const txToastRef = useRef(null)
  const showTxToast = (message, type) => {
    // update() returns false once the user has closed the toast — start a fresh one then,
    // so the final success/failure state is never silently swallowed
    if (!txToastRef.current?.update(message, type)) txToastRef.current = toast(message, type)
  }

  useEffect(() => {
    if (isConfirming) showTxToast('Creating your community…', 'loading')
  }, [isConfirming])

  useEffect(() => {
    if (isConfiguring) showTxToast('Community created — one more confirmation in your wallet to save its requirements…', 'loading')
  }, [isConfiguring])

  // Submission failures keep their inline error display — just drop the spinner
  useEffect(() => {
    if (createError) {
      txToastRef.current?.dismiss()
      txToastRef.current = null
    }
  }, [createError])

  const isCreatingEncrypted = encrypted

  // createCommunity has no requirement parameters, so gated types need follow-up setter txs.
  // The new community's id comes from the CommunityCreated event in the creation receipt —
  // only after the requirements land does the page get notified (directory refresh + close),
  // so a gated community is never left half-configured with the modal already gone.
  const configuredRef = useRef(null)
  useEffect(() => {
    const run = async () => {
      if (!isConfirmed || !receipt || configuredRef.current === hash) return
      configuredRef.current = hash

      stepTo('create', 'done')

      // The community exists onchain from this point (even if the gating follow-ups below
      // fail), so the refresh-survival draft would only resurrect an already-created form
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
      } catch {
        // Blocked storage — nothing to clean up
      }

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

      const hasDestination = needsPayment && Boolean(payoutDestination.address)
      const hasFollowUps = newCommunityId !== null && (requirements.length > 0 || (needsPayment && paymentPrice) || hasDestination)

      let activeStep = null
      if (hasFollowUps) {
        setIsConfiguring(true)
        setConfigError('')
        try {
          if (requirements.length > 0) {
            activeStep = 'requirements'
            stepTo('requirements', 'active')
            // Every minimum is entered in whole units of the asset it gates on, so each one is
            // scaled by that asset's decimals; NFT minimums are plain counts and scale by nothing
            const requirementTuples = await Promise.all(
              requirements.map(async (row) => {
                // A blank-asset "Token or coin balance" row is the contract's NativeBalance type;
                // fetchTokenDecimals resolves that blank to the coin's decimals the same way
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
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setRequirements',
              args: [newCommunityId, requirementTuples, requirementMode],
            })
            stepTo('requirements', 'done')
          }
          if (needsPayment && paymentPrice) {
            activeStep = 'payment'
            stepTo('payment', 'active')
            // Prices are whole-unit amounts of the coin or token they're set in, same as above
            const priceValue = paymentToken
              ? parseUnits(paymentPrice, await fetchTokenDecimals(publicClient, chainId, paymentToken))
              : parseEther(paymentPrice)
            // Read from the token, not just the form: the LSP7 checkbox only shows on LUKSO, and
            // an LSP7 anywhere else would otherwise be saved as an ERC-20 — join() then pulls
            // with transferFrom, which the token doesn't have, and no one can ever pay to join.
            const priceIsLsp7 = paymentIsLsp7 || (await fetchIsLsp7(publicClient, chainId, paymentToken))
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setPaymentRequirement',
              args: [newCommunityId, paymentToken || ZERO_ADDRESS, priceValue, priceIsLsp7],
            })
            stepTo('payment', 'done')
          }
          if (hasDestination) {
            activeStep = 'destination'
            stepTo('destination', 'active')
            // Validated in handleCreate before anything signed.
            await writeSetterAsync({
              address: CONTRACT_ADDRESS,
              abi: HupCommunityABI,
              functionName: 'setPayoutDestination',
              args: [newCommunityId, payoutDestination.address],
            })
            stepTo('destination', 'done')
          }
        } catch (err) {
          if (activeStep) stepTo(activeStep, 'error')
          console.error('Community created, but configuring its gating requirements failed:', err)
          setConfigError(
            'Community created, but its gating setup was not completed — finish it from the Modify form.',
          )
          setIsConfiguring(false)
          txToastRef.current?.dismiss()
          txToastRef.current = null
          return // keep the modal open so the error is seen; user closes manually
        }
        setIsConfiguring(false)
      }

      // Success resolves the loading toast rather than a footer row, so it stays visible
      // even though resetForm/onCreated close the modal right after
      showTxToast('Your community is live!', 'success')
      txToastRef.current = null

      resetForm()
      onCreated?.()
    }
    run()
  }, [isConfirmed, receipt, hash])

  // A rejected or failed create dissolves the checklist so the form (and its error line)
  // comes back instead of a stuck step list
  useEffect(() => {
    if (createError) setTxSteps([])
  }, [createError])

  // Known createCommunity reverts, translated to something a user can act on — the raw
  // shortMessage for a custom error is just the error name (or worse, hex)
  const friendlyCreateError = (() => {
    if (!createError) return null
    const raw = `${createError.shortMessage || ''} ${createError.message || ''}`
    if (raw.includes('CreationCooldownActive'))
      return 'You created a community recently — there’s a 1-hour wait between communities. Try again in a few minutes.'
    if (raw.includes('MaxCommunitiesReached')) return 'You’ve reached the maximum number of communities one account can create.'
    if (raw.includes('InsufficientFee')) return 'The fee didn’t match the current creation fee. Refresh the page and try again.'
    return createError.shortMessage || createError.message
  })()

  const handleCreate = async (e) => {
    e.preventDefault()

    if (isCreatingEncrypted && !vault.identity) {
      vault.setShowPinPrompt(true)
      return
    }

    // An unresolved destination must stop the whole flow here — after createCommunity is
    // signed, the community already exists and the failure could only surface as a
    // half-configured follow-up.
    if (needsPayment && payoutDestination.input.trim() && !payoutDestination.address) {
      alert('Fee destination: pick a wallet from the suggestions or paste a full address — or clear the field to keep fees yourself.')
      return
    }

    // `links` is omitted entirely when nothing was filled in, so a community with no socials
    // serializes exactly as it did before this section existed
    const links = buildLinks(socials, extraLinks)

    const metadataObj = {
      name,
      // Omitted when blank, like `links` — a community without a tag publishes no tag key at
      // all, and cidex reads its absence as "grants no badge".
      ...(tag.trim() ? { tag: tag.trim() } : {}),
      // A curated slug (config/communityCategories.js) — cidex stores it as-is for the
      // directory's category filter; anything off-list would be indexed as null
      category,
      summary,
      description,
      'logo url': logoUrl,
      'cover url': coverUrl,
      ...(links.length > 0 ? { links } : {}),
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

    setTxSteps([
      { key: 'create', label: 'Create the community', status: 'active' },
      ...(requirements.length > 0 ? [{ key: 'requirements', label: 'Save the join requirements', status: 'pending' }] : []),
      ...(needsPayment && paymentPrice ? [{ key: 'payment', label: 'Set the join price', status: 'pending' }] : []),
      ...(needsPayment && payoutDestination.address
        ? [{ key: 'destination', label: 'Point join fees at the destination', status: 'pending' }]
        : []),
    ])

    writeContract({
      address: CONTRACT_ADDRESS,
      abi: HupCommunityABI,
      functionName: 'createCommunity',
      args: [admission, communityType, metadataCid, initialWrappedKey],
      value: creationFee,
    })
  }

  return (
    <NativeDialog ref={dialogRef} className={styles.createModal} aria-label="New community form" onClose={onClose}>
      <DialogHeader title="New community" compact onCancel={() => dialogRef.current?.close()} />

      <div className={styles.createModal__body}>
        <p className={styles.manager__subtitle} style={{ marginBottom: '1.25rem' }}>
          Start a community and decide who can join and who can post.
        </p>

        {txSteps.length > 0 && (
          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.5rem 0 1rem' }}>
            <p className={styles.manager__subtitle} style={{ margin: 0 }}>
              Setting up your community — confirm each step in your wallet when it asks.
            </p>
            {txSteps.map((step, index) => (
              <div
                key={step.key}
                className="flex align-items-center gap-050"
                style={{ fontSize: '0.9rem', opacity: step.status === 'pending' ? 0.55 : 1 }}
              >
                <span aria-hidden="true" style={{ width: '1.5rem', textAlign: 'center' }}>
                  {step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : step.status === 'active' ? '⏳' : `${index + 1}.`}
                </span>
                <span>
                  {step.label}
                  {step.status === 'active' ? '…' : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <form className={styles.manager__form} onSubmit={handleCreate} style={{ display: txSteps.length > 0 ? 'none' : undefined }}>
          <div className={styles.manager__row}>
            <div className={styles.manager__field}>
              <label className={styles.manager__label}>Admission (how people get in)</label>
              {/* Picker instead of a <select>: every option shows its explanation inline, which is
                  what finally separates "Open" from "Token-gated" for people */}
              <OptionPicker
                ariaLabel="Admission mode"
                triggerClassName={styles.manager__select}
                value={admission}
                onChange={setAdmission}
                options={ADMISSION_OPTIONS.map((option) => {
                  const locked = option.value === ADMISSION.SelfServeIfEligible && selfServeLocked
                  return { ...option, disabled: locked, disabledNote: SELF_SERVE_HINTS.locked }
                })}
              />
            </div>

            <div className={styles.manager__field}>
              <label className={styles.manager__label}>Who can post</label>
              <OptionPicker
                ariaLabel="Channel type"
                triggerClassName={styles.manager__select}
                value={communityType}
                onChange={setCommunityType}
                options={COMMUNITY_TYPE_OPTIONS}
              />
            </div>
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Requirements (optional) — what members must hold or be</label>
            {requirements.map((row, index) => {
              const meta = REQUIREMENT_TYPE_OPTIONS[row.rType]
              return (
                <div key={index} className="flex align-items-center gap-050" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <select
                    className={styles.manager__select}
                    style={{ width: 'auto' }}
                    title={meta?.note}
                    value={row.rType}
                    // Reset the minimum on type change: a decimal entered for native would
                    // break the integer BigInt conversion token/NFT rows use
                    onChange={(e) => updateRequirement(index, { rType: Number(e.target.value), minBalance: '1' })}
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
                      onChange={(asset) => updateRequirement(index, { asset })}
                      inputClassName={styles.manager__input}
                      style={{ flex: 1, minWidth: '220px' }}
                      allowNative={Boolean(meta.assetOptional)}
                      required={!meta.assetOptional}
                    />
                  )}
                  {meta?.needsAsset && row.rType !== REQUIREMENT_TYPE.TokenBalance && (
                    <input
                      className={styles.manager__input}
                      style={{ flex: 1, minWidth: '180px' }}
                      placeholder="0x... collection address"
                      value={row.asset}
                      onChange={(e) => updateRequirement(index, { asset: e.target.value })}
                      required
                    />
                  )}
                  {meta?.needsMin && (
                    <>
                      <input
                        className={styles.manager__input}
                        style={{ width: '130px' }}
                        type="number"
                        min="0"
                        // Coin and token minimums are whole units (decimals allowed); NFT
                        // minimums are a count of items, so they stay integers
                        step={row.rType === REQUIREMENT_TYPE.NftBalance ? '1' : 'any'}
                        placeholder={row.rType === REQUIREMENT_TYPE.NftBalance ? 'minimum' : 'e.g. 0.001'}
                        value={row.minBalance}
                        onChange={(e) => updateRequirement(index, { minBalance: e.target.value })}
                      />
                      {row.rType === REQUIREMENT_TYPE.TokenBalance && <TokenUnitHint address={row.asset} chainId={chainId} />}
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.card__cancelBtn}
                    aria-label="Remove requirement"
                    onClick={() => removeRequirement(index)}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            <div className="flex align-items-center gap-050" style={{ flexWrap: 'wrap' }}>
              <button type="button" className={styles.card__editBtn} onClick={addRequirement} disabled={requirements.length >= 10}>
                + Add requirement
              </button>
              {requirements.length >= 2 && (
                <select
                  className={styles.manager__select}
                  style={{ width: 'auto' }}
                  value={requirementMode}
                  onChange={(e) => setRequirementMode(Number(e.target.value))}
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
            {requirements.length > 0 && (
              <p className={styles.optionNote}>
                {requirements.length >= 2 ? `${REQUIREMENT_MODE_OPTIONS[requirementMode]?.note} ` : ''}
                Requirements are checked every time someone posts — a member who no longer meets them can’t post until they do again.
              </p>
            )}
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={encrypted} onChange={(e) => setEncrypted(e.target.checked)} />
              Encrypted content 🔒
            </label>
            <p className={styles.optionNote}>
              {encrypted ? ENCRYPTION_NOTES.on : ENCRYPTION_NOTES.off}
              {encrypted && isSelfAdmit ? ` ${ENCRYPTION_NOTES.onSelfAdmit}` : ''}
            </p>
          </div>

          {needsPayment && (
            <>
              <div className={styles.manager__row}>
                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>Payment token (blank = {nativeCurrency.symbol || 'the network’s coin'})</label>
                  <TokenAssetInput
                    chainId={chainId}
                    value={paymentToken}
                    onChange={(address, picked) => {
                      setPaymentToken(address)
                      // A search result knows whether it's an LSP7; a pasted address keeps the checkbox
                      if (picked) setPaymentIsLsp7(Boolean(picked.isLsp7))
                    }}
                    inputClassName={styles.manager__input}
                  />
                </div>
                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>
                    Price <AssetUnitLabel address={paymentToken} chainId={chainId} />
                  </label>
                  <input
                    className={styles.manager__input}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 0.5"
                    value={paymentPrice}
                    onChange={(e) => setPaymentPrice(e.target.value)}
                    required
                  />
                </div>
              </div>
              {/* LSP7 is LUKSO's token standard, so the question only makes sense there — elsewhere
                  every token takes the plain path and the checkbox would just be noise */}
              {paymentToken && isLuksoChain && (
                <label className={styles.manager__label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={paymentIsLsp7} onChange={(e) => setPaymentIsLsp7(e.target.checked)} />
                  This is a LUKSO (LSP7) token
                </label>
              )}
              <p className={styles.manager__subtitle}>
                Enter the price the way you’d say it (e.g. 0.5). Each new member’s payment is sent to you the
                moment they join — or to a destination you set below.
              </p>
              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Fee destination (optional)</label>
                <p className={styles.manager__subtitle} style={{ marginBottom: '0.5rem' }}>
                  Every join fee is sent to this address in full — leave empty to receive it yourself. Public and
                  editable later from Modify.
                </p>
                <RecipientField
                  label={null}
                  inputClassName={styles.manager__input}
                  value={payoutDestination}
                  onChange={setPayoutDestination}
                  viewer={accountAddress ?? null}
                  placeholder="Name, ENS, or 0x… wallet / contract address"
                  hint="Contracts work too: a Safe, DAO treasury, or splitter contract can share fees between wallets under rules you control. Make sure it can receive the payment asset — joins fail while it can't."
                />
              </div>
            </>
          )}

          {(requirements.length > 0 || needsPayment) && (
            <p className={styles.manager__subtitle}>
              You’ll get a second wallet confirmation right after the community is created, to save these settings.
              Whitelists are managed afterwards under Members & moderation.
            </p>
          )}

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
            <label className={styles.manager__label}>Tag (optional)</label>
            <input
              className={styles.manager__input}
              placeholder="e.g., ALPHA"
              value={tag}
              onChange={(e) => setTag(normalizeTag(e.target.value))}
              maxLength={MAX_TAG_LENGTH}
            />
            <p className={styles.manager__subtitle}>
              A short code your members can wear next to their name. Up to {MAX_TAG_LENGTH}{' '}
              characters. Leave it empty and this community grants no badge.
            </p>
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Category</label>
            <select className={styles.manager__select} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className={styles.manager__subtitle}>Where this community shows up when people browse the directory by topic.</p>
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

          <BrandingLinksFields
            socials={socials}
            onSocialsChange={setSocials}
            extraLinks={extraLinks}
            onExtraLinksChange={setExtraLinks}
            disabled={isPending || isConfirming}
            fieldClassName={styles.manager__field}
            labelClassName={styles.manager__label}
            inputClassName={styles.manager__input}
          />

          {creationFee > 0n && (
            <p className={styles.manager__subtitle}>
              Creation fee: {formatEther(creationFee)} {nativeCurrency.symbol}
            </p>
          )}

          {cooldownRemainingSec > 0 && (
            <div className="alert alert--info" style={{ fontSize: '0.85rem' }}>
              ⏳ One community per hour per account. You can create your next one{' '}
              {new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(Math.ceil(cooldownRemainingSec / 60), 'minute')}.
            </div>
          )}

          <button
            type="submit"
            className={clsx(styles.manager__submit, { [styles['manager__submit--loading']]: isPending || isConfirming })}
            // Encrypted creation requires both an unlocked vault AND an onchain-registered
            // identity — the contract reverts IdentityNotRegistered otherwise (an unregistered
            // creator would lose access at the first key rotation), so block up front
            disabled={
              isPending ||
              isConfirming ||
              (isCreatingEncrypted && (!vault.identity || vault.needsRegistration)) ||
              cooldownRemainingSec > 0
            }
          >
            {isPending
              ? 'Confirm in Wallet...'
              : isConfirming
              ? 'Creating…'
              : creationFee > 0n
              ? `Create Community (${`${formatEther(creationFee)} ${nativeCurrency.symbol}`.trim()})`
              : 'Create Community'}
          </button>
        </form>

        {friendlyCreateError && <div className={styles.manager__error}>Error: {friendlyCreateError}</div>}

        {configError && <div className={styles.manager__error}>{configError}</div>}
      </div>
    </NativeDialog>
  )
})

export default CreateCommunityModal
