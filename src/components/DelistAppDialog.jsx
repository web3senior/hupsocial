'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useConnection, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import appsAbi from '@/abis/HupApps.json'
import { toast } from '@/components/NextToast'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import styles from './DelistAppDialog.module.scss'

/**
 * Owner confirmation for cancelling a listing. delistApp is one-way onchain — there is no
 * relist function, and every other owner action reverts once the flag is set — so this
 * dialog's whole job is making that permanence unmissable before the transaction goes out.
 */
const DelistAppDialog = forwardRef(function DelistAppDialog({ app, onDelisted, onClosed }, ref) {
  const dialogRef = useRef(null)

  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  // A listing lives on one chain forever, so the target network is never a choice here
  const chainId = app?.network?.id
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const appsAddress = CONTRACTS[`chain${chainId}`]?.apps
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const publicClient = usePublicClient({ chainId })

  const [isSubmittingBurner, setIsSubmittingBurner] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const isBusy = isPending || isConfirming || isSubmittingBurner

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  const successMessage = 'App delisted — it leaves the directory once the indexer catches up'

  useEffect(() => {
    if (!isConfirmed) return
    toast(successMessage, 'success')
    onDelisted?.()
    dialogRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleDelist = async () => {
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (!appsAddress) {
      toast("The apps registry isn't available on this network", 'error')
      return
    }

    // Burner session skips the wallet popup; it awaits its own confirmation, so the wagmi
    // isConfirmed side effects replay manually.
    const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))

    if (session.active) {
      setIsSubmittingBurner(true)
      try {
        await writeWithBurnerSession({
          chain: chainInfo,
          contractAddress: appsAddress,
          abi: appsAbi,
          functionName: 'delistApp',
          args: [address, BigInt(app.appId)],
        })

        toast(successMessage, 'success')
        onDelisted?.()
        dialogRef.current?.close()
        return
      } catch (err) {
        // Delisting is free, so the burner can only be short on gas — recover via the main wallet
        if (!/insufficient (balance|funds)/i.test(err?.message || '')) {
          toast(err.message || 'Transaction rejected or encountered an error.', 'error')
          return
        }
      } finally {
        setIsSubmittingBurner(false)
      }
    }

    writeContract({
      abi: appsAbi,
      address: appsAddress,
      functionName: 'delistApp',
      args: [address, BigInt(app.appId)],
      chainId,
    })
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.delistDialog}
      aria-label={`Delist ${app?.name || 'app'}`}
      onClick={(e) => e.stopPropagation()}
      onClose={() => onClosed?.()}
      onCancel={(e) => {
        // Esc must not dismiss the dialog while the transaction is in flight
        if (isBusy) e.preventDefault()
      }}
    >
      <div className={styles.delistDialog__body}>
        <header className={styles.delistDialog__header}>
          <h3>Delist {app?.name || 'app'}?</h3>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={isBusy}
            aria-label="Close"
            className={styles.delistDialog__close}
          >
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.delistDialog__target}>
          Listed on <strong>{chainInfo?.name || 'this network'}</strong> — app #{app?.appId}
        </p>

        <p className={styles.delistDialog__warning}>
          <WarningIcon size={14} />
          <span>
            Delisting is permanent. The listing can&apos;t be edited, transferred, or restored afterwards, and in-post embedding is revoked.
            Returning to the directory means registering — and paying for — a new listing.
          </span>
        </p>

        {isWrongChain && (
          <div className={styles.delistDialog__chainWarning}>
            <WarningIcon size={14} />
            <span>Delisting on {chainInfo?.name || 'this network'} needs your wallet on the same network.</span>
            <button
              type="button"
              onClick={() => switchChain.mutate({ chainId })}
              disabled={switchChain.isPending}
              className={styles.delistDialog__switchChain}
            >
              {switchChain.isPending ? 'Switching...' : 'Switch'}
            </button>
          </div>
        )}

        <div className={styles.delistDialog__actions}>
          <button type="button" onClick={() => dialogRef.current?.close()} disabled={isBusy} className={styles.delistDialog__cancel}>
            Keep listing
          </button>
          <button
            type="button"
            onClick={handleDelist}
            disabled={isBusy || !appsAddress || isWrongChain}
            className={styles.delistDialog__confirm}
          >
            {isBusy ? 'Confirming...' : 'Delist permanently'}
          </button>
        </div>
      </div>
    </NativeDialog>
  )
})

export default DelistAppDialog
