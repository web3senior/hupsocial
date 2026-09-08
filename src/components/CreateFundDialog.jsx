'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { parseEventLogs } from 'viem'
import { useConnection, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import {
  FUND_DURATIONS,
  formatUsdRound,
  MAX_FUND_DESCRIPTION_LENGTH,
  MAX_FUND_FAQ,
  MAX_FUND_FAQ_LENGTH,
  MAX_FUND_TITLE_LENGTH,
  nativeToWei,
  weiToNumber,
} from '@/lib/fund'
import { useNativePrice } from '@/hooks/useNativePrice'
import fundAbi from '@/abis/HupFund.json'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import { PlusIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import styles from './CreateFundDialog.module.scss'

const getFundDraftKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}fund-draft`

const emptyFaq = () => [{ question: '', answer: '' }]

// Only the wording is kept, never the target chain: a draft written while the composer sat on
// one network must not quietly open a campaign aimed at another.
const loadFundDraft = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(getFundDraftKey())
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const faq = Array.isArray(parsed.faq)
      ? parsed.faq
          .filter((entry) => entry && typeof entry === 'object')
          .slice(0, MAX_FUND_FAQ)
          .map((entry) => ({
            question: typeof entry.question === 'string' ? entry.question.slice(0, MAX_FUND_FAQ_LENGTH) : '',
            answer: typeof entry.answer === 'string' ? entry.answer.slice(0, MAX_FUND_FAQ_LENGTH) : '',
          }))
      : []

    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, MAX_FUND_TITLE_LENGTH) : '',
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, MAX_FUND_DESCRIPTION_LENGTH) : '',
      goal: typeof parsed.goal === 'string' ? parsed.goal.slice(0, 40) : '',
      // Clamped to the contract's own bounds — a draft written before those limits changed
      // must not restore a form the chain would reject
      durationSeconds: FUND_DURATIONS.some((duration) => duration.seconds === parsed.durationSeconds) ? parsed.durationSeconds : null,
      payout: typeof parsed.payout === 'string' ? parsed.payout.slice(0, 42) : '',
      faq: faq.length > 0 ? faq : emptyFaq(),
    }
  } catch {
    return null
  }
}

const clearFundDraft = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getFundDraftKey())
  } catch (error) {
    console.error('Failed to clear fund draft:', error)
  }
}

// The campaign id only exists onchain — pull it out of the receipt's CampaignCreated event so
// the caller (the post composer) can attach the campaign it just opened
const campaignIdFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: fundAbi, logs: logs ?? [], eventName: 'CampaignCreated' })
    return created?.args?.campaignId?.toString() || null
  } catch {
    return null
  }
}

/**
 * Create Fund Dialog
 * Opens a fundraising campaign onchain and hands the reference back. Same shape as the poll
 * and market dialogs: the campaign exists on its own before any post mentions it, so a failed
 * publish leaves a campaign that can still be attached later rather than an orphaned half-post.
 * Always signed by the connected wallet — HupFund takes no session key and no relayer.
 * @param {Object} props
 * @param {Function} props.onCreated Called with { campaignId, chainId } once confirmed.
 * @param {number|null} [props.fixedChainId] Pins the campaign to one network (composer's chain).
 */
const CreateFundDialog = forwardRef(function CreateFundDialog({ onCreated, fixedChainId = null }, ref) {
  const dialogRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // Chains where the fund contract is deployed
  const fundChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.fund), [])
  const [chainId, setChainId] = useState(() => fixedChainId ?? fundChains[0]?.id ?? null)

  const chainInfo = fundChains.find((chain) => chain.id === chainId)
  const fundAddress = CONTRACTS[`chain${chainId}`]?.fund
  const symbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const price = useNativePrice(chainId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [goal, setGoal] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(FUND_DURATIONS[2].seconds)
  const [payout, setPayout] = useState('')
  const [faq, setFaq] = useState(emptyFaq)
  const [isUploading, setIsUploading] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setGoal('')
    setDurationSeconds(FUND_DURATIONS[2].seconds)
    setPayout('')
    setFaq(emptyFaq())
    setRestoredDraft(false)
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      // Follow the wallet: opening with the wallet on a fund-deployed chain targets that
      // chain, so the mismatch banner only appears when the wallet sits somewhere fundraising
      // actually isn't
      if (!fixedChainId && walletChain?.id && CONTRACTS[`chain${walletChain.id}`]?.fund) {
        setChainId(walletChain.id)
      }

      // Restored on open rather than at render: reading storage in a state initializer would
      // make the client's first paint disagree with the server's markup
      const draft = loadFundDraft()
      if (draft) {
        setTitle(draft.title)
        setDescription(draft.description)
        setGoal(draft.goal)
        if (draft.durationSeconds) setDurationSeconds(draft.durationSeconds)
        setPayout(draft.payout)
        setFaq(draft.faq)
        setRestoredDraft(Boolean(draft.title.trim() || draft.description.trim()))
      }

      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  useEffect(() => {
    if (fixedChainId) setChainId(fixedChainId)
  }, [fixedChainId])

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  // Kept through a close or a refresh — a campaign description is often abandoned mid-sentence.
  // Cleared only once the campaign is onchain, which is the point the wording stops being a draft.
  useEffect(() => {
    const hasContent = Boolean(title.trim() || description.trim() || goal.trim())

    if (!hasContent) {
      clearFundDraft()
      return
    }

    try {
      localStorage.setItem(getFundDraftKey(), JSON.stringify({ title, description, goal, durationSeconds, payout, faq }))
    } catch (error) {
      console.error('Failed to save fund draft:', error)
    }
  }, [title, description, goal, durationSeconds, payout, faq])

  useEffect(() => {
    if (!isConfirmed) return
    const campaignId = campaignIdFromLogs(receipt?.logs)
    toast('Campaign opened — attach it to your post', 'success')
    clearFundDraft()
    resetForm()
    dialogRef.current?.close()
    onCreated?.(campaignId ? { campaignId, chainId } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const setFaqEntry = (index, field, value) => {
    setFaq((current) => current.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)))
  }

  const goalWei = nativeToWei(goal)
  const goalUsd = goalWei && price ? formatUsdRound(weiToNumber(goalWei) * price) : null

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!fundAddress) {
      toast("Fundraising isn't available on this network yet", 'error')
      return
    }

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast('Your campaign needs a title', 'error')
      return
    }
    if (!description.trim()) {
      toast('Say what the money is for', 'error')
      return
    }
    if (!goalWei) {
      toast(`Set a goal in ${symbol}`, 'error')
      return
    }
    if (payout.trim() && !/^0x[0-9a-fA-F]{40}$/.test(payout.trim())) {
      toast('The payout address is not a valid wallet address', 'error')
      return
    }

    const answered = faq.filter((entry) => entry.question.trim() && entry.answer.trim())
    const closesUnix = Math.floor(Date.now() / 1000) + Number(durationSeconds)

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(
        withAuthor(
          {
            title: trimmedTitle,
            description: description.trim(),
            ...(answered.length > 0
              ? { faq: answered.map((entry) => ({ question: entry.question.trim(), answer: entry.answer.trim() })) }
              : {}),
          },
          address,
        ),
      )
    } catch (err) {
      toast(err.message || 'Failed to upload the campaign', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // Payout empty means the creator, which the contract resolves itself from address(0)
    const args = [cid, goalWei, BigInt(closesUnix), payout.trim() || '0x0000000000000000000000000000000000000000']

    writeContract({ abi: fundAbi, address: fundAddress, functionName: 'createCampaign', args, chainId })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.fundDialog}
      aria-label="Start a fundraise"
      onClick={(e) => e.stopPropagation()}
      // This dialog sits inside the composer — React's synthetic close/cancel events propagate
      // up the component tree, so both must stop here or closing this also closes the composer
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.stopPropagation()
        // Esc must not discard the form while the upload or transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.fundDialog__body}>
        <header className={styles.fundDialog__header}>
          <h3>Start a fundraise</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.fundDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        {isWrongChain && (
          <div className={styles.fundDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Campaigns on {chainInfo?.name || 'this network'} need your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.fundDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {fundChains.length === 0 && <p className={styles.fundDialog__notice}>The fundraising contract isn&apos;t deployed yet.</p>}

        {restoredDraft && (
          <div className={styles.fundDialog__draft}>
            <span>Picked up where you left off.</span>
            <button type="button" onClick={resetForm} disabled={isBusy}>
              Start over
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.fundDialog__form}>
          {!fixedChainId && fundChains.length > 1 && (
            <label>
              <span>Network</span>
              <select value={chainId ?? ''} onChange={(e) => setChainId(Number(e.target.value))} disabled={isBusy}>
                {fundChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>What are you raising for?</span>
            <input
              type="text"
              placeholder="e.g. Ship the Hup mobile app"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              maxLength={MAX_FUND_TITLE_LENGTH}
              required
            />
          </label>

          <label>
            <span>Tell people what the money does</span>
            <textarea
              rows={4}
              placeholder="What you will build, what it costs, and what backers get out of it."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              maxLength={MAX_FUND_DESCRIPTION_LENGTH}
              required
            />
          </label>

          <label>
            <span>Goal</span>
            <div className={styles.fundDialog__goal}>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="0"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                disabled={isBusy}
                required
              />
              <span>{symbol}</span>
            </div>
            <small>
              {goalUsd ? `About ${goalUsd} at today's price.` : `The goal is set in ${symbol}, the coin backers actually send.`} It is a
              target, not a condition: when backing ends you decide whether to withdraw what came in or refund everyone.
            </small>
          </label>

          <label>
            <span>Open for</span>
            <select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} disabled={isBusy}>
              {FUND_DURATIONS.map((duration) => (
                <option key={duration.seconds} value={duration.seconds}>
                  {duration.label}
                </option>
              ))}
            </select>
            <small>Backing closes automatically. You can end it earlier from the campaign page.</small>
          </label>

          <label>
            <span>Payout address (optional)</span>
            <input
              type="text"
              placeholder="0x… — defaults to your own wallet"
              value={payout}
              onChange={(e) => setPayout(e.target.value.trim())}
              disabled={isBusy}
              spellCheck={false}
            />
            <small>
              Where the pot goes when you withdraw it. A multisig is the honest choice for a public raise. You can change it any time
              before withdrawing.
            </small>
          </label>

          <fieldset className={styles.fundDialog__list}>
            <legend>Questions and answers (optional)</legend>
            {faq.map((entry, index) => (
              <div key={index} className={styles.fundDialog__faqRow}>
                <input
                  type="text"
                  placeholder="What happens if you miss the goal?"
                  value={entry.question}
                  onChange={(e) => setFaqEntry(index, 'question', e.target.value)}
                  disabled={isBusy}
                  maxLength={MAX_FUND_FAQ_LENGTH}
                />
                <div className={styles.fundDialog__faqAnswer}>
                  <textarea
                    rows={2}
                    placeholder="Your answer"
                    value={entry.answer}
                    onChange={(e) => setFaqEntry(index, 'answer', e.target.value)}
                    disabled={isBusy}
                    maxLength={MAX_FUND_FAQ_LENGTH}
                  />
                  {faq.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFaq((current) => current.filter((_, i) => i !== index))}
                      disabled={isBusy}
                      aria-label={`Remove question ${index + 1}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {faq.length < MAX_FUND_FAQ && (
              <button
                type="button"
                className={styles.fundDialog__listAdd}
                onClick={() => setFaq((current) => [...current, { question: '', answer: '' }])}
                disabled={isBusy}
              >
                <PlusIcon size={12} />
                Add a question
              </button>
            )}
          </fieldset>

          <p className={styles.fundDialog__notice}>
            The contract holds every backing until you act. Once backing ends you either withdraw the pot to your payout address or open
            refunds, and every backer takes theirs back in full. Leave it unclaimed for 90 days and anyone can open refunds for you.
          </p>

          <button type="submit" disabled={isBusy || !fundAddress || isWrongChain} className={styles.fundDialog__submit}>
            {isUploading ? 'Uploading campaign...' : isBusy ? 'Confirming...' : 'Open the campaign'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default CreateFundDialog
