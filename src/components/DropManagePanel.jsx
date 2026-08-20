'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import clsx from 'clsx'
import { formatEther, isAddress, zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { hashIpfsContent, uploadFileToIPFS, uploadObjectToIPFS } from '@/lib/ipfs'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import {
  DROP_SOCIALS,
  LSP4_DATA_KEYS,
  buildDropLinks,
  buildLsp4MetadataJson,
  encodeVerifiableURIFromDigest,
  formatPhaseTime,
  gateLabel,
  isLuksoStandard,
  parseDropLinks,
  phaseStatus,
  PHASE_STATUS,
} from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import collectionAbi from '@/abis/HupDropCollection.json'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import { ImageIcon, PencilSimpleIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import styles from './DropManagePanel.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 6 })
const countFormat = new Intl.NumberFormat('en')
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const formatNative = (wei) => amountFormat.format(Number(formatEther(BigInt(wei ?? 0))))

const normalizeIpfsUri = (value) => (value?.startsWith('ipfs://') ? value : `ipfs://${value}`)

const MAX_DESCRIPTION_LENGTH = 1000

/**
 * Drop Manage Panel
 * The creator's Universal Page-style control surface on the drop detail page: revenue and
 * activity from the cidex index, the immutable phase schedule with live status, a collection
 * metadata editor (IPFS upload + onchain reference, updatable until freezeMetadata), and the
 * permanent close switch. Renders nothing unless the connected wallet is the drop's creator —
 * everything here is also enforced onchain, the gate is just UI.
 *
 * @param {Object} props
 * @param {number} props.chainId
 * @param {string} props.dropId
 * @param {Object} props.drop The live drop struct from getDrop.
 * @param {string} props.collection The drop's collection contract.
 * @param {Object} props.collectionIdentity Resolved { name, symbol, description, image, links }.
 * @param {Function} [props.onMetadataUpdated] Re-fetches collection metadata after an edit.
 * @param {Function} [props.onClosed] Re-fetches the drop struct after closing.
 */
export default function DropManagePanel({ chainId, dropId, drop, collection, collectionIdentity, onMetadataUpdated, onClosed }) {
  const { address, chain: walletChain } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  const standardId = drop ? Number(drop.standardId) : undefined
  const isLukso = isLuksoStandard(standardId)
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  const isCreator = Boolean(address && drop?.creator && address.toLowerCase() === drop.creator.toLowerCase())

  const editDialogRef = useRef(null)
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [icon, setIcon] = useState('')
  const [banner, setBanner] = useState('')
  const [socials, setSocials] = useState({ website: '', x: '', discord: '', telegram: '', instagram: '' })
  const [linkRows, setLinkRows] = useState([])
  const [isSavingMetadata, setIsSavingMetadata] = useState(false)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [isBannerUploading, setIsBannerUploading] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  // Index of the phase whose start/pause transaction is in flight, or null
  const [phaseBusy, setPhaseBusy] = useState(null)
  const [royaltyReceiverDraft, setRoyaltyReceiverDraft] = useState('')
  const [royaltyBpsDraft, setRoyaltyBpsDraft] = useState('')
  const [confirmFreeze, setConfirmFreeze] = useState(false)

  // Indexed history — gracefully absent until the cidex drops runner has scanned this chain
  const { data: indexed } = useSWR(isCreator ? `/api/v1/drops/${dropId}?networkId=${chainId}` : null, fetcher, {
    refreshInterval: 30_000,
  })
  const totals = indexed?.data?.totals
  const mints = indexed?.data?.mints ?? []

  const { data: phases = [], refetch: refetchPhases } = useReadContract({
    abi: dropsAbi,
    address: dropsAddress,
    functionName: 'phasesOf',
    args: [BigInt(dropId)],
    chainId,
    query: { enabled: Boolean(dropsAddress && isCreator) },
  })

  const collectionRead = { abi: collectionAbi, address: collection ?? undefined, chainId, query: { enabled: Boolean(collection && isCreator) } }
  const { data: metadataFrozen = false, refetch: refetchFrozen } = useReadContract({ ...collectionRead, functionName: 'metadataFrozen' })
  const { data: royaltyReceiver, refetch: refetchRoyaltyReceiver } = useReadContract({ ...collectionRead, functionName: 'royaltyReceiver' })
  const { data: royaltyBps = 0n, refetch: refetchRoyaltyBps } = useReadContract({ ...collectionRead, functionName: 'royaltyBps' })

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })
  const pendingActionRef = useRef(null)
  const isBusy = isPending || isConfirming || isSavingMetadata || isClosing || isImageUploading || isBannerUploading || phaseBusy !== null

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed || !pendingActionRef.current) return
    const action = pendingActionRef.current
    pendingActionRef.current = null

    if (action === 'metadata') {
      toast('Collection metadata updated', 'success')
      editDialogRef.current?.close()
      // The onchain pointer changed; the JSON behind the old gateway URL is stale now
      setTimeout(() => onMetadataUpdated?.(), 1500)
    }
    if (action === 'close') {
      toast('Drop closed — minting has ended for good', 'success')
      setConfirmClose(false)
      onClosed?.()
    }
    if (action === 'phase') {
      toast('Phase updated', 'success')
      setPhaseBusy(null)
      refetchPhases()
    }
    if (action === 'royalty') {
      toast('Royalty updated', 'success')
      refetchRoyaltyReceiver()
      refetchRoyaltyBps()
    }
    if (action === 'freeze') {
      toast('Metadata frozen forever', 'success')
      setConfirmFreeze(false)
      refetchFrozen()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  // Seed the royalty inputs from chain once, then leave the creator's edits alone
  useEffect(() => {
    if (royaltyReceiver === undefined) return
    setRoyaltyReceiverDraft((prev) => prev || (royaltyReceiver !== zeroAddress ? royaltyReceiver : ''))
    setRoyaltyBpsDraft((prev) => (prev === '' ? String(Number(royaltyBps) / 100) : prev))
  }, [royaltyReceiver, royaltyBps])

  if (!isCreator) return null

  const openEditor = () => {
    setDescription(collectionIdentity?.description ?? '')
    setImage(collectionIdentity?.image ?? '')
    setIcon(collectionIdentity?.icon ?? '')
    setBanner(collectionIdentity?.banner ?? '')
    // Stored links split back into the dedicated social fields plus free-form extras
    const { socials: storedSocials, extra } = parseDropLinks(collectionIdentity?.links ?? [])
    setSocials(storedSocials)
    setLinkRows(extra)
    editDialogRef.current?.open()
  }

  /**
   * One uploader for all three collection images (artwork, icon, banner) — same limits, same
   * IPFS path, only the target state differs.
   */
  const handleImageUpload = (setter, label, setBusy) => async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(`${label} must be under 10 MB`, 'error')
      return
    }

    setBusy(true)
    try {
      const cid = await uploadFileToIPFS(file)
      if (!cid) throw new Error('Upload failed')
      setter(cid)
    } catch (err) {
      toast(err.message || `${label} upload failed. Please try again.`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleImageSelect = handleImageUpload(setImage, 'Image', setIsImageUploading)
  const handleIconSelect = handleImageUpload(setIcon, 'Icon', setIsImageUploading)
  const handleBannerSelect = handleImageUpload(setBanner, 'Banner', setIsBannerUploading)

  const handleSaveMetadata = async () => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const links = buildDropLinks(socials, linkRows)

    setIsSavingMetadata(true)
    let uri
    let metadataHash = null
    try {
      const imageUri = image ? normalizeIpfsUri(image) : ''
      const iconUri = icon ? normalizeIpfsUri(icon) : ''
      const bannerUri = banner ? normalizeIpfsUri(banner) : ''

      // Every LSP4 media entry republishes with the keccak256 of the bytes its CID serves —
      // hashed here for all three, since an untouched image is as much part of this document
      // as one uploaded a moment ago
      const [imageHash, iconHash, backgroundImageHash] = isLukso
        ? await Promise.all([
            imageUri ? hashIpfsContent(imageUri) : null,
            iconUri ? hashIpfsContent(iconUri) : null,
            bannerUri ? hashIpfsContent(bannerUri) : null,
          ])
        : [null, null, null]

      const metadata = isLukso
        ? buildLsp4MetadataJson({
            name: collectionIdentity?.name ?? '',
            description: description.trim(),
            imageUrl: imageUri,
            imageHash,
            iconUrl: iconUri,
            iconHash,
            backgroundImageUrl: bannerUri,
            backgroundImageHash,
            links,
          })
        : {
            name: collectionIdentity?.name ?? '',
            symbol: collectionIdentity?.symbol ?? '',
            description: description.trim(),
            image: imageUri,
            ...(iconUri ? { icon: iconUri } : {}),
            ...(bannerUri ? { banner_image: bannerUri } : {}),
            ...(socials.website.trim() ? { external_link: socials.website.trim() } : {}),
            links,
          }
      uri = normalizeIpfsUri(await uploadObjectToIPFS(metadata))
      // The data key holds a VerifiableURI over the JSON the gateway serves, not over what we
      // posted — the pinning service re-serializes it
      if (isLukso) metadataHash = await hashIpfsContent(uri)
    } catch (err) {
      toast(err.message || 'Failed to upload metadata', 'error')
      setIsSavingMetadata(false)
      return
    }
    setIsSavingMetadata(false)

    pendingActionRef.current = 'metadata'
    // The collection is creator-owned (onlyOwner) — the wallet signs directly, no burner path
    if (isLukso) {
      writeContract({
        abi: collectionAbi,
        address: collection,
        functionName: 'setData',
        args: [LSP4_DATA_KEYS.metadata, encodeVerifiableURIFromDigest(uri, metadataHash)],
        chainId,
      })
    } else {
      writeContract({
        abi: collectionAbi,
        address: collection,
        functionName: 'setContractURI',
        args: [uri],
        chainId,
      })
    }
  }

  /**
   * Updates the collection's ERC2981 royalty. Unlike the mint phases this stays editable for
   * good — it governs secondary sales, which outlive the drop. 0% clears it entirely.
   */
  const handleSetRoyalty = () => {
    const percent = Number(royaltyBpsDraft)
    if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
      toast('Royalty must be between 0% and 10%', 'error')
      return
    }

    const bps = Math.round(percent * 100)
    const receiver = royaltyReceiverDraft.trim() || address
    if (bps > 0 && !isAddress(receiver)) {
      toast('Enter a valid receiver address', 'error')
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    pendingActionRef.current = 'royalty'
    writeContract({
      abi: collectionAbi,
      address: collection,
      functionName: 'setRoyalty',
      // A zero receiver is only legal alongside zero bps, which is how the contract clears it
      args: [bps === 0 ? zeroAddress : receiver, BigInt(bps)],
      chainId,
    })
  }

  /**
   * Locks the metadata pointer forever. Irreversible, so it takes two presses — the same
   * shape as closing the drop.
   */
  const handleFreeze = () => {
    if (!confirmFreeze) {
      setConfirmFreeze(true)
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    pendingActionRef.current = 'freeze'
    writeContract({ abi: collectionAbi, address: collection, functionName: 'freezeMetadata', args: [], chainId })
  }

  /**
   * Starts or pauses one phase. The window, price, and gate stay immutable — this is only the
   * on/off switch, and it flips as many times as the creator likes.
   */
  const handleTogglePhase = async (phaseIndex, paused) => {
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    const args = [BigInt(dropId), BigInt(phaseIndex), paused]
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    setPhaseBusy(phaseIndex)

    if (session.active) {
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'setPhasePaused',
          args,
        })
        await tx.wait().catch(() => null)
        toast(paused ? 'Phase paused' : 'Phase started', 'success')
        refetchPhases()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setPhaseBusy(null)
      }
      return
    }

    pendingActionRef.current = 'phase'
    writeContract({ abi: dropsAbi, address: dropsAddress, functionName: 'setPhasePaused', args, chainId })
  }

  const handleClose = async () => {
    if (!confirmClose) {
      setConfirmClose(true)
      return
    }
    if (isWrongChain) {
      toast(`Switch your wallet to ${chainInfo?.name || 'the right network'} first`, 'error')
      return
    }

    // closeDrop accepts the creator's active burner session too — same convenience as minting
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsClosing(true)
      try {
        const tx = await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: dropsAddress,
          abi: dropsAbi,
          functionName: 'closeDrop',
          args: [BigInt(dropId)],
        })
        await tx.wait().catch(() => null)
        toast('Drop closed — minting has ended for good', 'success')
        setConfirmClose(false)
        onClosed?.()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsClosing(false)
      }
      return
    }

    pendingActionRef.current = 'close'
    writeContract({
      abi: dropsAbi,
      address: dropsAddress,
      functionName: 'closeDrop',
      args: [BigInt(dropId)],
      chainId,
    })
  }

  const isClosed = Boolean(drop?.closed)
  const imageUrl = image ? resolveStorageImageUrl(image) : null
  const iconUrl = icon ? resolveStorageImageUrl(icon) : null

  return (
    <section className={styles.manage}>
      <header className={styles.manage__header}>
        <div>
          <h2>Manage drop</h2>
          <small>Only you see this — you created this drop.</small>
        </div>
        <button type="button" className={styles.manage__edit} onClick={openEditor} disabled={isBusy || metadataFrozen}>
          <PencilSimpleIcon size={14} />
          {metadataFrozen ? 'Metadata frozen' : 'Edit metadata'}
        </button>
      </header>

      <div className={styles.manage__stats}>
        <div className={styles.manage__stat}>
          <span>Revenue</span>
          <strong>
            {totals ? `${formatNative(totals.gross)} ${nativeSymbol}` : '—'}
          </strong>
          {totals && Number(totals.fees) + Number(totals.referrals) > 0 && (
            <small>
              after {formatNative(totals.fees)} fees · {formatNative(totals.referrals)} referrals
            </small>
          )}
        </div>
        <div className={styles.manage__stat}>
          <span>Items minted</span>
          <strong>{totals ? countFormat.format(totals.items_minted) : countFormat.format(Number(drop?.minted ?? 0))}</strong>
        </div>
        <div className={styles.manage__stat}>
          <span>Mint transactions</span>
          <strong>{totals ? countFormat.format(totals.mint_count) : '—'}</strong>
        </div>
      </div>

      {indexed && indexed.indexed === false && (
        <p className={styles.manage__hint}>Revenue and activity appear once the indexer has scanned this drop.</p>
      )}

      {phases.length > 0 && (
        <div className={styles.manage__phases}>
          <h3>Phases</h3>
          <ul>
            {phases.map((phase, index) => {
              const status = phaseStatus(phase)
              const isEnded = status === PHASE_STATUS.ENDED
              return (
                <li key={index}>
                  <span className={clsx(styles.manage__phaseStatus, styles[`manage__phaseStatus--${status}`])}>
                    {status === PHASE_STATUS.LIVE
                      ? 'Live'
                      : status === PHASE_STATUS.PAUSED
                        ? 'Paused'
                        : status === PHASE_STATUS.UPCOMING
                          ? 'Upcoming'
                          : 'Ended'}
                  </span>
                  <span className={styles.manage__phaseName}>Phase {index + 1}</span>
                  <span className={styles.manage__phaseMeta}>
                    {phase.price === 0n ? 'Free' : `${formatNative(phase.price)} ${nativeSymbol}`} · {gateLabel(Number(phase.gate))}
                    {formatPhaseTime(phase.startTime) ? ` · ${formatPhaseTime(phase.startTime)}` : ''}
                    {Number(phase.endTime) > 0 ? ` → ${formatPhaseTime(phase.endTime)}` : ' → open-ended'}
                  </span>
                  <span className={styles.manage__phaseMinted}>{countFormat.format(Number(phase.minted))} minted</span>

                  {/* An ended phase has nothing left to switch on — its window is gone */}
                  {!isClosed && !isEnded && (
                    <button
                      type="button"
                      className={clsx(styles.manage__phaseToggle, phase.paused && styles['manage__phaseToggle--start'])}
                      onClick={() => handleTogglePhase(index, !phase.paused)}
                      disabled={isBusy}
                    >
                      {phaseBusy === index ? '…' : phase.paused ? 'Start' : 'Pause'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className={styles.manage__hint}>
            Start and pause as often as you like. Everything else — window, price, limits, gate — is fixed forever at
            creation; closing the drop is the only other override.
          </p>
        </div>
      )}

      {/* Royalties govern secondary sales, so unlike the mint phases they stay editable —
          right up until the creator freezes metadata */}
      <div className={styles.manage__royalty}>
        <h3>Royalty</h3>
        <div className={styles.manage__royaltyRow}>
          <label className={styles.manage__field}>
            <span>Percentage (max 10%)</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={royaltyBpsDraft}
              placeholder="0"
              onChange={(e) => setRoyaltyBpsDraft(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className={styles.manage__field}>
            <span>Receiver</span>
            <input
              type="text"
              value={royaltyReceiverDraft}
              placeholder={address ?? '0x…'}
              onChange={(e) => setRoyaltyReceiverDraft(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <button type="button" className={styles.manage__phaseToggle} onClick={handleSetRoyalty} disabled={isBusy}>
            Save
          </button>
        </div>
        <p className={styles.manage__hint}>
          Currently {Number(royaltyBps) / 100}% {Number(royaltyBps) > 0 && royaltyReceiver ? `to ${shortAddress(royaltyReceiver)}` : ''} — ERC2981,
          honoured by marketplaces that support it. 0% clears it.
        </p>
      </div>

      {mints.length > 0 && (
        <div className={styles.manage__activity}>
          <h3>Activity</h3>
          <table>
            <thead>
              <tr>
                <th>Minter</th>
                <th>Items</th>
                <th>Paid</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {mints.map((mint) => (
                <tr key={mint.tx_hash + mint.first_token_id}>
                  <td>{mint.display_name || shortAddress(mint.minter)}</td>
                  <td>{countFormat.format(mint.quantity)}</td>
                  <td>
                    {Number(mint.total_paid) === 0 ? 'Free' : `${formatNative(mint.total_paid)} ${nativeSymbol}`}
                  </td>
                  <td>{mint.minted_at ? dateTimeFormat.format(new Date(mint.minted_at)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!metadataFrozen && (
        <div className={styles.manage__danger}>
          <div>
            <strong>Freeze metadata</strong>
            <small>
              Locks the collection&rsquo;s metadata pointer forever — no more edits to the artwork, description, or links.
              Collectors read a frozen collection as one that can&rsquo;t be rug-edited after they mint.
            </small>
          </div>
          <button
            type="button"
            className={clsx(styles.manage__close, confirmFreeze && styles['manage__close--armed'])}
            onClick={handleFreeze}
            disabled={isBusy}
          >
            {confirmFreeze ? 'Yes, freeze forever' : 'Freeze metadata'}
          </button>
          {confirmFreeze && !isBusy && (
            <button type="button" className={styles.manage__disarm} onClick={() => setConfirmFreeze(false)}>
              Cancel
            </button>
          )}
        </div>
      )}

      {!isClosed && (
        <div className={styles.manage__danger}>
          <div>
            <strong>Close drop</strong>
            <small>
              Ends minting permanently — remaining supply is forfeited. Your collection and everything already minted are
              untouched.
            </small>
          </div>
          <button
            type="button"
            className={clsx(styles.manage__close, confirmClose && styles['manage__close--armed'])}
            onClick={handleClose}
            disabled={isBusy}
          >
            {isClosing || (isBusy && pendingActionRef.current === 'close')
              ? 'Closing…'
              : confirmClose
                ? 'Yes, close forever'
                : 'Close drop'}
          </button>
          {confirmClose && !isBusy && (
            <button type="button" className={styles.manage__disarm} onClick={() => setConfirmClose(false)}>
              Cancel
            </button>
          )}
        </div>
      )}

      <NativeDialog
        ref={editDialogRef}
        className={styles.manage__dialog}
        aria-label="Edit collection metadata"
        onClick={(e) => e.stopPropagation()}
        onClose={(e) => e.stopPropagation()}
        onCancel={(e) => e.stopPropagation()}
      >
        <header className={styles.manage__dialogHeader}>
          <button type="button" className={styles.manage__dialogCancel} onClick={() => editDialogRef.current?.close()}>
            Cancel
          </button>
          <h3>Collection metadata</h3>
        </header>

        <div className={styles.manage__dialogBody}>
          <p className={styles.manage__hint}>
            Uploaded to IPFS and referenced onchain — updating costs one transaction. Shown on the drop page and anywhere the
            collection appears.
          </p>

          <div className={styles.manage__identity}>
            <label className={clsx(styles.manage__image, imageUrl && styles['manage__image--filled'])}>
              {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={22} weight="light" />}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.manage__imageHint}>
              <strong>Artwork {isImageUploading && <em>uploading…</em>}</strong>
              <small>Tap to replace the collection image.</small>
            </div>
          </div>

          <div className={styles.manage__identity}>
            <label className={clsx(styles.manage__image, styles['manage__image--icon'], iconUrl && styles['manage__image--filled'])}>
              {iconUrl ? <img src={iconUrl} alt="" /> : <ImageIcon size={18} weight="light" />}
              <input type="file" accept="image/*" onChange={handleIconSelect} disabled={isBusy} hidden />
            </label>
            <div className={styles.manage__imageHint}>
              <strong>Icon</strong>
              <small>Square logo wallets and explorers show. Falls back to the artwork.</small>
            </div>
          </div>

          <label className={styles.manage__field}>
            <span>
              Description
              <em>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </em>
            </span>
            <textarea
              rows={4}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="What is the story behind this collection?"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
            />
          </label>

          <div className={styles.manage__field}>
            <span>Banner {isBannerUploading && <em>uploading…</em>}</span>
            <label className={clsx(styles.manage__banner, banner && styles['manage__banner--filled'])}>
              {banner ? (
                <img src={resolveStorageImageUrl(banner)} alt="" />
              ) : (
                <span>
                  <ImageIcon size={18} weight="light" />
                  Upload banner
                </span>
              )}
              <input type="file" accept="image/*" onChange={handleBannerSelect} disabled={isBusy} hidden />
            </label>
            <small>Shown atop the drop page. Recommended 1600 × 640.</small>
          </div>

          {DROP_SOCIALS.map(({ key, title, placeholder }) => (
            <label key={key} className={styles.manage__field}>
              <span>{title}</span>
              <input
                type="url"
                value={socials[key]}
                placeholder={placeholder}
                onChange={(e) => setSocials((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={isBusy}
              />
            </label>
          ))}

          <div className={styles.manage__linksEditor}>
            <span>More links</span>
            {linkRows.map((row, index) => (
              <div key={index} className={styles.manage__linkRow}>
                <input
                  type="text"
                  value={row.title}
                  placeholder="Title"
                  onChange={(e) =>
                    setLinkRows((rows) => rows.map((r, i) => (i === index ? { ...r, title: e.target.value } : r)))
                  }
                  disabled={isBusy}
                />
                <input
                  type="url"
                  value={row.url}
                  placeholder="https://…"
                  onChange={(e) => setLinkRows((rows) => rows.map((r, i) => (i === index ? { ...r, url: e.target.value } : r)))}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => setLinkRows((rows) => rows.filter((_, i) => i !== index))}
                  aria-label="Remove link"
                  disabled={isBusy}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.manage__addLink}
              onClick={() => setLinkRows((rows) => [...rows, { title: '', url: '' }])}
              disabled={isBusy}
            >
              <PlusIcon size={14} />
              Add link
            </button>
          </div>

          <button type="button" className={styles.manage__save} onClick={handleSaveMetadata} disabled={isBusy}>
            {isBusy ? 'Updating…' : 'Update metadata'}
          </button>
        </div>
      </NativeDialog>
    </section>
  )
}
