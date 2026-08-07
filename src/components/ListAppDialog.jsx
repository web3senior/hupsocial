'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react'
import { formatEther } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { getStoredBurner, isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { uploadObjectToIPFS } from '@/lib/ipfs'
import appsAbi from '@/abis/HupApps.json'
import { toast } from '@/components/NextToast'
import { InfoIcon, StarIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import ConnectedNetwork from './ConnectedNetwork'
import styles from './ListAppDialog.module.scss'

// Mirrors the embed container hints the indexer accepts — anything wider than 3:1 is clamped
// there, so the options stop short of it rather than silently changing after listing.
const ASPECT_RATIOS = [
  { value: '1:1', label: 'Square (1:1)' },
  { value: '4:3', label: 'Landscape (4:3)' },
  { value: '16:9', label: 'Wide (16:9)' },
  { value: '3:4', label: 'Portrait (3:4)' },
  { value: '9:16', label: 'Tall (9:16)' },
]

/**
 * Registration and edit form for the apps registry.
 *
 * `app` switches the dialog to edit mode: fields prefill from the existing listing and the
 * submit calls updateApp instead of registerApp. Editing is free but not free of consequence —
 * the contract clears `embeddable` on every update, so an approved app drops out of posts until
 * a moderator re-reviews it. That is surfaced in the form rather than discovered afterwards.
 */
const ListAppDialog = forwardRef(function ListAppDialog({ categories = [], app = null, onListed }, ref) {
  const dialogRef = useRef(null)
  const isEdit = Boolean(app)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // Chains where the apps registry is deployed
  const appRegistryChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.apps), [])
  // An edit is pinned to the chain the listing already lives on
  const [chainId, setChainId] = useState(() => app?.network?.id ?? appRegistryChains[0]?.id ?? null)
  // Whether the user explicitly chose a network — once they have, stop following the wallet
  const [chainPicked, setChainPicked] = useState(false)

  // A new listing defaults to whatever network the wallet is already on, when the registry is
  // deployed there — otherwise the dialog opens on a chain the wallet isn't connected to and
  // immediately demands a switch the user never asked for.
  useEffect(() => {
    if (isEdit || chainPicked || !walletChain) return
    if (appRegistryChains.some((chain) => chain.id === walletChain.id)) {
      setChainId(walletChain.id)
    }
  }, [walletChain?.id, isEdit, chainPicked, appRegistryChains])

  const chainInfo = appRegistryChains.find((chain) => chain.id === chainId)
  const appsAddress = CONTRACTS[`chain${chainId}`]?.apps
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || 'native token'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const publicClient = usePublicClient({ chainId })

  const [name, setName] = useState(() => app?.name ?? '')
  const [description, setDescription] = useState(() => app?.description ?? '')
  const [url, setUrl] = useState(() => app?.frameUrl ?? app?.url ?? '')
  const [icon, setIcon] = useState(() => app?.logo ?? '')
  const [repo, setRepo] = useState(() => app?.repo ?? '')
  const [tags, setTags] = useState(() => (app?.tags || []).join(', '))
  const [categoryId, setCategoryId] = useState(() => app?.category?.id ?? categories[0]?.id ?? 1)
  const [aspectRatio, setAspectRatio] = useState(() => app?.aspectRatio ?? '1:1')
  // updateApp takes no featured flag — featuring an existing listing is upgradeToFeatured
  const [featured, setFeatured] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  // Categories arrive from the directory feed, which only lists ones already in use; fall back
  // so a first-time registry on an empty directory still has something to pick.
  const categoryOptions = categories.length ? categories : [{ id: 1, name: 'dApp' }]

  const { data: listingFeeValue } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'listingFee',
    chainId,
    query: { enabled: Boolean(appsAddress) },
  })

  const { data: featuredFeeValue } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'featuredFee',
    chainId,
    query: { enabled: Boolean(appsAddress) },
  })

  // Edits are free; only a new listing pays
  const totalFee = isEdit ? 0n : (listingFeeValue ?? 0n) + (featured ? (featuredFeeValue ?? 0n) : 0n)

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isUploading || isSubmittingBurner

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const successMessage = isEdit
    ? 'App updated — changes appear once the indexer catches up. Embedding is paused until re-review.'
    : 'App listed — it appears in the directory once the indexer catches up'

  useEffect(() => {
    if (!isConfirmed) return
    toast(successMessage, 'success')
    dialogRef.current?.close()
    onListed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!appsAddress) {
      toast("The apps registry isn't available on this network yet", 'error')
      return
    }

    // The frame URL is what a viewer's browser would eventually load, so anything that isn't
    // plain http(s) is rejected here rather than being dropped silently by the indexer.
    const trimmedUrl = url.trim()
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      toast('The app URL must start with http:// or https://', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS({
        name: name.trim(),
        description: description.trim(),
        url: trimmedUrl,
        icon: icon.trim(),
        repo: repo.trim(),
        aspectRatio,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })
    } catch (err) {
      toast(err.message || 'Failed to upload app details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    const functionName = isEdit ? 'updateApp' : 'registerApp'
    const args = isEdit ? [address, BigInt(app.appId), Number(categoryId), cid] : [address, Number(categoryId), featured, cid]

    // Burner session skips the wallet popup (the burner must hold the listing fee); it
    // awaits its own confirmation, so the wagmi isConfirmed side effects replay manually.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      // The burner pays the listing fee out of its own balance. When it can't cover it, fall
      // through to the main wallet instead of surfacing a raw node error after the upload.
      let burnerCanPay = true
      if (totalFee > 0n) {
        const burnerAddress = getStoredBurner()?.address
        const burnerBalance = burnerAddress ? await publicClient?.getBalance({ address: burnerAddress }).catch(() => null) : null
        // Balance must cover fee + gas; an unknown balance still tries the burner first
        if (burnerBalance != null && burnerBalance <= totalFee) burnerCanPay = false
      }

      if (burnerCanPay) {
        setIsSubmittingBurner(true)
        try {
          await writeWithBurnerSession({
            chain: chainInfo,
            contractAddress: appsAddress,
            abi: appsAbi,
            functionName,
            args: [...args, { value: totalFee }],
          })

          toast(successMessage, 'success')
          dialogRef.current?.close()
          onListed?.()
          return
        } catch (err) {
          // The pre-check can miss gas costs or a stale balance — recover the same way
          if (!/insufficient (balance|funds)/i.test(err?.message || '')) {
            toast(err.message || 'Transaction rejected or encountered an error.', 'error')
            return
          }
          burnerCanPay = false
        } finally {
          setIsSubmittingBurner(false)
        }
      }

      if (!burnerCanPay) {
        toast(`Your session wallet can't cover the ${formatEther(totalFee)} ${currencySymbol} fee — confirm with your main wallet instead.`, 'info')
      }
    }

    writeContract({
      abi: appsAbi,
      address: appsAddress,
      functionName,
      args,
      value: totalFee,
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.appDialog}
      aria-label={isEdit ? 'Edit app' : 'List an app'}
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc must not discard the form while the upload or transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.appDialog__body}>
        <header className={styles.appDialog__header}>
          <h3>{isEdit ? `Edit ${app.name || 'app'}` : 'List your app'}</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.appDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <ConnectedNetwork className={styles.appDialog__network} />

        {isWrongChain && (
          <div className={styles.appDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Listing on {chainInfo?.name || 'this network'} needs your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.appDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {appRegistryChains.length === 0 && <p className={styles.appDialog__notice}>The apps registry isn&apos;t deployed yet.</p>}

        <form onSubmit={handleSubmit} className={styles.appDialog__form}>
          {/* A listing lives on one chain forever, so edit mode never offers a selector */}
          {!isEdit && appRegistryChains.length > 1 ? (
            <label>
              <span>Network</span>
              <select
                value={chainId ?? ''}
                onChange={(e) => {
                  setChainPicked(true)
                  setChainId(Number(e.target.value))
                }}
                disabled={isBusy}
              >
                {appRegistryChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            chainInfo && (
              // With a single deployment there is no selector, and the row above shows the
              // wallet's network — which is usually a different chain. Name the destination
              // explicitly so the listing target is never left implied.
              <p className={styles.appDialog__target}>
                {isEdit ? 'Listed on' : 'Listing on'} <strong>{chainInfo.name}</strong>
                {isEdit ? ` — app #${app.appId}` : ''}
              </p>
            )
          )}

          <label>
            <span>App name</span>
            <input
              type="text"
              placeholder="e.g. Pixel Minter"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy}
              maxLength={120}
              required
            />
          </label>

          <label>
            <span>Description (optional)</span>
            <textarea
              placeholder="What it does, who it's for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={3}
            />
          </label>

          <label>
            <span>App URL</span>
            <input type="url" placeholder="https://yourapp.xyz" value={url} onChange={(e) => setUrl(e.target.value)} disabled={isBusy} required />
          </label>

          <div className={styles.appDialog__pair}>
            <label>
              <span>Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))} disabled={isBusy}>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Embed shape</span>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={isBusy}>
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>Icon URL (optional)</span>
            <input type="url" placeholder="https://..." value={icon} onChange={(e) => setIcon(e.target.value)} disabled={isBusy} />
          </label>

          <label>
            <span>Repository (optional)</span>
            <input type="url" placeholder="https://github.com/..." value={repo} onChange={(e) => setRepo(e.target.value)} disabled={isBusy} />
          </label>

          <label>
            <span>Tags (optional) — comma separated</span>
            <input type="text" placeholder="game, nft, mint" value={tags} onChange={(e) => setTags(e.target.value)} disabled={isBusy} maxLength={200} />
          </label>

          {/* updateApp takes no featured flag — featuring later is a separate paid upgrade */}
          {!isEdit && (
            <label className={styles.appDialog__featured}>
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={isBusy} />
              <StarIcon size={14} weight={featured ? 'fill' : 'regular'} />
              <span>
                Featured — pinned and highlighted in the directory
                {featuredFeeValue && featuredFeeValue > 0n ? ` (+${formatEther(featuredFeeValue)} ${currencySymbol})` : ''}
              </span>
            </label>
          )}

          <p className={styles.appDialog__review}>
            {isEdit ? <WarningIcon size={14} /> : <InfoIcon size={14} />}
            <span>
              {isEdit
                ? 'Saving updates the onchain listing and pauses embedding until a moderator re-reviews the app. Directory changes appear once the indexer catches up.'
                : 'Listing publishes your app to the directory straight away. Running inside a post is a separate step — apps are reviewed before they can be embedded, and editing a listing sends it back for review.'}
            </span>
          </p>

          <p className={styles.appDialog__notice}>
            {isEdit
              ? 'Editing is free — only gas is paid.'
              : totalFee > 0n
                ? `Listing fee: ${formatEther(totalFee)} ${currencySymbol}, paid onchain with the transaction.`
                : "No listing fee on this network — it's free to list."}
          </p>

          <button type="submit" disabled={isBusy || !appsAddress || isWrongChain} className={styles.appDialog__submit}>
            {/* Promising a payment the transaction never asks for reads as a bait-and-switch */}
            {isUploading
              ? 'Uploading details...'
              : isBusy
                ? 'Confirming...'
                : isEdit
                  ? 'Save changes'
                  : totalFee > 0n
                    ? 'Pay & list app'
                    : 'List app'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default ListAppDialog
