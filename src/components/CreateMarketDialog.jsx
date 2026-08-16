'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { formatEther, isAddress, parseEventLogs, zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { TIP_TOKENS } from '@/lib/tokens'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import predictAbi from '@/abis/HupPredict.json'
import { toast } from '@/components/NextToast'
import { PlusIcon, StarIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import RecipientField from './ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import NetworkSelect from '@/components/ui/NetworkSelect'
import styles from './CreateMarketDialog.module.scss'

const LUKSO_CHAIN_IDS = [42]
const MAX_OUTCOMES = 16
const MAX_JUDGES = 8

// Default deadline one week out, formatted for a datetime-local input in the viewer's zone
const defaultDeadline = () => {
  const date = new Date(Date.now() + 7 * 24 * 3600 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

// The market id only exists onchain — pull it out of the receipt's MarketCreated event so
// the caller (e.g. the post composer) can attach the market it just created
const marketIdFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: predictAbi, logs: logs ?? [], eventName: 'MarketCreated' })
    return created?.args?.marketId?.toString() || null
  } catch {
    return null
  }
}

const CreateMarketDialog = forwardRef(function CreateMarketDialog({ onCreated, fixedChainId = null }, ref) {
  const dialogRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // Chains where the predict contract is deployed
  const predictChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.predict), [])
  const [chainId, setChainId] = useState(() => fixedChainId ?? predictChains[0]?.id ?? null)

  const chainInfo = predictChains.find((chain) => chain.id === chainId)
  const predictAddress = CONTRACTS[`chain${chainId}`]?.predict
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const publicClient = usePublicClient({ chainId })
  const stakeTokens = TIP_TOKENS[chainId] ?? []
  const isLukso = LUKSO_CHAIN_IDS.includes(chainId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [outcomeLabels, setOutcomeLabels] = useState(['', ''])
  const [opensLocal, setOpensLocal] = useState('')
  const [deadlineLocal, setDeadlineLocal] = useState(defaultDeadline)
  // The creator renders as an explicit, removable first judge instead of invisible
  // default behavior; extra judges are typed below it
  const [includeSelfAsJudge, setIncludeSelfAsJudge] = useState(true)
  const [judgeInputs, setJudgeInputs] = useState([EMPTY_RECIPIENT])
  const [paymentChoice, setPaymentChoice] = useState('native')
  const [customToken, setCustomToken] = useState('')
  const [category, setCategory] = useState('')
  const [featured, setFeatured] = useState(false)
  const [image, setImage] = useState('')
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)
  const imageInputRef = useRef(null)

  // Taxonomy lives in the market_categories DB table (runtime-editable) — the dialog only
  // ever stores the slug in the metadata JSON
  const { data: categoriesPayload } = useSWR('/api/v1/predict/categories', (url) => fetch(url).then((res) => res.json()))
  const categories = categoriesPayload?.data ?? []

  const isCustomToken = paymentChoice === 'custom-erc20' || paymentChoice === 'custom-lsp7'
  const listedToken = paymentChoice.startsWith('token:')
    ? stakeTokens.find((token) => token.address === paymentChoice.slice('token:'.length))
    : null
  const trimmedCustomToken = customToken.trim()
  const tokenAddress =
    paymentChoice === 'native'
      ? zeroAddress
      : listedToken
      ? listedToken.address
      : isCustomToken && isAddress(trimmedCustomToken)
      ? trimmedCustomToken
      : null
  const isTokenLsp7 = paymentChoice === 'custom-lsp7' || Boolean(listedToken?.lsp7)

  // Live platform + creator fees from the chain's contract, so the notice shows the real
  // numbers that will be snapshotted into this market
  const { data: feeBpsValue } = useReadContract({
    abi: predictAbi,
    address: predictAddress || undefined,
    functionName: 'predictFeeBps',
    chainId,
    query: { enabled: Boolean(predictAddress) },
  })
  const { data: creatorFeeBpsValue } = useReadContract({
    abi: predictAbi,
    address: predictAddress || undefined,
    functionName: 'creatorFeeBps',
    chainId,
    query: { enabled: Boolean(predictAddress) },
  })
  const formatBps = (bps) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number(bps) / 100)}%`
  const feeLabel =
    feeBpsValue !== undefined && creatorFeeBpsValue !== undefined ? formatBps(feeBpsValue + creatorFeeBpsValue) : null
  const creatorFeeLabel = creatorFeeBpsValue !== undefined && creatorFeeBpsValue > 0n ? formatBps(creatorFeeBpsValue) : null

  const { data: featuredFeeValue } = useReadContract({
    abi: predictAbi,
    address: predictAddress,
    functionName: 'featuredFee',
    chainId,
    query: { enabled: Boolean(predictAddress) },
  })
  const featuredValue = featured ? featuredFeeValue ?? 0n : 0n

  useImperativeHandle(ref, () => ({
    open: () => {
      // Follow the wallet: opening with the wallet on a predict-deployed chain targets
      // that chain, so the network-mismatch banner only appears when the wallet sits
      // somewhere predict actually isn't
      if (!fixedChainId && walletChain?.id && CONTRACTS[`chain${walletChain.id}`]?.predict) {
        setChainId(walletChain.id)
      }
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading || isSubmittingBurner || isImageUploading

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    toast('Market created — it appears in the directory once the indexer catches up', 'success')
    dialogRef.current?.close()
    const marketId = marketIdFromLogs(receipt?.logs)
    onCreated?.(marketId ? { marketId, chainId } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const setOutcomeLabel = (index, value) => {
    setOutcomeLabels((labels) => labels.map((label, i) => (i === index ? value : label)))
  }

  const setJudgeInput = (index, value) => {
    setJudgeInputs((inputs) => inputs.map((input, i) => (i === index ? value : input)))
  }

  // Device-file picker like the community ImagePicker — uploads to IPFS immediately and
  // keeps the CID in state; the metadata JSON carries it in the `image` field
  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    // Same cap as post media — the server upload route rejects larger payloads anyway
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be under 5 MB', 'error')
      return
    }

    setIsImageUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setImage(cid)
    } catch (err) {
      toast(err.message || 'Image upload failed. Please try again.', 'error')
    } finally {
      setIsImageUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!predictAddress) {
      toast("The predict contract isn't available on this network yet", 'error')
      return
    }

    const labels = outcomeLabels.map((label) => label.trim())
    if (labels.length < 2 || labels.some((label) => !label)) {
      toast('Every outcome needs a name (at least two)', 'error')
      return
    }

    const deadlineUnix = Math.floor(new Date(deadlineLocal).getTime() / 1000)
    if (!Number.isFinite(deadlineUnix) || deadlineUnix <= Math.floor(Date.now() / 1000) + 300) {
      toast('The betting deadline must be at least a few minutes in the future', 'error')
      return
    }

    // Empty = betting opens immediately; a future time lists the market as upcoming
    const opensUnix = opensLocal ? Math.floor(new Date(opensLocal).getTime() / 1000) : 0
    if (!Number.isFinite(opensUnix) || (opensUnix > 0 && opensUnix >= deadlineUnix)) {
      toast('Betting must open before it closes', 'error')
      return
    }

    // A row that resolved gives an address; a row with text that never resolved is an error, and
    // an untouched row is simply not a judge
    if (judgeInputs.some((judge) => judge.input.trim() && !judge.address)) {
      toast('One of the judge addresses is invalid', 'error')
      return
    }
    const extraJudges = judgeInputs.map((judge) => judge.address).filter(Boolean)

    // The creator's entry travels explicitly; an entirely empty list still means the
    // contract defaults to the creator as sole judge
    const judges = [...(includeSelfAsJudge && address ? [address] : []), ...extraJudges]
    if (new Set(judges.map((judge) => judge.toLowerCase())).size !== judges.length) {
      toast('Judge addresses must be unique', 'error')
      return
    }
    if (judges.length > MAX_JUDGES) {
      toast(`At most ${MAX_JUDGES} judges per market`, 'error')
      return
    }

    if (isCustomToken && !tokenAddress) {
      toast('Paste a valid stake token address', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS({
        title: title.trim(),
        description: description.trim(),
        outcomes: labels.map((label) => ({ label })),
        image,
        ...(category ? { category } : {}),
      })
    } catch (err) {
      toast(err.message || 'Failed to upload market details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // An empty judge list defaults to the creator judging their own market (onchain too)
    const args = [address, tokenAddress, isTokenLsp7, BigInt(opensUnix), BigInt(deadlineUnix), labels.length, featured, judges, cid]

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: predictAddress,
          abi: predictAbi,
          functionName: 'createMarket',
          args: [...args, { value: featuredValue }],
        })

        // writeWithBurnerSession already awaited confirmation, so this resolves immediately
        const burnerReceipt = await tx.wait().catch(() => null)

        toast('Market created — it appears in the directory once the indexer catches up', 'success')
        dialogRef.current?.close()
        const marketId = marketIdFromLogs(burnerReceipt?.logs)
        onCreated?.(marketId ? { marketId, chainId } : undefined)
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: predictAbi,
      address: predictAddress,
      functionName: 'createMarket',
      args,
      value: featuredValue,
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.marketDialog}
      aria-label="Create a prediction market"
      onClick={(e) => e.stopPropagation()}
      // This dialog can sit inside the composer or the attach-market picker — React's
      // synthetic close/cancel events propagate up the component tree, so both must stop
      // here or closing this dialog also closes its host
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.stopPropagation()
        // Esc must not discard the form while the upload or transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.marketDialog__body}>
        <header className={styles.marketDialog__header}>
          <h3>New prediction market</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.marketDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.marketDialog__network}>
          <NetworkSelect />
        </div>

        {isWrongChain && (
          <div className={styles.marketDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Markets on {chainInfo?.name || 'this network'} need your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.marketDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {predictChains.length === 0 && <p className={styles.marketDialog__notice}>The predict contract isn&apos;t deployed yet.</p>}

        <form onSubmit={handleSubmit} className={styles.marketDialog__form}>
          {!fixedChainId && predictChains.length > 1 && (
            <label>
              <span>Network</span>
              <select value={chainId ?? ''} onChange={(e) => setChainId(Number(e.target.value))} disabled={isBusy}>
                {predictChains.map((chain) => (
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
              placeholder="e.g. Who will drink more water?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              maxLength={160}
              required
            />
          </label>

          <label>
            <span>Description (optional)</span>
            <textarea
              placeholder="Rules, context, how the judge decides"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={2}
            />
          </label>

          {categories.length > 0 && (
            <label>
              <span>Category (optional)</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={isBusy}>
                <option value="">No category</option>
                {categories.map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.emoji ? `${entry.emoji} ` : ''}
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <fieldset className={styles.marketDialog__list}>
            <legend>Outcomes</legend>
            {outcomeLabels.map((label, index) => (
              <div key={index} className={styles.marketDialog__listRow}>
                <input
                  type="text"
                  placeholder={`Outcome ${index + 1}`}
                  value={label}
                  onChange={(e) => setOutcomeLabel(index, e.target.value)}
                  disabled={isBusy}
                  maxLength={64}
                  required
                />
                {outcomeLabels.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOutcomeLabels((labels) => labels.filter((_, i) => i !== index))}
                    disabled={isBusy}
                    aria-label={`Remove outcome ${index + 1}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
            {outcomeLabels.length < MAX_OUTCOMES && (
              <button type="button" className={styles.marketDialog__listAdd} onClick={() => setOutcomeLabels((labels) => [...labels, ''])} disabled={isBusy}>
                <PlusIcon size={12} />
                Add outcome
              </button>
            )}
          </fieldset>

          <label>
            <span>Betting opens (optional)</span>
            <input type="datetime-local" value={opensLocal} onChange={(e) => setOpensLocal(e.target.value)} disabled={isBusy} />
            <small>Leave empty to open immediately. A future time lists the market as upcoming — visible to everyone, bettable by no one until then.</small>
          </label>

          <label>
            <span>Betting closes</span>
            <input type="datetime-local" value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} disabled={isBusy} required />
            <small>After this time no new bets are accepted. If no judge resolves within the resolve window after it, everyone can reclaim their stake.</small>
          </label>

          <fieldset className={styles.marketDialog__list}>
            <legend>Judges</legend>
            {includeSelfAsJudge && address && (
              <div className={styles.marketDialog__listRow}>
                <span className={styles.marketDialog__selfJudge}>
                  You — <code>{`${address.slice(0, 6)}…${address.slice(-4)}`}</code>
                </span>
                <button type="button" onClick={() => setIncludeSelfAsJudge(false)} disabled={isBusy} aria-label="Remove yourself from the judges">
                  <TrashIcon size={14} />
                </button>
              </div>
            )}
            {judgeInputs.map((judge, index) => (
              <div key={index} className={styles.marketDialog__listRow}>
                <RecipientField
                  className={styles.marketDialog__listField}
                  label={null}
                  value={judge}
                  onChange={(next) => setJudgeInput(index, next)}
                  viewer={address ?? null}
                  // Nobody can judge twice, and the creator's own row is added separately
                  exclude={[
                    address,
                    ...judgeInputs.filter((_, i) => i !== index).map((other) => other.address),
                  ]}
                  placeholder="Name, ENS, or 0x…"
                  disabled={isBusy}
                />
                {judgeInputs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setJudgeInputs((inputs) => inputs.filter((_, i) => i !== index))}
                    disabled={isBusy}
                    aria-label={`Remove judge ${index + 1}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className={styles.marketDialog__listActions}>
              {judgeInputs.length + (includeSelfAsJudge ? 1 : 0) < MAX_JUDGES && (
                <button
                  type="button"
                  className={styles.marketDialog__listAdd}
                  onClick={() => setJudgeInputs((inputs) => [...inputs, EMPTY_RECIPIENT])}
                  disabled={isBusy}
                >
                  <PlusIcon size={12} />
                  Add judge
                </button>
              )}
              {!includeSelfAsJudge && address && (
                <button type="button" className={styles.marketDialog__listAdd} onClick={() => setIncludeSelfAsJudge(true)} disabled={isBusy}>
                  <PlusIcon size={12} />
                  Add yourself back
                </button>
              )}
            </div>
            {!includeSelfAsJudge && judgeInputs.every((judge) => !judge.input.trim()) && (
              <small>No judges picked — the contract will make you the sole judge anyway.</small>
            )}
            <small>
              Judges must accept the role onchain before they can close betting, pick the winning outcome, or cancel — you&apos;re
              accepted automatically. The panel locks at the first bet.
            </small>
          </fieldset>

          <label>
            <span>Stake token</span>
            <select value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value)} disabled={isBusy}>
              <option value="native">{`${chainInfo?.nativeCurrency?.name || 'Native'} (${chainInfo?.nativeCurrency?.symbol || ''})`}</option>
              {stakeTokens.map((token) => (
                <option key={token.address} value={`token:${token.address}`}>
                  {token.symbol}
                </option>
              ))}
              <option value="custom-erc20">Custom ERC20</option>
              {isLukso && <option value="custom-lsp7">Custom LSP7</option>}
            </select>
          </label>

          {isCustomToken && (
            <>
              <label>
                <span>Token address</span>
                <input
                  type="text"
                  placeholder="0x…"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  disabled={isBusy}
                  spellCheck={false}
                  autoComplete="off"
                  required
                />
              </label>
              <div className={styles.marketDialog__tokenWarning}>
                <WarningIcon size={14} />
                <span>
                  Standard tokens only — fee-on-transfer tokens are rejected at bet time, and rebasing tokens break payouts.
                  Double-check the address: bets stake real funds into it.
                </span>
              </div>
            </>
          )}

          <div className={styles.marketDialog__image}>
            <span>Image (optional)</span>
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
            {image && <img src={resolveStorageImageUrl(image, { width: 400 }) || image} alt="" />}
            <div className={styles.marketDialog__imageActions}>
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isBusy}>
                {isImageUploading ? 'Uploading...' : image ? 'Replace image' : 'Choose from device'}
              </button>
              {image && !isImageUploading && (
                <button type="button" onClick={() => setImage('')} disabled={isBusy}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <label className={styles.marketDialog__featured}>
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={isBusy} />
            <StarIcon size={14} weight={featured ? 'fill' : 'regular'} />
            <span>
              Featured — pinned and highlighted in the directory
              {featuredFeeValue && featuredFeeValue > 0n
                ? ` (+${formatEther(featuredFeeValue)} ${chainInfo?.nativeCurrency?.symbol || ''})`
                : ''}
            </span>
          </label>

          <p className={styles.marketDialog__notice}>
            Creating a market is free. {feeLabel ? `A ${feeLabel} fee` : 'A small fee'} is taken from the pot only when the
            market resolves{creatorFeeLabel ? ` — ${creatorFeeLabel} of it goes to you as the creator` : ''}. Refunds are
            always in full.
          </p>

          <button type="submit" disabled={isBusy || !predictAddress || isWrongChain} className={styles.marketDialog__submit}>
            {isUploading ? 'Uploading details...' : isBusy ? 'Confirming...' : 'Create market'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default CreateMarketDialog
