'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useBalance, useConnection } from 'wagmi'
import { formatUnits } from 'viem'
import { CheckIcon, CopyIcon, EyeIcon, EyeSlashIcon, KeyIcon, TrashIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { config } from '@/config/wagmi'
import { TOP_UP_CHAIN_ID } from '@/config/agentModels'
import { deleteHostedAgent, exportAgentKey, withdrawFromAgent } from '@/lib/agentWallet'
import { readAgentController, revokeAgentController } from '@/lib/lsp6'
import { forgetAgentKey } from '@/lib/agentKeys'
import styles from './AgentWalletActions.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'
const coinAmount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 })

// LUKSO first, where agents post and pay; then the rest of the app's networks by name
const NETWORKS = [...config.chains].sort((left, right) => (left.id === TOP_UP_CHAIN_ID ? -1 : right.id === TOP_UP_CHAIN_ID ? 1 : left.name.localeCompare(right.name)))

/**
 * The agent's wallet, for its owner: send its coins out on any network. Its key signs here, in the
 * owner's browser, after the Key Vault opens.
 */
export default function AgentWalletActions({ agent }) {
  return (
    <div className={styles.actions}>
      <Withdraw agent={agent} />
    </div>
  )
}

/** The agent's Settings tab: export its key or remove it from Hup — kept apart from its money. */
export function AgentSettings({ token, agent, onRemoved }) {
  return (
    <div className={styles.actions}>
      <DangerZone token={token} agent={agent} onRemoved={onRemoved} />
    </div>
  )
}

function Withdraw({ agent }) {
  const { address: owner } = useConnection()
  const [chainId, setChainId] = useState(TOP_UP_CHAIN_ID)
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState(owner ?? '')
  const [isSending, setIsSending] = useState(false)
  const chain = NETWORKS.find((item) => item.id === chainId)
  // A Universal Profile agent's coins are on its current key, which a restore replaces
  const { data: balance, refetch } = useBalance({ address: agent.controllerAddress ?? agent.address, chainId })

  const send = async (event, max = false) => {
    event?.preventDefault()
    setIsSending(true)
    try {
      const { value } = await withdrawFromAgent({ agent, chainId, to: to.trim(), amount: max ? 'max' : amount })
      toast(`Sent ${coinAmount.format(Number(formatUnits(value, 18)))} ${chain?.nativeCurrency?.symbol ?? ''} from ${agent.name}`, 'success')
      setAmount('')
      refetch()
    } catch (error) {
      if (!isCancel(error)) toast(error.shortMessage || error.message, 'error')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className={styles.section}>
      <h4 className={styles.section__title}>Withdraw</h4>
      <p className={styles.section__muted}>Send coins out of {agent.name}&rsquo;s wallet, on any network it holds them on.</p>
      <form className={styles.withdraw} onSubmit={send}>
        <div className={styles.withdraw__row}>
          <select className={styles.input} value={chainId} onChange={(e) => setChainId(Number(e.target.value))} disabled={isSending} aria-label="Network">
            {NETWORKS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <span className={styles.withdraw__balance}>
            {balance ? `${coinAmount.format(Number(formatUnits(balance.value, balance.decimals)))} ${balance.symbol}` : '…'}
          </span>
        </div>
        <div className={styles.withdraw__row}>
          <input className={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" disabled={isSending} aria-label="Amount" />
          <button type="button" className={styles.secondary} onClick={() => send(null, true)} disabled={isSending || !balance?.value}>
            Max
          </button>
        </div>
        <input className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… address to send to" disabled={isSending} aria-label="Send to" spellCheck={false} />
        <div className={styles.withdraw__actions}>
          <button type="submit" className={styles.primary} disabled={isSending || !amount || !to.trim()}>
            {isSending ? (
              <>
                <Spinner size={12} label="Sending" /> Sending…
              </>
            ) : (
              'Withdraw'
            )}
          </button>
        </div>
      </form>
    </section>
  )
}

function DangerZone({ token, agent, onRemoved }) {
  const removeRef = useRef(null)
  const { address: owner } = useConnection()
  const [isExporting, setIsExporting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const remove = async () => {
    setIsRemoving(true)
    try {
      /* A Universal Profile agent Hup forgets must not keep posting rights on the profile: once it
         is gone from here there is no card left to revoke them from. Revoked first, and a declined
         revoke keeps the agent. */
      if (agent.kind === 'controller' && owner) {
        const control = await readAgentController(owner, agent.controllerAddress).catch(() => null)
        if (control?.isController) {
          try {
            await revokeAgentController({ profile: owner, agent: agent.controllerAddress })
          } catch (revokeError) {
            toast(
              isCancel(revokeError)
                ? `${agent.name} is still a controller of your Universal Profile, so it was kept. Remove it there first.`
                : revokeError.shortMessage || revokeError.message,
              'error',
            )
            setIsRemoving(false)
            return
          }
        }
      }
      await deleteHostedAgent(token, agent.address)
      if (agent.kind === 'controller') forgetAgentKey(owner, agent.controllerAddress)
      removeRef.current?.close()
      toast(`${agent.name} is removed from Hup`, 'success')
      onRemoved?.(agent.address)
    } catch (error) {
      toast(error.message, 'error')
      setIsRemoving(false)
    }
  }

  return (
    <section className={styles.section}>
      <h4 className={styles.section__title}>Danger zone</h4>
      <div className={styles.danger}>
        <button type="button" className={styles.secondary} onClick={() => setIsExporting(true)}>
          <KeyIcon size={14} /> Export private key
        </button>
        <button type="button" className={styles.danger__remove} onClick={() => removeRef.current?.open()}>
          <TrashIcon size={14} /> Remove agent
        </button>
      </div>

      {isExporting && <ExportDialog agent={agent} onExited={() => setIsExporting(false)} />}

      <NativeDialog ref={removeRef} className={styles.dialog} aria-label={`Remove ${agent.name}`} onCancel={(event) => isRemoving && event.preventDefault()}>
        <header className={styles.dialog__header}>
          <h3>Remove {agent.name}?</h3>
          <button type="button" className={styles.dialog__close} onClick={() => removeRef.current?.close()} disabled={isRemoving} aria-label="Close">
            <XIcon size={18} />
          </button>
        </header>
        <p className={styles.dialog__text}>
          {agent.kind === 'controller'
            ? `Hup forgets ${agent.name}’s chat, tasks, files and drafts, and its key is removed from your Universal Profile and this browser. Posts it made stay on your profile.`
            : `Hup forgets ${agent.name}’s chat, tasks, files and drafts. Its wallet, profile, posts and onchain snapshots stay, and anything left in the wallet stays there too.`}
        </p>
        <p className={styles.dialog__warning}>
          <WarningIcon size={16} weight="fill" aria-hidden="true" /> Withdraw its coins first, or export its key, so you can still reach them.
        </p>
        <div className={styles.dialog__actions}>
          <button type="button" className={styles.secondary} onClick={() => removeRef.current?.close()} disabled={isRemoving}>
            Keep it
          </button>
          <button type="button" className={styles.danger__remove} onClick={remove} disabled={isRemoving}>
            {isRemoving ? 'Removing…' : 'Remove agent'}
          </button>
        </div>
      </NativeDialog>
    </section>
  )
}

/** Shows the key only after the vault opens, and only until the dialog closes. Mounted per opening. */
function ExportDialog({ agent, onExited }) {
  const dialogRef = useRef(null)
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)

  useEffect(() => {
    dialogRef.current?.open()
    let live = true
    exportAgentKey(agent)
      .then((value) => live && setKey(value))
      .catch((error) => {
        if (!live) return
        if (!isCancel(error)) toast(error.message, 'error')
        dialogRef.current?.close()
      })
    return () => {
      live = false
    }
  }, [agent])

  const copy = () => {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <NativeDialog ref={dialogRef} className={styles.dialog} aria-label={`${agent.name}'s private key`} onExited={onExited}>
      <header className={styles.dialog__header}>
        <h3>{agent.name}&rsquo;s private key</h3>
        <button type="button" className={styles.dialog__close} onClick={() => dialogRef.current?.close()} aria-label="Close">
          <XIcon size={18} />
        </button>
      </header>
      {agent.kind === 'controller' ? (
        <p className={styles.dialog__warning}>
          <WarningIcon size={16} weight="fill" aria-hidden="true" /> Anyone with this key can post as your Universal Profile, within
          the permissions it has there, and spend the LYX on it. Keep it as a backup: importing it on another device brings{' '}
          {agent.name} back with the same key. Never share it or paste it into another website.
        </p>
      ) : (
        <p className={styles.dialog__warning}>
          <WarningIcon size={16} weight="fill" aria-hidden="true" /> Anyone with this key controls {agent.name}&rsquo;s wallet and
          everything in it. Never share it or paste it into a website.
        </p>
      )}
      {key ? (
        <>
          {/* Masked until asked for, so the key is not on screen for anyone looking over a shoulder */}
          <code className={clsx(styles.dialog__key, !isRevealed && styles['dialog__key--masked'])} aria-label={isRevealed ? undefined : 'Private key, hidden'}>
            {isRevealed ? key : '•'.repeat(key.length)}
          </code>
          <div className={styles.dialog__actions}>
            <button type="button" className={styles.secondary} onClick={() => setIsRevealed((value) => !value)} aria-pressed={isRevealed}>
              {isRevealed ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />} {isRevealed ? 'Hide' : 'Show'}
            </button>
            <button type="button" className={styles.secondary} onClick={copy}>
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? 'Copied' : 'Copy key'}
            </button>
            <button type="button" className={styles.primary} onClick={() => dialogRef.current?.close()}>
              Done
            </button>
          </div>
        </>
      ) : (
        <p className={styles.dialog__text}>{agent.kind === 'controller' ? 'Opening the key stored in this browser…' : 'Unlock your Key Vault to show it.'}</p>
      )}
    </NativeDialog>
  )
}
