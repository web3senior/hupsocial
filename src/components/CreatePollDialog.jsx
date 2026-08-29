'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { parseEventLogs, zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { MAX_POLL_OPTIONS, MIN_POLL_OPTIONS, POLL_DURATIONS, REQUIREMENT_MODE, REQUIREMENT_TYPE } from '@/lib/polls'
import { allowlistRootFor } from '@/lib/pollAllowlist'
import pollsAbi from '@/abis/HupPolls.json'
import { toast } from '@/components/NextToast'
import { PlusIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import NetworkSelect from '@/components/ui/NetworkSelect'
import styles from './CreatePollDialog.module.scss'

const MAX_QUESTION_LENGTH = 280
const MAX_OPTION_LENGTH = 64

// bytes32(0) — what the contract reads as "this poll has no allowlist"
const ZERO_ROOT = `0x${'0'.repeat(64)}`

// One gate per poll, in the order a creator is likely to want them
const GATES = [
  { key: 'anyone', label: 'Anyone' },
  { key: 'community', label: 'Community members' },
  { key: 'token', label: 'Token holders' },
  { key: 'nft', label: 'NFT holders' },
  { key: 'followers', label: 'People who follow me' },
  { key: 'allowlist', label: 'A list I choose' },
]

const getPollDraftKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}poll-draft`

const emptyOptions = () => ['', '']

// Only the wording is kept, never the target chain: a draft written while the composer sat on
// one network must not quietly re-open a poll aimed at another.
const loadPollDraft = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getPollDraftKey())
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const options = Array.isArray(parsed.options) ? parsed.options.filter((option) => typeof option === 'string') : []

    return {
      question: typeof parsed.question === 'string' ? parsed.question.slice(0, MAX_QUESTION_LENGTH) : '',
      // Clamped to the contract's own bounds — a draft written before those limits changed
      // must not restore a form the chain would reject
      options: options.length >= MIN_POLL_OPTIONS ? options.slice(0, MAX_POLL_OPTIONS).map((option) => option.slice(0, MAX_OPTION_LENGTH)) : emptyOptions(),
      durationSeconds: POLL_DURATIONS.some((duration) => duration.seconds === parsed.durationSeconds) ? parsed.durationSeconds : null,
      // A gate is fiddly to set up, so losing it to a refresh would sting more than losing the
      // question. Only restored if it still names a gate this build offers.
      gate: GATES.some((entry) => entry.key === parsed.gate) ? parsed.gate : 'anyone',
      gateCommunityId: typeof parsed.gateCommunityId === 'string' ? parsed.gateCommunityId : '',
      gateAsset: typeof parsed.gateAsset === 'string' ? parsed.gateAsset.slice(0, 42) : '',
      gateAmount: typeof parsed.gateAmount === 'string' ? parsed.gateAmount.slice(0, 80) : '',
      gateAllowlist: typeof parsed.gateAllowlist === 'string' ? parsed.gateAllowlist.slice(0, 100_000) : '',
    }
  } catch {
    return null
  }
}

const clearPollDraft = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getPollDraftKey())
  } catch (error) {
    console.error('Failed to clear poll draft:', error)
  }
}

// The poll id only exists onchain — pull it out of the receipt's PollCreated event so the
// caller (the post composer) can attach the poll it just created
const pollIdFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: pollsAbi, logs: logs ?? [], eventName: 'PollCreated' })
    return created?.args?.pollId?.toString() || null
  } catch {
    return null
  }
}

/**
 * Create Poll Dialog
 * Opens a poll onchain and hands the reference back. Same shape as the market and drop
 * dialogs: the object exists on its own before any post mentions it, so a failed publish
 * leaves a poll that can still be attached later rather than an orphaned half-post.
 * @param {Object} props
 * @param {Function} props.onCreated Called with { pollId, chainId } once the poll is confirmed.
 * @param {number|null} [props.fixedChainId] Pins the poll to one network (composer's target chain).
 */
const CreatePollDialog = forwardRef(function CreatePollDialog({ onCreated, fixedChainId = null }, ref) {
  const dialogRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // Chains where the polls contract is deployed
  const pollChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.polls), [])
  const [chainId, setChainId] = useState(() => fixedChainId ?? pollChains[0]?.id ?? null)

  const chainInfo = pollChains.find((chain) => chain.id === chainId)
  const pollsAddress = CONTRACTS[`chain${chainId}`]?.polls
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const publicClient = usePublicClient({ chainId })

  // The followers gate reads an LSP26 registry the admin wires into the polls contract after
  // deployment; until then it fails closed onchain, and a poll opened against it is one nobody
  // can answer. Asked of the contract rather than the config: the config says which registry
  // a chain should use, only the contract knows whether it has been told yet. Offered while the
  // read is still in flight so a slow RPC hides nothing — the effect below corrects a pick the
  // answer then rules out.
  const { data: followerSystem } = useReadContract({
    abi: pollsAbi,
    address: pollsAddress,
    functionName: 'followerSystem',
    chainId,
    query: { enabled: Boolean(pollsAddress && chainId) },
  })
  const followersGateAvailable = followerSystem === undefined || String(followerSystem).toLowerCase() !== zeroAddress
  const gates = followersGateAvailable ? GATES : GATES.filter((entry) => entry.key !== 'followers')

  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(emptyOptions)
  const [durationSeconds, setDurationSeconds] = useState(POLL_DURATIONS[2].seconds)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)

  // Who may vote. `gate` is a single choice rather than the contract's full composable list:
  // three stacked conditions is a power feature nobody asked for on a poll, and one clear
  // sentence ("members of X can vote") is what a creator actually wants to say.
  const [gate, setGate] = useState('anyone')
  const [gateCommunityId, setGateCommunityId] = useState('')
  const [gateAsset, setGateAsset] = useState('')
  const [gateAmount, setGateAmount] = useState('')
  const [gateAllowlist, setGateAllowlist] = useState('')

  // Communities on the poll's chain, for the members-only gate. Only fetched once that gate is
  // picked — the list is irrelevant to every other kind of poll.
  const { data: communityPayload } = useSWR(
    gate === 'community' && chainId ? `/api/v1/networks/communities?network_id=${chainId}&limit=50` : null,
    (url) => fetch(url).then((res) => res.json()),
  )
  const communities = communityPayload?.data ?? []
  const communityContract = communities.find((entry) => String(entry.id) === String(gateCommunityId))?.contract_address ?? ''

  const resetForm = () => {
    setQuestion('')
    setOptions(emptyOptions())
    setDurationSeconds(POLL_DURATIONS[2].seconds)
    setRestoredDraft(false)
    setGate('anyone')
    setGateCommunityId('')
    setGateAsset('')
    setGateAmount('')
    setGateAllowlist('')
  }

  /**
   * Turns the picked gate into what the three parties need: the tuple the contract enforces,
   * the sentence the card shows, and — for an allowlist — the address set voters build their
   * proof from. Returns null when the gate is incomplete, so submit can say which field is
   * missing rather than opening an unusable poll.
   */
  const buildGate = () => {
    const allowlist = gateAllowlist
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^0x[0-9a-f]{40}$/.test(entry))

    switch (gate) {
      case 'community': {
        if (!gateCommunityId || !communityContract) return null
        const name = communities.find((entry) => String(entry.id) === String(gateCommunityId))?.name?.trim()
        return {
          requirements: [{ rType: REQUIREMENT_TYPE.CommunityMember, asset: communityContract, minBalance: BigInt(gateCommunityId) }],
          labels: [name ? `Members of ${name}` : `Members of community #${gateCommunityId}`],
          allowlist: [],
          root: ZERO_ROOT,
        }
      }
      case 'token': {
        if (!/^0x[0-9a-fA-F]{40}$/.test(gateAsset) || !gateAmount) return null
        // Raw units on purpose: decimals live in the token contract, and guessing 18 would
        // silently gate a 6-decimal token a million times too tightly
        return {
          requirements: [{ rType: REQUIREMENT_TYPE.TokenBalance, asset: gateAsset, minBalance: BigInt(gateAmount) }],
          labels: [`≥ ${Number(gateAmount).toLocaleString()} units`],
          allowlist: [],
          root: ZERO_ROOT,
        }
      }
      case 'nft': {
        if (!/^0x[0-9a-fA-F]{40}$/.test(gateAsset)) return null
        const count = BigInt(gateAmount || 1)
        return {
          requirements: [{ rType: REQUIREMENT_TYPE.NftBalance, asset: gateAsset, minBalance: count }],
          labels: [`Own ${count} from the collection`],
          allowlist: [],
          root: ZERO_ROOT,
        }
      }
      case 'followers':
        return {
          requirements: [{ rType: REQUIREMENT_TYPE.FollowsCreator, asset: zeroAddress, minBalance: 0n }],
          labels: ['Follows the creator'],
          allowlist: [],
          root: ZERO_ROOT,
        }
      case 'allowlist': {
        if (allowlist.length === 0) return null
        return {
          requirements: [{ rType: REQUIREMENT_TYPE.Allowlisted, asset: zeroAddress, minBalance: 0n }],
          labels: [`${allowlist.length} invited ${allowlist.length === 1 ? 'wallet' : 'wallets'}`],
          allowlist,
          root: allowlistRootFor(allowlist),
        }
      }
      default:
        return { requirements: [], labels: [], allowlist: [], root: ZERO_ROOT }
    }
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      // Follow the wallet: opening with the wallet on a poll-deployed chain targets that
      // chain, so the mismatch banner only appears when the wallet sits somewhere polls
      // actually aren't
      if (!fixedChainId && walletChain?.id && CONTRACTS[`chain${walletChain.id}`]?.polls) {
        setChainId(walletChain.id)
      }

      // Restored on open rather than at render: reading storage in a state initializer would
      // make the client's first paint disagree with the server's markup
      const draft = loadPollDraft()
      if (draft) {
        setQuestion(draft.question)
        setOptions(draft.options)
        if (draft.durationSeconds) setDurationSeconds(draft.durationSeconds)
        setGate(draft.gate)
        setGateCommunityId(draft.gateCommunityId)
        setGateAsset(draft.gateAsset)
        setGateAmount(draft.gateAmount)
        setGateAllowlist(draft.gateAllowlist)
        setRestoredDraft(Boolean(draft.question.trim() || draft.options.some((option) => option.trim())))
      }

      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  useEffect(() => {
    if (fixedChainId) setChainId(fixedChainId)
  }, [fixedChainId])

  // A restored draft or a network switch can leave the followers gate picked on a chain whose
  // polls contract has no registry yet — fall back to Anyone rather than open a dead poll
  useEffect(() => {
    if (gate === 'followers' && !followersGateAvailable) {
      setGate('anyone')
      toast("Follower-only polls aren't available on this network yet", 'info')
    }
  }, [gate, followersGateAvailable])

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading || isSubmittingBurner

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  // Kept through a close or a refresh so half-written questions survive — a poll is often
  // abandoned mid-sentence to go check something. Cleared only once the poll is onchain,
  // which is the point the wording stops being a draft. An all-empty form clears the key
  // instead of storing a blank draft.
  useEffect(() => {
    const hasContent = Boolean(question.trim() || options.some((option) => option.trim()))

    if (!hasContent) {
      clearPollDraft()
      return
    }

    try {
      localStorage.setItem(
        getPollDraftKey(),
        JSON.stringify({ question, options, durationSeconds, gate, gateCommunityId, gateAsset, gateAmount, gateAllowlist }),
      )
    } catch (error) {
      console.error('Failed to save poll draft:', error)
    }
  }, [question, options, durationSeconds, gate, gateCommunityId, gateAsset, gateAmount, gateAllowlist])

  useEffect(() => {
    if (!isConfirmed) return
    const pollId = pollIdFromLogs(receipt?.logs)
    toast('Poll created — attach it to your post', 'success')
    clearPollDraft()
    resetForm()
    dialogRef.current?.close()
    onCreated?.(pollId ? { pollId, chainId } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const setOption = (index, value) => {
    setOptions((current) => current.map((option, i) => (i === index ? value : option)))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!pollsAddress) {
      toast("The polls contract isn't available on this network yet", 'error')
      return
    }

    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) {
      toast('Your poll needs a question', 'error')
      return
    }

    const labels = options.map((option) => option.trim())
    if (labels.length < MIN_POLL_OPTIONS || labels.some((label) => !label)) {
      toast('Every option needs a label (at least two)', 'error')
      return
    }
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      toast('Two options say the same thing', 'error')
      return
    }

    const gateConfig = buildGate()
    if (!gateConfig) {
      toast('Finish the voting requirement, or set it back to Anyone', 'error')
      return
    }

    const closesUnix = Math.floor(Date.now() / 1000) + Number(durationSeconds)

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(withAuthor({
        question: trimmedQuestion,
        options: labels.map((label) => ({ label })),
        // Display copy for the requirement chips, and — for an allowlist — the address set
        // itself, so a voter can build a Merkle proof without hunting for the list. The root
        // is already onchain, so publishing the members reveals nothing new.
        ...(gateConfig.labels.length > 0 ? { requirementLabels: gateConfig.labels } : {}),
        ...(gateConfig.allowlist.length > 0 ? { allowlist: gateConfig.allowlist } : {}),
      }, address))
    } catch (err) {
      toast(err.message || 'Failed to upload the poll', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // opensAt 0 = open immediately, which is the only case the composer offers: a poll
    // attached to a post that nobody can answer yet is just a post. AllOf is passed for the
    // mode because the composer only ever writes a single requirement — with one entry the
    // two modes are identical, and this keeps the door open for a list later.
    const args = [
      address,
      cid,
      labels.length,
      0n,
      BigInt(closesUnix),
      gateConfig.requirements.map((requirement) => [requirement.rType, requirement.asset, requirement.minBalance]),
      REQUIREMENT_MODE.AllOf,
      gateConfig.root,
    ]

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: pollsAddress,
          abi: pollsAbi,
          functionName: 'createPoll',
          args,
        })

        // writeWithBurnerSession already awaited confirmation, so this resolves immediately
        const burnerReceipt = await tx.wait().catch(() => null)
        const pollId = pollIdFromLogs(burnerReceipt?.logs)

        toast('Poll created — attach it to your post', 'success')
        clearPollDraft()
        resetForm()
        dialogRef.current?.close()
        onCreated?.(pollId ? { pollId, chainId } : undefined)
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: pollsAbi,
      address: pollsAddress,
      functionName: 'createPoll',
      args,
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.pollDialog}
      aria-label="Create a poll"
      onClick={(e) => e.stopPropagation()}
      // This dialog sits inside the composer — React's synthetic close/cancel events
      // propagate up the component tree, so both must stop here or closing this dialog
      // also closes the composer behind it
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.stopPropagation()
        // Esc must not discard the form while the upload or transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.pollDialog__body}>
        <header className={styles.pollDialog__header}>
          <h3>New poll</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.pollDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.pollDialog__network}>
          <NetworkSelect />
        </div>

        {isWrongChain && (
          <div className={styles.pollDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Polls on {chainInfo?.name || 'this network'} need your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.pollDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {pollChains.length === 0 && <p className={styles.pollDialog__notice}>The polls contract isn&apos;t deployed yet.</p>}

        {/* Without this the only way out of an unwanted restored draft is emptying every
            field by hand, which is worse than never having kept it */}
        {restoredDraft && (
          <div className={styles.pollDialog__draft}>
            <span>Picked up where you left off.</span>
            <button type="button" onClick={resetForm} disabled={isBusy}>
              Start over
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.pollDialog__form}>
          {!fixedChainId && pollChains.length > 1 && (
            <label>
              <span>Network</span>
              <select value={chainId ?? ''} onChange={(e) => setChainId(Number(e.target.value))} disabled={isBusy}>
                {pollChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>Question</span>
            <input
              type="text"
              placeholder="e.g. Which chain should we ship next?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={isBusy}
              maxLength={MAX_QUESTION_LENGTH}
              required
            />
          </label>

          <fieldset className={styles.pollDialog__list}>
            <legend>Options</legend>
            {options.map((option, index) => (
              <div key={index} className={styles.pollDialog__listRow}>
                <input
                  type="text"
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                  disabled={isBusy}
                  maxLength={MAX_OPTION_LENGTH}
                  required
                />
                {options.length > MIN_POLL_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                    disabled={isBusy}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_POLL_OPTIONS && (
              <button
                type="button"
                className={styles.pollDialog__listAdd}
                onClick={() => setOptions((current) => [...current, ''])}
                disabled={isBusy}
              >
                <PlusIcon size={12} />
                Add option
              </button>
            )}
          </fieldset>

          <fieldset className={styles.pollDialog__list}>
            <legend>Who can vote</legend>
            <select value={gate} onChange={(e) => setGate(e.target.value)} disabled={isBusy} aria-label="Who can vote">
              {gates.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>

            {gate === 'community' && (
              <>
                <select value={gateCommunityId} onChange={(e) => setGateCommunityId(e.target.value)} disabled={isBusy} aria-label="Community">
                  <option value="">Pick a community…</option>
                  {communities.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name?.trim() || `Community #${entry.id}`}
                    </option>
                  ))}
                </select>
                <small>
                  Only unbanned members can vote, checked against the community roster onchain at the moment the ballot lands — not a
                  snapshot taken now.
                </small>
              </>
            )}

            {(gate === 'token' || gate === 'nft') && (
              <>
                <input
                  type="text"
                  placeholder="Contract address (0x…)"
                  value={gateAsset}
                  onChange={(e) => setGateAsset(e.target.value.trim())}
                  disabled={isBusy}
                  spellCheck={false}
                />
                <input
                  type="number"
                  min="0"
                  placeholder={gate === 'nft' ? 'How many they must own (1)' : 'Minimum balance, in the token’s smallest unit'}
                  value={gateAmount}
                  onChange={(e) => setGateAmount(e.target.value)}
                  disabled={isBusy}
                />
                {gate === 'token' && (
                  <small>
                    Smallest unit, not whole tokens — for an 18-decimal token, one token is 1 followed by eighteen zeros. The contract has
                    no way to know a token’s decimals, so this is the one number it can’t convert for you.
                  </small>
                )}
              </>
            )}

            {gate === 'followers' && <small>Checked against the LSP26 follower registry onchain at the moment each ballot lands.</small>}

            {gate === 'allowlist' && (
              <>
                <textarea
                  rows={3}
                  placeholder="0xabc…, 0xdef… — one per line or comma separated"
                  value={gateAllowlist}
                  onChange={(e) => setGateAllowlist(e.target.value)}
                  disabled={isBusy}
                  spellCheck={false}
                />
                <small>
                  Only the list’s fingerprint goes onchain, but the addresses themselves are published with the poll so voters can prove
                  they belong. Treat it as public.
                </small>
              </>
            )}
          </fieldset>

          <label>
            <span>Open for</span>
            <select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} disabled={isBusy}>
              {POLL_DURATIONS.map((duration) => (
                <option key={duration.seconds} value={duration.seconds}>
                  {duration.label}
                </option>
              ))}
            </select>
            <small>Voting closes automatically. You can end it earlier from the poll itself.</small>
          </label>

          <p className={styles.pollDialog__notice}>
            One wallet, one vote, and a vote can&apos;t be taken back — that is what makes the count checkable by anyone. Voters see
            each other&apos;s picks once they have voted, and every ballot is public onchain.
          </p>

          <button type="submit" disabled={isBusy || !pollsAddress || isWrongChain} className={styles.pollDialog__submit}>
            {isUploading ? 'Uploading poll...' : isBusy ? 'Confirming...' : 'Create poll'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default CreatePollDialog
