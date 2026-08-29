'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react'
import { formatEther } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { wallTimeToUnix } from '@/lib/dateHelper'
import eventsAbi from '@/abis/HupEvents.json'
import { toast } from '@/components/NextToast'
import { StarIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import NetworkSelect from '@/components/ui/NetworkSelect'
import styles from './ListEventDialog.module.scss'

// IANA zone options — supportedValuesOf is available in every browser this app targets;
// the viewer's own zone is prepended as the default either way.
const getTimezoneOptions = () => {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [local, ...supported.filter((zone) => zone !== local)]
}

const ListEventDialog = forwardRef(function ListEventDialog({ onListed }, ref) {
  const dialogRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // Chains where the events contract is deployed
  const eventChains = useMemo(() => appChains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.events), [])
  const [chainId, setChainId] = useState(() => eventChains[0]?.id ?? null)

  const chainInfo = eventChains.find((chain) => chain.id === chainId)
  const eventsAddress = CONTRACTS[`chain${chainId}`]?.events
  const currencySymbol = chainInfo?.nativeCurrency?.symbol || 'native token'
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const publicClient = usePublicClient({ chainId })

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [venue, setVenue] = useState('')
  const [city, setCity] = useState('')
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [registrationUrl, setRegistrationUrl] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [featured, setFeatured] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  const timezoneOptions = useMemo(getTimezoneOptions, [])

  const { data: listingFeeValue } = useReadContract({
    abi: eventsAbi,
    address: eventsAddress,
    functionName: 'listingFee',
    chainId,
    query: { enabled: Boolean(eventsAddress) },
  })

  const { data: featuredFeeValue } = useReadContract({
    abi: eventsAbi,
    address: eventsAddress,
    functionName: 'featuredFee',
    chainId,
    query: { enabled: Boolean(eventsAddress) },
  })

  const totalFee = (listingFeeValue ?? 0n) + (featured ? (featuredFeeValue ?? 0n) : 0n)

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

  useEffect(() => {
    if (!isConfirmed) return
    toast('Event listed — it appears in the directory once the indexer catches up', 'success')
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
    if (!eventsAddress) {
      toast("The events contract isn't available on this network yet", 'error')
      return
    }

    const startUnix = wallTimeToUnix(startLocal, timezone)
    const endUnix = wallTimeToUnix(endLocal, timezone)
    if (!Number.isFinite(startUnix) || !Number.isFinite(endUnix)) {
      toast('Enter valid start and end times', 'error')
      return
    }
    if (endUnix < startUnix) {
      toast('The end time is before the start time', 'error')
      return
    }
    if (endUnix <= Math.floor(Date.now() / 1000)) {
      toast('The event is already over — pick a future end time', 'error')
      return
    }

    const trimmedUrl = registrationUrl.trim()
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      toast('The registration link must start with http:// or https://', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(withAuthor({
        title: title.trim(),
        description: description.trim(),
        organizerName: organizerName.trim(),
        venue: venue.trim(),
        city: city.trim(),
        timezone,
        url: trimmedUrl,
        image: imageUrl.trim(),
      }, address))
    } catch (err) {
      toast(err.message || 'Failed to upload event details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    const args = [address, BigInt(startUnix), BigInt(endUnix), featured, cid]

    // Burner session skips the wallet popup (the burner must hold the listing fee); it
    // awaits its own confirmation, so the wagmi isConfirmed side effects replay manually.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: eventsAddress,
          abi: eventsAbi,
          functionName: 'listEvent',
          args: [...args, { value: totalFee }],
        })

        toast('Event listed — it appears in the directory once the indexer catches up', 'success')
        dialogRef.current?.close()
        onListed?.()
      } catch (err) {
        toast(err.message || 'Transaction rejected or encountered an error.', 'error')
      } finally {
        setIsSubmittingBurner(false)
      }
      return
    }

    writeContract({
      abi: eventsAbi,
      address: eventsAddress,
      functionName: 'listEvent',
      args,
      value: totalFee,
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.eventDialog}
      aria-label="List an event"
      onClick={(e) => e.stopPropagation()}
      onCancel={(e) => {
        // Esc must not discard the form while the upload or transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.eventDialog__body}>
        <header className={styles.eventDialog__header}>
          <h3>List an event</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.eventDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.eventDialog__network}>
          <NetworkSelect />
        </div>

        {isWrongChain && (
          <div className={styles.eventDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Events on {chainInfo?.name || 'this network'} need your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.eventDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        {eventChains.length === 0 && <p className={styles.eventDialog__notice}>The events contract isn&apos;t deployed yet.</p>}

        <form onSubmit={handleSubmit} className={styles.eventDialog__form}>
          {eventChains.length > 1 && (
            <label>
              <span>Network</span>
              <select value={chainId ?? ''} onChange={(e) => setChainId(Number(e.target.value))} disabled={isBusy}>
                {eventChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>Event title</span>
            <input
              type="text"
              placeholder="e.g. Builders Breakfast"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              maxLength={120}
              required
            />
          </label>

          <label>
            <span>Description (optional)</span>
            <textarea
              placeholder="What's happening, who it's for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={3}
            />
          </label>

          <label>
            <span>Organizer (optional) — defaults to your profile</span>
            <input
              type="text"
              placeholder="e.g. Hup Labs"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              disabled={isBusy}
              maxLength={120}
            />
          </label>

          <div className={styles.eventDialog__pair}>
            <label>
              <span>Venue</span>
              <input
                type="text"
                placeholder="e.g. Palais des Festivals"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                disabled={isBusy}
                maxLength={120}
                required
              />
            </label>
            <label>
              <span>City (optional)</span>
              <input type="text" placeholder="e.g. Cannes" value={city} onChange={(e) => setCity(e.target.value)} disabled={isBusy} maxLength={80} />
            </label>
          </div>

          <label>
            <span>Time zone — start/end below are in this zone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={isBusy}>
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.eventDialog__pair}>
            <label>
              <span>Starts</span>
              <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={isBusy} required />
            </label>
            <label>
              <span>Ends</span>
              <input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} disabled={isBusy} required />
            </label>
          </div>

          <label>
            <span>Registration link</span>
            <input
              type="url"
              placeholder="https://luma.com/..."
              value={registrationUrl}
              onChange={(e) => setRegistrationUrl(e.target.value)}
              disabled={isBusy}
              required
            />
          </label>

          <label>
            <span>Image URL (optional)</span>
            <input type="url" placeholder="https://..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} disabled={isBusy} />
          </label>

          <label className={styles.eventDialog__featured}>
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} disabled={isBusy} />
            <StarIcon size={14} weight={featured ? 'fill' : 'regular'} />
            <span>
              Featured — pinned and highlighted in the directory
              {featuredFeeValue && featuredFeeValue > 0n ? ` (+${formatEther(featuredFeeValue)} ${currencySymbol})` : ''}
            </span>
          </label>

          <p className={styles.eventDialog__notice}>
            {totalFee > 0n
              ? `Listing fee: ${formatEther(totalFee)} ${currencySymbol}, paid onchain with the transaction.`
              : "No listing fee on this network — it's free to list."}
          </p>

          <button type="submit" disabled={isBusy || !eventsAddress || isWrongChain} className={styles.eventDialog__submit}>
            {isUploading ? 'Uploading details...' : isBusy ? 'Confirming...' : 'Pay & list event'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default ListEventDialog
