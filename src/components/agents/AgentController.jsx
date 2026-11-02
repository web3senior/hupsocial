'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowsClockwiseIcon, ShieldCheckIcon, ShieldPlusIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { hasAgentKey, importAgentKey } from '@/lib/agentKeys'
import { restoreControllerAgent } from '@/lib/agentWallet'
import { grantAgentController, readAgentController, revokeAgentController } from '@/lib/lsp6'
import styles from './AgentController.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

const COPY = {
  restore: {
    chip: 'Restore on this device',
    title: 'Restore on this device',
    text: (name) =>
      `${name}’s key is on another device or browser. Import the key you exported to keep it, and the LYX on it. Without a backup, make a new key here instead: it replaces the old one on your profile in one transaction, with the same chats, tasks and credits, but LYX left on the old key stays there.`,
    action: 'Make a new key instead',
  },
  grant: {
    chip: 'Add to your UP',
    title: 'Add to your Universal Profile',
    text: (name) => `${name} has no permissions on your profile yet. Adding it lets posts you approve go out as your Universal Profile on LUKSO.`,
    action: 'Add as controller',
  },
  revoke: {
    chip: 'UP controller',
    title: 'Universal Profile controller',
    text: (name) =>
      `${name} is an LSP6 key on your profile. Posts you approve go out as your Universal Profile on LUKSO, marked as written by ${name}. Removing its permissions stops that; the agent stays, and you can add it again.`,
    action: 'Remove permissions',
  },
}

/**
 * A Universal Profile agent's standing on the owner's profile: whether this browser holds its key,
 * and whether the profile lets that key act. Read fresh from the chain on every mount, so it never
 * claims a grant the profile does not hold.
 */
export default function AgentController({ agent, owner, token, onChange }) {
  const [state, setState] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!owner || !agent.controllerAddress) return
    let live = true
    // Read after mount: the key is in this browser's storage, which the server render cannot see
    Promise.all([hasAgentKey(owner, agent.controllerAddress), readAgentController(owner, agent.controllerAddress).catch(() => ({ isController: false, canRelay: false }))])
      .then(([hasKey, control]) => live && setState({ hasKey, ...control }))
    return () => {
      live = false
    }
  }, [owner, agent.controllerAddress])

  if (!state) return null

  const mode = !state.hasKey ? 'restore' : state.isController ? 'revoke' : 'grant'
  const Icon = mode === 'restore' ? ArrowsClockwiseIcon : mode === 'revoke' ? ShieldCheckIcon : ShieldPlusIcon

  return (
    <>
      <button
        type="button"
        className={clsx(styles.controller, mode === 'revoke' && styles['controller--active'], mode === 'restore' && styles['controller--warning'])}
        onClick={() => setIsOpen(true)}
      >
        <Icon size={13} weight={mode === 'revoke' ? 'fill' : 'regular'} /> {COPY[mode].chip}
      </button>
      {isOpen && (
        <ControllerDialog
          agent={agent}
          owner={owner}
          token={token}
          mode={mode}
          onDone={(next, updated) => {
            setState(next)
            if (updated) onChange?.(updated)
          }}
          onExited={() => setIsOpen(false)}
        />
      )}
    </>
  )
}

/** Mounted per opening. Every action is one transaction from the owner's profile. */
function ControllerDialog({ agent, owner, token, mode, onDone, onExited }) {
  const dialogRef = useRef(null)
  const [isBusy, setIsBusy] = useState(false)
  const [backup, setBackup] = useState('')
  const copy = COPY[mode]

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const close = () => dialogRef.current?.close()

  // No transaction: the profile already knows this key, the browser just gets it back
  const importBackup = async () => {
    setIsBusy(true)
    try {
      await importAgentKey(owner, agent.controllerAddress, backup)
      setBackup('')
      const control = await readAgentController(owner, agent.controllerAddress).catch(() => ({ isController: false, canRelay: false }))
      onDone({ hasKey: true, ...control })
      toast(`${agent.name}’s key is back on this device`, 'success')
      close()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsBusy(false)
    }
  }

  const run = async () => {
    setIsBusy(true)
    try {
      if (mode === 'restore') {
        const updated = await restoreControllerAgent({ token, owner, agent })
        onDone({ hasKey: true, isController: true, canRelay: true }, updated)
        toast(`${agent.name} is restored on this device`, 'success')
      } else if (mode === 'grant') {
        await grantAgentController({ profile: owner, agent: agent.controllerAddress })
        onDone({ hasKey: true, isController: true, canRelay: true })
        toast(`${agent.name} can now post as your Universal Profile`, 'success')
      } else {
        await revokeAgentController({ profile: owner, agent: agent.controllerAddress })
        onDone({ hasKey: true, isController: false, canRelay: false })
        toast(`${agent.name} can no longer post as your Universal Profile`, 'success')
      }
      close()
    } catch (error) {
      if (!isCancel(error)) toast(error.shortMessage || error.message, 'error')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={`${agent.name}: ${copy.title}`}
      onCancel={(event) => isBusy && event.preventDefault()}
      onExited={onExited}
    >
      <header className={styles.dialog__header}>
        <h3>{copy.title}</h3>
        <button type="button" className={styles.dialog__close} onClick={close} disabled={isBusy} aria-label="Close">
          <XIcon size={18} />
        </button>
      </header>

      <p className={styles.dialog__text}>{copy.text(agent.name)}</p>

      {mode === 'restore' && (
        <>
          <div className={styles.dialog__import}>
            <input
              type="password"
              value={backup}
              onChange={(e) => setBackup(e.target.value)}
              placeholder="Exported private key, 0x…"
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
              aria-label={`${agent.name}’s exported private key`}
            />
            <button type="button" className={styles.dialog__secondary} onClick={importBackup} disabled={isBusy || !backup.trim()}>
              Import key
            </button>
          </div>
          <div className={styles.dialog__divider}>or</div>
        </>
      )}

      <ul className={styles.dialog__scope}>
        <li>Allowed: create a post on Hup, through your profile&rsquo;s Key Manager</li>
        <li>Not allowed: moving assets, changing your profile or permissions, or signing anything as you</li>
      </ul>

      <button type="button" className={clsx(styles.dialog__action, mode === 'revoke' && styles['dialog__action--danger'])} onClick={run} disabled={isBusy}>
        {isBusy ? (
          <>
            <Spinner size={12} label="Waiting" /> Confirm in your Universal Profile…
          </>
        ) : (
          copy.action
        )}
      </button>
      <p className={styles.dialog__hint}>One transaction from your Universal Profile, paid in LYX. You can also manage this key in your Universal Profile extension.</p>
    </NativeDialog>
  )
}
