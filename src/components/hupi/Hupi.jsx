'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import { ArrowClockwiseIcon, ArrowUpIcon, WalletIcon, XIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import EmptyState from '@/components/ui/EmptyState'
import { ContentSpinner, ThinkingOrb } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { useChatToken } from '@/hooks/useChatToken'
import { clearChatToken, ensureChatSession } from '@/lib/chatApi'
import { openConnect } from '@/lib/connectDialog'
import { renderMarkdown } from '@/lib/markdown'
import { parseHupiPage } from '@/lib/hupiPage'
import { HUPI_PAGE_SUGGESTIONS, HUPI_SUGGESTIONS } from '@/config/hupi'
import HupiFace from './HupiFace'
import HupiCards from './HupiCards'
import styles from './Hupi.module.scss'

/**
 * @file components/hupi/Hupi.jsx
 * @description Hupi, the assistant: a launcher for the floating action column and the
 * panel it opens. The panel is a manual popover rather than a dialog — it is a chat, so the
 * page behind it stays usable and only the close button or Esc puts it away.
 */

// The sign-in step greets with the face itself, larger than EmptyState's glyph size
const GateLogo = () => <HupiFace size={56} />

const ENDPOINT = '/api/v1/hupi'
// The server keeps only this tail of a conversation, so sending more is wasted bytes
const HISTORY_SENT = 12

// The conversation survives a reload in this tab, per wallet. Storage can be blocked, so
// every access is guarded and a failure only costs the history.
const storageKey = (wallet) => `hupi:conversation:${wallet}`

const readConversation = (wallet) => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey(wallet)) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeConversation = (wallet, messages) => {
  try {
    window.sessionStorage.setItem(storageKey(wallet), JSON.stringify(messages))
  } catch {
    /* storage blocked: the conversation lives for this page only */
  }
}

/**
 * Ask Hupi and read the answer as it streams: NDJSON lines of status, delta, cards, followups, done
 * or error (see api/v1/hupi). A refusal before streaming (auth, quota) is a JSON error
 * with a status. `page` is the path the member has open, so "this post" can mean something.
 */
const streamHupi = async (token, messages, page, { onStatus, onDelta, onCards, onFollowUps }) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: messages.slice(-HISTORY_SENT).map(({ role, content }) => ({ role, content })), page }),
  })

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(data?.error || 'Hupi could not answer right now')
    error.status = response.status
    throw error
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += value
    const lines = buffer.split('\n')
    // The last piece may be half a line; it waits for the next chunk
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)
      if (event.type === 'delta') onDelta(event.text)
      else if (event.type === 'status') onStatus(event.text)
      else if (event.type === 'cards') onCards(event.cards)
      else if (event.type === 'followups') onFollowUps(event.items)
      else if (event.type === 'done') finished = true
      else if (event.type === 'error') throw new Error(event.error)
    }
  }

  if (!finished) throw new Error('Hupi was cut off, try asking again')
}

/**
 * @param {Object} props
 * @param {string} [props.className] The floating column's button chrome, from Aside.
 */
export default function Hupi({ className }) {
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const chainId = useChainId()
  const me = isConnected && address ? address.toLowerCase() : null

  const token = useChatToken(me)
  // Lifted from the conversation so the faces on the launcher and header work while it answers
  const [isBusy, setIsBusy] = useState(false)
  const mood = isBusy ? 'thinking' : 'idle'

  return (
    <NativePopover
      type="manual"
      placement="left-end"
      className={styles.hupi}
      trigger={
        <button className={className} aria-label="Ask Hupi" title="Ask Hupi">
          <HupiFace mood={mood} interactive className={styles.hupi__launcherFace} />
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.hupi__frame}>
          <header className={styles.hupi__header}>
            <HupiFace mood={mood} size={36} />
            <div className={styles.hupi__titles}>
              <strong className={styles.hupi__title}>Hupi</strong>
              <span className={styles.hupi__subtitle}>Ask me anything about Hup</span>
            </div>
            {me && token &&<ResetButton wallet={me} />}
            <button type="button" className={styles.hupi__iconButton} onClick={close} aria-label="Close Hupi">
              <XIcon />
            </button>
          </header>

          {!me ? (
            <Gate
              icon={WalletIcon}
              text="Connect a wallet to meet Hupi."
              action={
                <button type="button" className={styles.hupi__cta} onClick={() => openConnect()}>
                  Connect wallet
                </button>
              }
            />
          ) : !token ? (
            <SignIn wallet={me} chainId={chainId} signMessageAsync={signMessageAsync} />
          ) : (
            <Conversation key={me} wallet={me} token={token} onNavigate={close} onBusyChange={setIsBusy} />
          )}
        </div>
      )}
    </NativePopover>
  )
}

function Gate({ icon, text, action }) {
  return (
    <div className={styles.hupi__center}>
      <EmptyState icon={icon} align="center" action={action}>
        {text}
      </EmptyState>
    </div>
  )
}

function SignIn({ wallet, chainId, signMessageAsync }) {
  const [isSigningIn, setIsSigningIn] = useState(false)

  const signIn = async () => {
    if (isSigningIn) return
    setIsSigningIn(true)
    try {
      // The token lands in the shared chat store, which re-renders the panel into the conversation
      await ensureChatSession(wallet, signMessageAsync, chainId, 'hupi')
    } catch (error) {
      if (error?.name !== 'UserRejectedRequestError') toast(error?.message || 'Could not sign in to Hupi', 'error')
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <Gate
      icon={GateLogo}
      text="One signature proves it's you. It also signs you in to chat."
      action={
        <button type="button" className={styles.hupi__cta} onClick={signIn} disabled={isSigningIn}>
          {isSigningIn ? <ContentSpinner size={16} /> : 'Sign in to Hupi'}
        </button>
      }
    />
  )
}

// Clearing is broadcast through storage + an event so the conversation, which owns the state,
// starts over without the header having to hold it
const RESET_EVENT = 'hupi:reset'

function ResetButton({ wallet }) {
  return (
    <button
      type="button"
      className={styles.hupi__iconButton}
      aria-label="New conversation"
      title="New conversation"
      onClick={() => {
        writeConversation(wallet, [])
        window.dispatchEvent(new CustomEvent(RESET_EVENT, { detail: wallet }))
      }}
    >
      <ArrowClockwiseIcon />
    </button>
  )
}

function Conversation({ wallet, token, onNavigate, onBusyChange }) {
  const router = useRouter()
  const pathname = usePathname()
  const page = parseHupiPage(pathname)
  const suggestions = page ? [HUPI_PAGE_SUGGESTIONS[page.kind], ...HUPI_SUGGESTIONS] : HUPI_SUGGESTIONS
  const [messages, setMessages] = useState(() => (typeof window === 'undefined' ? [] : readConversation(wallet)))
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  // The thinking bubble: what it says and which orb it shows; null once the reply is arriving
  const [status, setStatus] = useState(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onReset = (event) => {
      if (event.detail === wallet) setMessages([])
    }
    window.addEventListener(RESET_EVENT, onReset)
    return () => window.removeEventListener(RESET_EVENT, onReset)
  }, [wallet])

  useEffect(() => {
    writeConversation(wallet, messages)
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [wallet, messages, status])

  // Plain function: the React Compiler memoizes it
  const send = async (text) => {
    const question = text.trim()
    if (!question || isBusy) return

    const next = [...messages, { id: crypto.randomUUID(), role: 'user', content: question }]
    const replyId = crypto.randomUUID()
    setMessages(next)
    setDraft('')
    setIsBusy(true)
    onBusyChange(true)
    setStatus({ text: 'Thinking…', orb: 'working' })

    try {
      // Extras (cards, chips) land on the reply once its text exists; the server sends them last
      const attach = (fields) =>
        setMessages((current) => current.map((message) => (message.id === replyId ? { ...message, ...fields } : message)))

      await streamHupi(token, next, pathname, {
        // A status line names the lookup that is running; the orb keeps working
        onStatus: (text) => setStatus({ text, orb: 'working' }),
        onDelta: (piece) => {
          setStatus(null)
          setMessages((current) => {
            const last = current.at(-1)
            return last?.id === replyId
              ? [...current.slice(0, -1), { ...last, content: last.content + piece }]
              : [...current, { id: replyId, role: 'assistant', content: piece }]
          })
        },
        onCards: (cards) => attach({ cards }),
        onFollowUps: (followUps) => attach({ followUps }),
      })
    } catch (error) {
      // An expired session drops back to the sign-in step; the question and any partial reply stay
      if (error.status === 401) clearChatToken(wallet)
      toast(error.message, 'error')
    } finally {
      setIsBusy(false)
      onBusyChange(false)
      setStatus(null)
      inputRef.current?.focus()
    }
  }

  const lastMessage = messages.at(-1)

  // Replies link to posts and profiles with relative paths; route them in-app instead of a reload
  const handleReplyClick = (event) => {
    const anchor = event.target.closest('a[href]')
    const href = anchor?.getAttribute('href')
    if (!href?.startsWith('/') || href.startsWith('//')) return
    event.preventDefault()
    router.push(href)
    onNavigate()
  }

  return (
    <>
      <div ref={listRef} className={styles.hupi__messages} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.hupi__welcome}>
            <p className={styles.hupi__greeting}>Hi! I can catch you up on Hup. Try one of these:</p>
            <Rise targets="children" className={styles.hupi__suggestions}>
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className={styles.hupi__suggestion} onClick={() => send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </Rise>
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <Rise key={message.id} className={clsx(styles.hupi__bubble, styles['hupi__bubble--user'])}>
                {message.content}
              </Rise>
            ) : (
              <Fragment key={message.id}>
                <Rise className={clsx(styles.hupi__bubble, styles['hupi__bubble--hupi'])} onClick={handleReplyClick}>
                  <div className={styles.hupi__markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content, { linkPostPaths: true }) }} />
                </Rise>
                {message.cards?.length > 0 && <HupiCards cards={message.cards} onNavigate={onNavigate} />}
              </Fragment>
            ),
          )
        )}
        {/* Next questions, under the latest reply only, and only once it has finished */}
        {!isBusy && lastMessage?.role === 'assistant' && lastMessage.followUps?.length > 0 && (
          <Rise targets="children" className={clsx(styles.hupi__suggestions, styles['hupi__suggestions--followUps'])}>
            {lastMessage.followUps.map((followUp) => (
              <button key={followUp} type="button" className={styles.hupi__suggestion} onClick={() => send(followUp)}>
                {followUp}
              </button>
            ))}
          </Rise>
        )}
        {status && (
          <Rise className={clsx(styles.hupi__bubble, styles['hupi__bubble--hupi'], styles['hupi__bubble--thinking'])}>
            <ThinkingOrb state={status.orb} label={status.text} className={styles.hupi__orb} />
            <span>{status.text}</span>
          </Rise>
        )}
      </div>

      <form
        className={styles.hupi__composer}
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
      >
        <textarea
          ref={inputRef}
          className={styles.hupi__input}
          value={draft}
          rows={1}
          maxLength={2000}
          placeholder="Ask Hupi…"
          aria-label="Ask Hupi"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send(draft)
            }
          }}
        />
        <button type="submit" className={styles.hupi__send} disabled={!draft.trim() || isBusy} aria-label="Send">
          <ArrowUpIcon weight="bold" />
        </button>
      </form>
    </>
  )
}
