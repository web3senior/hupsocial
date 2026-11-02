'use client'

import { useEffect, useRef, useState } from 'react'
import { IdentificationBadgeIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import AgentIdentityChip from '@/components/ui/AgentIdentityChip'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { fetchAgentIdentities, identityChains, linkAgentIdentity, registerAgentIdentity } from '@/lib/agentWallet'
import styles from './AgentIdentity.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

/**
 * The agent's ERC-8004 identities, one chip per network, and a way to get one: mint it with the
 * agent's own wallet, or link an id that wallet already controls. Hup stores a link only after
 * reading the Identity Registry, so every chip here is verified onchain.
 */
export default function AgentIdentity({ agent }) {
  const [identities, setIdentities] = useState([])
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetchAgentIdentities(agent.address).then((list) => live && setIdentities(list))
    return () => {
      live = false
    }
  }, [agent.address])

  const added = (identity) => setIdentities((current) => [...current.filter((item) => Number(item.network_id) !== Number(identity.network_id)), identity])

  return (
    <span className={styles.identity}>
      {identities.map((identity) => (
        <AgentIdentityChip key={identity.network_id} identity={identity} />
      ))}
      <button type="button" className={styles.identity__add} onClick={() => setIsOpen(true)} title="Give this agent an ERC-8004 identity">
        <IdentificationBadgeIcon size={13} /> {identities.length ? 'Add network' : 'Get ERC-8004 ID'}
      </button>
      {isOpen && <IdentityDialog agent={agent} taken={identities.map((item) => Number(item.network_id))} onAdded={added} onExited={() => setIsOpen(false)} />}
    </span>
  )
}

/** Mounted per opening, so it always starts on a network the agent has no identity on yet. */
function IdentityDialog({ agent, taken, onAdded, onExited }) {
  const dialogRef = useRef(null)
  const chains = identityChains()
  const [chainId, setChainId] = useState(() => (chains.find((chain) => !taken.includes(chain.id)) ?? chains[0])?.id)
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const close = () => dialogRef.current?.close()
  const chain = chains.find((item) => item.id === chainId)

  const run = async (kind) => {
    setBusy(kind)
    try {
      const identity = kind === 'register' ? await registerAgentIdentity({ agent, chainId }) : await linkAgentIdentity({ agent, chainId, agentId })
      onAdded(identity)
      toast(`${agent.name} is ERC-8004 agent #${identity.agent_id} on ${chain?.name}`, 'success')
      close()
    } catch (error) {
      if (!isCancel(error)) toast(error.shortMessage || error.message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={`ERC-8004 identity for ${agent.name}`}
      onCancel={(event) => busy && event.preventDefault()}
      onExited={onExited}
    >
      <header className={styles.dialog__header}>
        <h3>ERC-8004 identity</h3>
        <button type="button" className={styles.dialog__close} onClick={close} disabled={Boolean(busy)} aria-label="Close">
          <XIcon size={18} />
        </button>
      </header>
      <p className={styles.dialog__text}>
        A public onchain ID for {agent.name}, owned by its own wallet. Tasks it is paid for rate this ID, so its reputation follows it
        to any app that reads ERC-8004.
      </p>

      <label className={styles.dialog__field}>
        <span>Network</span>
        <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} disabled={Boolean(busy)}>
          {chains.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {taken.includes(item.id) ? ' · has one' : ''}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className={styles.dialog__primary} onClick={() => run('register')} disabled={Boolean(busy) || taken.includes(chainId)}>
        {busy === 'register' ? (
          <>
            <Spinner size={12} label="Registering" /> Registering…
          </>
        ) : (
          `Mint ID on ${chain?.name ?? 'this network'}`
        )}
      </button>
      <p className={styles.dialog__hint}>
        {agent.name}&rsquo;s wallet pays a little {chain?.nativeCurrency?.symbol ?? 'gas'} for this.
      </p>

      <div className={styles.dialog__divider}>or link one it already has</div>
      <div className={styles.dialog__link}>
        <input value={agentId} onChange={(e) => setAgentId(e.target.value)} inputMode="numeric" placeholder="Agent id, e.g. 1234" disabled={Boolean(busy)} aria-label="Agent id" />
        <button type="button" className={styles.dialog__secondary} onClick={() => run('link')} disabled={Boolean(busy) || !agentId.trim()}>
          {busy === 'link' ? <Spinner size={12} label="Linking" /> : 'Link'}
        </button>
      </div>
    </NativeDialog>
  )
}
