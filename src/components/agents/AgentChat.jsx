'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useConnection } from 'wagmi'
import { ArrowRightIcon, ArrowUpIcon, CheckIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { ContentSpinner, ThinkingOrb } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import { config } from '@/config/wagmi'
import { onboardingChainId } from '@/config/gasless'
import { renderMarkdown } from '@/lib/markdown'
import { carryOutProposal, deleteAgentSession, fetchAgent, resolveAgentProposal, streamAgentChat } from '@/lib/agentWallet'
import { AGENT_POST_MAX } from '@/lib/hostedAgentMessages'
import styles from './AgentChat.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

const now = () => new Date().toISOString()

const sessionDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * A conversation with one hosted agent. The agent answers from the server; when it wants to post,
 * edit or remove one of its posts it drafts that, shown here as a card in the conversation. Drafts
 * are stored with the agent, so a reload keeps them and the agent knows which are still waiting.
 * Approving signs with the agent's key in this tab (opening Key Vault v2 if needed). New posts go
 * to Hup's onboarding chain (LUKSO while it is sponsored) — the agent signs for itself, so the
 * owner's wallet network plays no part — and edits and removals go to the post's own network.
 */
const CARD_COPY = {
  post: { label: 'Proposed post · labeled as AI', approve: 'Approve and post', done: 'Posted', success: 'posted' },
  edit: { label: 'Edit to one of its posts', approve: 'Approve edit', done: 'Edited', success: 'edited its post' },
  delete: { label: 'Remove one of its posts', approve: 'Approve removal', done: 'Removed', success: 'removed its post' },
  reply: { label: 'Reply · labeled as AI', approve: 'Approve reply', done: 'Replied', success: 'replied' },
  like: { label: 'Like a post', approve: 'Approve like', done: 'Liked', success: 'liked the post' },
  tip: { label: 'Tip from its wallet', approve: 'Approve tip', done: 'Tipped', success: 'sent the tip' },
  transfer: { label: 'Send from its wallet', approve: 'Approve transfer', done: 'Sent', success: 'sent the transfer' },
  profile: { label: 'Change its profile', approve: 'Approve change', done: 'Updated', success: 'updated its profile' },
}

// A profile card stores the change and the profile before it as JSON: { name?, description? }
const readProfile = (value) => {
  try {
    return JSON.parse(value) ?? {}
  } catch {
    return {}
  }
}

// Cards whose words the owner may change before approving; the rest act on fixed targets
const EDITABLE_KINDS = new Set(['post', 'edit', 'reply'])

// A tip or transfer names its network by id; the card shows its coin and name
const chainOf = (networkId) => config.chains.find((item) => item.id === Number(networkId)) ?? null

export default function AgentChat({ token, agent, initialSession = null }) {
  // The owner: a new post goes out as their Universal Profile when the agent controls it (lib/lsp6.js)
  const { address: owner } = useConnection()
  const chainId = onboardingChainId()
  const chain = config.chains.find((item) => item.id === chainId)

  const [messages, setMessages] = useState(null)
  const [proposals, setProposals] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [draft])

  // Which session to open: a number, null for the latest chat, or 'new' for a fresh one
  const [requested, setRequested] = useState(initialSession)
  // The open session (null until a fresh chat's first message creates it) and the recent ones
  const [session, setSession] = useState(null)
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    // A fresh chat is set up by newChat itself; there is nothing to load
    if (requested === 'new') return
    let live = true
    fetchAgent(token, agent.address, requested)
      .then((data) => {
        if (!live) return
        setMessages(data.messages)
        setProposals(data.proposals ?? [])
        setSession(data.session)
        setSessions(data.sessions ?? [])
      })
      .catch((error) => {
        if (!live) return
        setMessages([])
        toast(error.message, 'error')
      })
    return () => {
      live = false
    }
  }, [token, agent.address, requested])

  const newChat = () => {
    setRequested('new')
    setSession(null)
    setMessages([])
    setProposals([])
    setDraft('')
  }

  const pickSession = (value) => {
    if (value === 'new') newChat()
    else setRequested(Number(value))
  }

  const deleteRef = useRef(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // The open session goes; the next most recent one opens in its place, or a fresh chat
  const deleteSession = async () => {
    if (!session) return
    setIsDeleting(true)
    try {
      await deleteAgentSession(token, agent.address, session.id)
      const remaining = sessions.filter((item) => item.id !== session.id)
      setSessions(remaining)
      if (remaining.length) setRequested(remaining[0].id)
      else newChat()
      deleteRef.current?.close()
      toast('Chat deleted', 'success')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, proposals])

  const send = async (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || isBusy) return

    setDraft('')
    setIsBusy(true)
    setStatus('')
    const sentAt = now()
    setMessages((current) => [...(current ?? []), { role: 'user', content: text, createdAt: sentAt }, { role: 'assistant', content: '', createdAt: sentAt }])

    const appendToReply = (piece) =>
      setMessages((current) => {
        const next = [...current]
        next[next.length - 1] = { ...next.at(-1), content: next.at(-1).content + piece }
        return next
      })

    try {
      await streamAgentChat(token, agent.address, text, {
        sessionId: session?.id ?? null,
        // A fresh chat learns its id from the first event and joins the list
        onSession: (id) => {
          if (session?.id === id) return
          const opened = { id, kind: 'chat', title: text.replace(/\s+/g, ' ').slice(0, 80), updatedAt: now() }
          setSession(opened)
          setSessions((current) => [opened, ...current.filter((item) => item.id !== id)])
        },
        onDelta: (piece) => {
          setStatus('')
          appendToReply(piece)
        },
        onStatus: setStatus,
        // Stamped with this tab's clock so it lands after the reply it came with, whatever the server's says
        onProposal: (proposal) => setProposals((current) => [...current, { ...proposal, createdAt: now() }]),
      })
    } catch (error) {
      // An empty reply bubble says nothing; replace it with what went wrong
      setMessages((current) => (current.at(-1)?.content ? current : current.slice(0, -1)))
      toast(error.message, 'error')
    } finally {
      setIsBusy(false)
      setStatus('')
    }
  }

  const setProposalStatus = (id, nextStatus, extra = {}) =>
    setProposals((current) => current.map((proposal) => (proposal.id === id ? { ...proposal, status: nextStatus, ...extra } : proposal)))

  const discard = async (proposal) => {
    setProposalStatus(proposal.id, 'discarded')
    try {
      await resolveAgentProposal(token, agent.address, proposal.id, { status: 'discarded' })
    } catch (error) {
      setProposalStatus(proposal.id, 'pending')
      toast(error.message, 'error')
    }
  }

  // `text` is the owner's edited wording of a post, edit or reply card, when they changed it
  const approve = async (proposal, text = null) => {
    if (!chain) {
      toast('Agent posting is not set up on this deployment', 'error')
      return
    }
    const edited = text !== null && text !== proposal.text ? text : null
    const toCarryOut = edited ? { ...proposal, text: edited } : proposal
    setProposalStatus(proposal.id, 'publishing')
    let result
    try {
      result = await carryOutProposal({ agent, proposal: toCarryOut, chain, owner })
    } catch (error) {
      setProposalStatus(proposal.id, 'pending')
      if (!isCancel(error)) toast(error.message, 'error')
      return
    }

    setProposalStatus(proposal.id, 'published', { txHash: result.txHash, text: toCarryOut.text })
    toast(`${agent.name} ${CARD_COPY[proposal.kind ?? 'post'].success}`, 'success')
    // Done onchain either way; a failed record only means the card may show as pending after a reload
    resolveAgentProposal(token, agent.address, proposal.id, { status: 'published', ...result, ...(edited ? { text: edited } : {}) }).catch(() => {})
  }

  // Messages and drafts in the order they happened. Sort is stable, so a reply and the draft it
  // made keep their order when their times tie.
  const timeline = [
    ...(messages ?? []).map((message, index) => ({ kind: 'message', key: `m${index}`, at: message.createdAt ?? '', ...message })),
    ...proposals.map((proposal) => ({ kind: 'proposal', key: `p${proposal.id}`, at: proposal.createdAt ?? '', proposal })),
  ].sort((left, right) => left.at.localeCompare(right.at))

  return (
    <div className={styles.chat}>
      <div className={styles.chat__sessions}>
        <select
          className={styles.chat__sessionPicker}
          value={session?.id ?? 'new'}
          onChange={(e) => pickSession(e.target.value)}
          disabled={isBusy}
          aria-label="Conversation"
        >
          {!session && <option value="new">New chat</option>}
          {sessions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind === 'task' ? '▶ ' : ''}
              {item.title || 'Untitled chat'} · {sessionDate.format(new Date(item.updatedAt))}
            </option>
          ))}
        </select>
        <button type="button" className={styles.chat__newChat} onClick={newChat} disabled={isBusy || !session}>
          <PlusIcon size={14} /> New chat
        </button>
        <button
          type="button"
          className={clsx(styles.chat__newChat, styles['chat__newChat--danger'])}
          onClick={() => deleteRef.current?.open()}
          disabled={isBusy || !session}
          aria-label="Delete this chat"
          title="Delete this chat"
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <NativeDialog ref={deleteRef} className={styles.dialog} aria-label="Delete this chat" onCancel={(event) => isDeleting && event.preventDefault()}>
        <h3 className={styles.dialog__title}>Delete this chat?</h3>
        <p className={styles.dialog__text}>
          {session?.title || 'Untitled chat'} and its drafts are removed from Hup. Posts {agent.name} already made stay onchain, and
          what it remembers or keeps in its workspace stays too.
        </p>
        <div className={styles.dialog__actions}>
          <button type="button" className={styles.dialog__cancel} onClick={() => deleteRef.current?.close()} disabled={isDeleting}>
            Keep it
          </button>
          <button type="button" className={styles.dialog__delete} onClick={deleteSession} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete chat'}
          </button>
        </div>
      </NativeDialog>

      <div className={styles.chat__log}>
        {messages === null && <ContentSpinner />}
        {messages?.length === 0 && <p className={styles.chat__empty}>Say hello to {agent.name}, or ask it to draft a post.</p>}
        {messages !== null &&
          timeline.map((item) =>
            item.kind === 'proposal' ? (
              <ProposalCard key={item.key} proposal={item.proposal} onApprove={approve} onDiscard={discard} />
            ) : item.content ? (
              <div key={item.key} className={clsx(styles.chat__message, styles[`chat__message--${item.role}`])}>
                {item.role === 'assistant' ? (
                  <div className={styles.chat__markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content, { linkPostPaths: true }) }} />
                ) : (
                  item.content
                )}
              </div>
            ) : null,
          )}

        {isBusy && (
          <div className={styles.chat__status}>
            <ThinkingOrb size={18} /> {status || `${agent.name} is thinking…`}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className={styles.chat__composer} onSubmit={send}>
        <textarea
          ref={inputRef}
          className={styles.chat__input}
          rows={1}
          aria-label={`Message ${agent.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={session?.kind === 'task' ? `Reply to ${agent.name} about this task run` : `Message ${agent.name}`}
          maxLength={2000}
          disabled={isBusy}
        />
        <div className={styles.chat__composerFooter}>
          <span className={styles.chat__hint}>Enter for a new line</span>
          <button type="submit" className={styles.chat__send} disabled={isBusy || !draft.trim()} aria-label="Send message">
            <ArrowUpIcon size={18} />
          </button>
        </div>
      </form>
    </div>
  )
}

function ProposalCard({ proposal, onApprove, onDiscard }) {
  const isPublishing = proposal.status === 'publishing'
  const kind = proposal.kind ?? 'post'
  const copy = CARD_COPY[kind]
  const isPending = proposal.status === 'pending' || isPublishing
  const canEdit = EDITABLE_KINDS.has(kind) && isPending
  // null while the card shows the draft as written; the owner's wording while editing
  const [editText, setEditText] = useState(null)
  const isEditing = canEdit && editText !== null
  const trimmed = editText?.trim() ?? ''
  const isEditValid = !isEditing || (trimmed.length > 0 && trimmed.length <= AGENT_POST_MAX)

  return (
    <div className={clsx(styles.proposal, styles[`proposal--${proposal.status}`], styles[`proposal--${kind}`])}>
      <span className={styles.proposal__label}>{copy.label}</span>
      {(kind === 'edit' || kind === 'reply') && (
        <>
          <p className={clsx(styles.proposal__text, styles['proposal__text--before'])}>{proposal.originalText}</p>
          <ArrowRightIcon size={14} className={styles.proposal__arrow} aria-label={kind === 'reply' ? 'reply' : 'becomes'} />
        </>
      )}
      {(kind === 'tip' || kind === 'transfer') && (
        <p className={styles.proposal__amount}>
          <strong>
            {proposal.amount} {chainOf(proposal.networkId)?.nativeCurrency.symbol ?? ''}
          </strong>{' '}
          on {chainOf(proposal.networkId)?.name ?? 'an unknown network'} to {proposal.text || 'the author'}
          {/* The address itself, so the owner checks where money goes before approving */}
          {proposal.recipient && <code className={styles.proposal__address}>{proposal.recipient}</code>}
        </p>
      )}
      {kind === 'profile' && <ProfileChange before={readProfile(proposal.originalText)} after={readProfile(proposal.text)} />}
      {isEditing ? (
        <div className={styles.proposal__editor}>
          <textarea
            className={styles.proposal__input}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            maxLength={AGENT_POST_MAX}
            rows={Math.min(12, Math.max(3, editText.split('\n').length + 1))}
            aria-label="Edit the draft"
            disabled={isPublishing}
            autoFocus
          />
          <span className={clsx(styles.proposal__count, trimmed.length > AGENT_POST_MAX && styles['proposal__count--over'])}>
            {trimmed.length}/{AGENT_POST_MAX}
          </span>
        </div>
      ) : (
        kind !== 'transfer' &&
        kind !== 'profile' && (
          <p className={clsx(styles.proposal__text, kind === 'delete' && styles['proposal__text--removed'])}>
            {kind === 'delete' || kind === 'like' || kind === 'tip' ? proposal.originalText : proposal.text}
          </p>
        )
      )}
      {proposal.status === 'published' ? (
        <span className={styles.proposal__done}>
          <CheckIcon size={14} /> {copy.done}
        </span>
      ) : proposal.status === 'discarded' ? (
        <span className={styles.proposal__done}>Discarded</span>
      ) : (
        <div className={styles.proposal__actions}>
          {isEditing ? (
            <button type="button" className={styles.proposal__discard} onClick={() => setEditText(null)} disabled={isPublishing}>
              Cancel edit
            </button>
          ) : (
            <>
              <button type="button" className={styles.proposal__discard} onClick={() => onDiscard(proposal)} disabled={isPublishing}>
                <XIcon size={14} /> Discard
              </button>
              {canEdit && (
                <button type="button" className={styles.proposal__discard} onClick={() => setEditText(proposal.text ?? '')} disabled={isPublishing}>
                  <PencilSimpleIcon size={14} /> Edit
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className={styles.proposal__approve}
            onClick={() => onApprove(proposal, isEditing ? trimmed : null)}
            disabled={isPublishing || !isEditValid}
          >
            {isPublishing ? <ContentSpinner size={14} /> : <CheckIcon size={14} />} {copy.approve}
          </button>
        </div>
      )}
    </div>
  )
}

/** A profile card's body: each field that changes, its current value struck through above the new one. */
function ProfileChange({ before, after }) {
  return (
    <dl className={styles.proposal__profile}>
      {['name', 'description'].filter((field) => after[field] !== undefined).map((field) => (
        <div key={field}>
          <dt>{field === 'name' ? 'Name' : 'Bio'}</dt>
          <dd className={clsx(styles.proposal__text, styles['proposal__text--before'])}>{before[field] || 'Empty'}</dd>
          <dd className={styles.proposal__text}>{after[field] || 'Empty'}</dd>
        </div>
      ))}
    </dl>
  )
}
