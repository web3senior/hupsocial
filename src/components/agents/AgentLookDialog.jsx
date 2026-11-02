'use client'

import { forwardRef, useState } from 'react'
import { XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import BotAvatarEditor from '@/components/BotAvatarEditor'
import { toast } from '@/components/NextToast'
import { resolveBotTraits } from '@/lib/botAvatar'
import { saveAgentLook } from '@/lib/agentWallet'
import styles from './AgentLookDialog.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

/**
 * Customizing an agent's robot: pick its colour and traits, then Save stores the look and makes it
 * the agent's profile picture (the agent signs that, so its vault may open). Mount it fresh for
 * each opening, so the editor starts from the agent's current look.
 */
const AgentLookDialog = forwardRef(function AgentLookDialog({ token, agent, onSaved, onExited }, ref) {
  const [traits, setTraits] = useState(() => resolveBotTraits(agent.address, agent.avatar))
  const [isSaving, setIsSaving] = useState(false)

  const close = () => ref.current?.close()

  const save = async () => {
    setIsSaving(true)
    try {
      const updated = await saveAgentLook(token, agent, traits)
      onSaved({ ...updated, avatar: traits })
      toast(`${agent.name} has a new look`, 'success')
      close()
    } catch (error) {
      if (!isCancel(error)) toast(error.message, 'error')
      // The look is stored before the profile save is signed, so keep the card in step either way
      onSaved({ ...agent, avatar: traits })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <NativeDialog
      ref={ref}
      className={styles.look}
      aria-label={`Customize ${agent.name}`}
      onCancel={(event) => {
        if (isSaving) event.preventDefault()
      }}
      onExited={onExited}
    >
      <header className={styles.look__header}>
        <h3 className={styles.look__title}>Customize {agent.name}</h3>
        <button type="button" className={styles.look__close} onClick={close} disabled={isSaving} aria-label="Close">
          <XIcon size={18} />
        </button>
      </header>

      <BotAvatarEditor seed={agent.address} value={traits} onChange={setTraits} disabled={isSaving} />

      <p className={styles.look__hint}>Saving also makes this {agent.name}&rsquo;s profile picture. {agent.name} signs that change itself.</p>

      <div className={styles.look__actions}>
        <button type="button" className={styles.look__cancel} onClick={close} disabled={isSaving}>
          Cancel
        </button>
        <button type="button" className={styles.look__save} onClick={save} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save look'}
        </button>
      </div>
    </NativeDialog>
  )
})

export default AgentLookDialog
