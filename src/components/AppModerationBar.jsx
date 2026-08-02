'use client'

import { useEffect } from 'react'
import { useConnection, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import appsAbi from '@/abis/HupApps.json'
import { toast } from '@/components/NextToast'
import { EyeIcon, EyeSlashIcon, PuzzlePieceIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import styles from './AppModerationBar.module.scss'

/**
 * Moderator controls for a registered app, rendered inline on its directory card.
 *
 * Renders nothing at all unless the connected wallet actually holds MODERATOR_ROLE or ADMIN_ROLE
 * on that app's chain — the contract enforces this regardless, so this is purely about not
 * showing dead buttons.
 *
 * Both actions are `onlyDirectModerator` onchain, meaning no meta-transactions and no burner
 * session: the moderator's own wallet must sign. That is deliberate, so moderation authority
 * cannot be delegated to a session key sitting in browser storage.
 */
export default function AppModerationBar({ app, onChanged }) {
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })

  const chainId = app?.network?.id
  const appsAddress = CONTRACTS[`chain${chainId}`]?.apps
  const enabled = Boolean(appsAddress && address && app?.source === 'onchain' && app?.appId)

  const { data: moderatorRole } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'MODERATOR_ROLE',
    chainId,
    query: { enabled },
  })

  const { data: adminRole } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'ADMIN_ROLE',
    chainId,
    query: { enabled },
  })

  const { data: isModerator } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'hasRole',
    args: [moderatorRole, address],
    chainId,
    query: { enabled: enabled && Boolean(moderatorRole) },
  })

  // ADMIN_ROLE satisfies onlyDirectModerator too, so an admin sees the same controls
  const { data: isAdmin } = useReadContract({
    abi: appsAbi,
    address: appsAddress,
    functionName: 'hasRole',
    args: [adminRole, address],
    chainId,
    query: { enabled: enabled && Boolean(adminRole) },
  })

  const { data: hash, isPending, mutate: writeContract, error: submitError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return
    toast('Updated — the directory refreshes once the indexer catches up', 'success')
    onChanged?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  if (!enabled || !(isModerator || isAdmin)) return null

  const isBusy = isPending || isConfirming
  const isWrongChain = Boolean(walletChain && walletChain.id !== chainId)

  const call = (functionName, value) => {
    if (isWrongChain) {
      switchChain.mutate({ chainId })
      return
    }
    writeContract({ abi: appsAbi, address: appsAddress, functionName, args: [BigInt(app.appId), value], chainId })
  }

  return (
    <div className={styles.moderation}>
      <span className={styles.moderation__label}>
        <ShieldCheckIcon size={12} weight="fill" />
        Moderator
      </span>

      {/* Embedding cannot be granted while hidden — the contract rejects it, so don't offer it */}
      <button
        type="button"
        disabled={isBusy || (app.hidden && !app.embeddable)}
        onClick={() => call('setEmbeddable', !app.embeddable)}
        className={clsx(styles.moderation__action, app.embeddable && styles['moderation__action--active'])}
        title={
          app.hidden && !app.embeddable
            ? 'Unhide this listing before granting embedding'
            : app.embeddable
              ? 'Revoke in-post embedding for this app'
              : 'Allow this app to run inside posts — review the app URL before granting'
        }
      >
        <PuzzlePieceIcon size={12} weight={app.embeddable ? 'fill' : 'regular'} />
        {isWrongChain ? 'Switch network' : app.embeddable ? 'Revoke embed' : 'Allow embed'}
      </button>

      <button
        type="button"
        disabled={isBusy}
        onClick={() => call('setHidden', !app.hidden)}
        className={clsx(styles.moderation__action, app.hidden && styles['moderation__action--hidden'])}
        title={app.hidden ? 'Restore this listing to the directory' : 'Hide this listing from the directory'}
      >
        {app.hidden ? <EyeIcon size={12} /> : <EyeSlashIcon size={12} />}
        {app.hidden ? 'Unhide' : 'Hide'}
      </button>
    </div>
  )
}
