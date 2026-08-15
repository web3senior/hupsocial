'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { formatEther, parseEther, parseEventLogs } from 'viem'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { TOTAL_SUPPLY, estimateOpeningBuy, formatNative, formatTokenAmount } from '@/lib/launch'
import launchAbi from '@/abis/HupLaunch.json'
import { toast } from '@/components/NextToast'
import { CheckCircleIcon, ImageIcon, LightningIcon, RocketLaunchIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './CreateLaunchDialog.module.scss'

const MAX_NAME_LENGTH = 32
const MAX_SYMBOL_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 280

// Buy-size presets as a share of total supply, matching how creators actually think about a dev
// buy ("I want 1% of the coin") rather than in units of native
const BUY_PRESETS = [0.5, 1, 2, 5]

const launchRefFromLogs = (logs) => {
  try {
    const [created] = parseEventLogs({ abi: launchAbi, logs: logs ?? [], eventName: 'LaunchCreated' })
    if (!created?.args?.launchId) return null
    return { launchId: created.args.launchId.toString(), token: created.args.token }
  } catch {
    return null
  }
}

// A ticker is uppercase alphanumerics — strip as the user types rather than rejecting on submit
const normalizeSymbol = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_SYMBOL_LENGTH)

/**
 * Create Launch Dialog
 * Three steps: token info, review, live. Image and description arrive prefilled when the dialog
 * is opened from the post composer, so in practice the author only types a name and a ticker.
 *
 * @param {Object} props
 * @param {number} props.fixedChainId The chain to launch on.
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, used as the token image.
 * @param {string} [props.prefillDescription] Post text, seeding the token description.
 * @param {boolean} [props.showSuccessStep] Show the "it's live" step with a link to the token page.
 *        The composer skips it — there the launch is one part of publishing a post, not the end
 *        of a flow — while the standalone page ends here.
 * @param {Function} props.onCreated Receives { launchId, token, chainId } once the tx confirms.
 */
const CreateLaunchDialog = forwardRef(function CreateLaunchDialog(
  { fixedChainId, prefillImage = '', prefillDescription = '', showSuccessStep = false, onCreated },
  ref,
) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()

  const chainId = fixedChainId
  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const launchAddress = CONTRACTS[`chain${chainId}`]?.launch
  const publicClient = usePublicClient({ chainId })
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'

  const [step, setStep] = useState('form')
  const [image, setImage] = useState(prefillImage)
  const [imageName, setImageName] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState(prefillDescription.slice(0, MAX_DESCRIPTION_LENGTH))
  const [takeCreatorFee, setTakeCreatorFee] = useState(false)
  const [bundleBuy, setBundleBuy] = useState(false)
  const [buyPercent, setBuyPercent] = useState(1)
  const [agreed, setAgreed] = useState(false)
  const [created, setCreated] = useState(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  // The composer may finish uploading the post's image after this dialog mounts
  useEffect(() => {
    if (prefillImage) setImage(prefillImage)
  }, [prefillImage])

  const contractRead = { chainId, query: { enabled: Boolean(launchAddress) } }
  const { data: creationFee = 0n } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'creationFee',
    ...contractRead,
  })
  const { data: creatorShareBps = 0 } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'defaultCreatorShareBps',
    ...contractRead,
  })
  const { data: openingSupplyValue = 0n } = useReadContract({
    abi: launchAbi,
    address: launchAddress,
    functionName: 'openingSupplyValue',
    ...contractRead,
  })

  // The creator's share is bps of collected LP fees; on the 0.30% tier that works out to bps of
  // buy volume — 1667 of fees ≈ 5bps of volume, mirroring pools.trade's "5bps of the 25bps"
  const creatorVolumeBps = Math.round((Number(creatorShareBps) * 30) / 10_000)

  useImperativeHandle(ref, () => ({
    open: () => {
      setStep('form')
      setAgreed(false)
      setCreated(null)
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

  const settle = (launchRef) => {
    toast(`$${symbol} is live`, 'success')
    const payload = launchRef ? { ...launchRef, chainId } : undefined

    if (showSuccessStep && payload) {
      setCreated(payload)
      setStep('live')
    } else {
      dialogRef.current?.close()
    }
    onCreated?.(payload)
  }

  useEffect(() => {
    if (!isConfirmed) return
    settle(launchRefFromLogs(receipt?.logs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleImageSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be under 5 MB', 'error')
      return
    }

    setIsImageUploading(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setImage(cid)
      setImageName(file.name)
    } catch (err) {
      toast(err.message || 'Image upload failed. Please try again.', 'error')
    } finally {
      setIsImageUploading(false)
    }
  }

  const buyTokens = useMemo(
    () => (TOTAL_SUPPLY * BigInt(Math.round(buyPercent * 100))) / 10_000n,
    [buyPercent],
  )
  // Priced against the launch position's closed form — the pool doesn't exist yet, so the
  // chain's quoter can't answer; the factory fills this exact swap atomically at creation
  const openingBuyWei = useMemo(
    () => (bundleBuy ? estimateOpeningBuy(openingSupplyValue, buyTokens) : 0n),
    [bundleBuy, openingSupplyValue, buyTokens],
  )

  const canReview = Boolean(image && name.trim() && symbol && description.trim() && !isBusy)

  const handleReview = (event) => {
    event.preventDefault()
    if (!canReview) {
      toast('Image, name, ticker, and description are all required', 'error')
      return
    }
    setStep('review')
  }

  const handleLaunch = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!launchAddress) {
      toast("Token launches aren't available on this network yet", 'error')
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS({
        name: name.trim(),
        symbol,
        description: description.trim(),
        image,
      })
    } catch (err) {
      toast(err.message || 'Failed to upload token details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    const args = [address, name.trim(), symbol, takeCreatorFee, cid]
    // Anything above the creation fee is filled as the creator's opening buy, in the same
    // transaction — there is no block in which the token exists and the creator has not bought
    const value = creationFee + openingBuyWei

    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: launchAddress,
          abi: launchAbi,
          functionName: 'createLaunch',
          args: [...args, { value }],
        })

        const burnerReceipt = await tx.wait().catch(() => null)
        settle(launchRefFromLogs(burnerReceipt?.logs))
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: launchAbi,
      address: launchAddress,
      functionName: 'createLaunch',
      args,
      value,
      chainId,
    })
  }

  const imageUrl = image ? resolveStorageImageUrl(image) : null

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.launchDialog}
      aria-label="Launch a token"
      onClick={(e) => e.stopPropagation()}
      // Rendered inside the composer and inside the attach picker — React's synthetic
      // close/cancel events propagate up the tree, so both must stop here or closing this
      // dialog closes its host too
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <header className={styles.launchDialog__header}>
        {step !== 'live' && (
          <button
            type="button"
            className={styles.launchDialog__cancel}
            onClick={() => (step === 'review' ? setStep('form') : dialogRef.current?.close())}
          >
            {step === 'review' ? 'Back' : 'Cancel'}
          </button>
        )}
        <h3>{step === 'review' ? 'Review' : step === 'live' ? 'Launched' : 'Token info'}</h3>
      </header>

      {step === 'form' && (
        <form className={styles.launchDialog__body} onSubmit={handleReview}>
          <div className={styles.launchDialog__identity}>
            <label className={clsx(styles.launchDialog__image, imageUrl && styles['launchDialog__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.launchDialog__imageHint}>
              {imageUrl ? (
                <>
                  <strong>{imageName || 'Token image'}</strong>
                  <span className={styles.launchDialog__imageActions}>
                    <label>
                      Edit
                      <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setImage('')
                        setImageName('')
                      }}
                      disabled={isBusy}
                    >
                      Delete
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <strong>Token image {isImageUploading && <em>uploading…</em>}</strong>
                  <small>256px or larger. Pulled from your post if it has one.</small>
                </>
              )}
            </div>
          </div>

          <div className={styles.launchDialog__row}>
            <label className={styles.launchDialog__field}>
              <span>Token name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Untitled Token"
                onChange={(e) => setName(e.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className={styles.launchDialog__field}>
              <span>Ticker symbol</span>
              <input
                type="text"
                value={symbol}
                placeholder="$TICKER"
                onChange={(e) => setSymbol(normalizeSymbol(e.target.value))}
                disabled={isBusy}
              />
            </label>
          </div>

          <label className={styles.launchDialog__field}>
            <span>
              Description
              <em className={styles.launchDialog__counter}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </em>
            </span>
            <textarea
              rows={3}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="Briefly describe your token"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </label>

          <div className={styles.launchDialog__toggle}>
            <div>
              <strong>Creator fee</strong>
              <small>
                Receive {creatorVolumeBps}bps of the 30bps LP fee on each buy. Paid in {nativeSymbol}, claimable to
                any address. Off by default — a token with no creator fee reads as cleaner to buyers, and the setting
                shows on the card either way.
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={takeCreatorFee}
              aria-label="Take a creator fee on each buy"
              className={clsx(styles.launchDialog__switch, takeCreatorFee && styles['launchDialog__switch--on'])}
              onClick={() => setTakeCreatorFee((on) => !on)}
              disabled={isBusy}
            />
          </div>

          <div className={styles.launchDialog__toggle}>
            <div>
              <strong>Buy pre-launch</strong>
              <small>Bundle a ${symbol || 'TOKEN'} buy into the launch transaction, so nobody can front-run you.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={bundleBuy}
              aria-label="Bundle a buy with the launch"
              className={clsx(styles.launchDialog__switch, bundleBuy && styles['launchDialog__switch--on'])}
              onClick={() => setBundleBuy((on) => !on)}
              disabled={isBusy}
            />
          </div>

          {bundleBuy && (
            <div className={styles.launchDialog__buySize}>
              <div className={styles.launchDialog__presets}>
                <span>Buy size, % of supply</span>
                <div>
                  {BUY_PRESETS.map((percent) => (
                    <button
                      type="button"
                      key={percent}
                      className={clsx(buyPercent === percent && styles['launchDialog__preset--active'])}
                      onClick={() => setBuyPercent(percent)}
                      disabled={isBusy}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>
              <p className={styles.launchDialog__buyQuote}>
                <strong>
                  {formatTokenAmount(buyTokens)} ${symbol || 'TOKEN'}
                </strong>
                <span>
                  {formatNative(openingBuyWei)} {nativeSymbol}
                </span>
              </p>
            </div>
          )}

          <button type="submit" className={styles.launchDialog__submit} disabled={!canReview}>
            Review
          </button>
        </form>
      )}

      {step === 'review' && (
        <div className={styles.launchDialog__body}>
          <div className={styles.launchDialog__preview}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <div>
              <strong>{name.trim()}</strong>
              <span>${symbol}</span>
              <p>{description.trim()}</p>
            </div>
            <span className={styles.launchDialog__mode}>
              <LightningIcon size={12} weight="fill" />
              Instant
            </span>
          </div>

          <dl className={styles.launchDialog__facts}>
            <div>
              <dt>Tradable</dt>
              <dd>Immediately</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>
                {formatTokenAmount(TOTAL_SUPPLY)}, fixed forever
                <small>Entire supply mapped to bonding curve</small>
              </dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>Locked forever · fees auto-compound</dd>
            </div>
            <div>
              <dt>Creator fee</dt>
              <dd>{takeCreatorFee ? `${creatorVolumeBps}bps of LP fees on buys` : 'None'}</dd>
            </div>
            <div>
              <dt>Pre-launch buy</dt>
              <dd>
                {openingBuyWei > 0n ? (
                  <>
                    {formatTokenAmount(buyTokens)} ${symbol}
                    <small>
                      {formatNative(openingBuyWei)} {nativeSymbol}
                    </small>
                  </>
                ) : (
                  'None'
                )}
              </dd>
            </div>
            {creationFee > 0n && (
              <div>
                <dt>Creation fee</dt>
                <dd>
                  {formatEther(creationFee)} {nativeSymbol}
                </dd>
              </div>
            )}
          </dl>

          <label className={styles.launchDialog__agree}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={isBusy} />
            <span>
              <strong>I understand and agree to the following</strong>
              Hup Launch uses one standard configuration for every launch, intended for memecoins — tokens made for
              entertainment and culture, whose price comes from demand alone. Nobody is working to make this token
              valuable. It is extremely volatile, it may go to zero, and it carries none of the protections a regulated
              asset would. Launching anything other than a memecoin is not allowed here.
            </span>
          </label>

          <button
            type="button"
            className={styles.launchDialog__submit}
            onClick={handleLaunch}
            disabled={isBusy || !address || !agreed}
          >
            <RocketLaunchIcon size={16} weight="fill" />
            {isBusy ? 'Launching…' : 'Launch now'}
          </button>
        </div>
      )}

      {step === 'live' && created && (
        <div className={clsx(styles.launchDialog__body, styles.launchDialog__done)}>
          <span className={styles.launchDialog__doneMark}>
            {imageUrl && <img src={imageUrl} alt="" />}
            <CheckCircleIcon size={26} weight="fill" />
          </span>
          <h4>{name.trim()} is live</h4>
          <p>Live on Uniswap — tradable anywhere, liquidity locked forever.</p>

          <Link
            href={`/launches/${chainId}/${created.launchId}`}
            className={styles.launchDialog__submit}
            onClick={() => dialogRef.current?.close()}
          >
            View token
          </Link>
        </div>
      )}
    </NativeDialog>
  )
})

export default CreateLaunchDialog
