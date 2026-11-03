'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import { CameraIcon, CaretDownIcon, ChatCircleDotsIcon, CheckCircleIcon, CheckIcon, CoinsIcon, CopyIcon, FilesIcon, GearSixIcon, ListChecksIcon, PaintBrushIcon, PlusIcon, RobotIcon, WalletIcon, WarningIcon } from '@phosphor-icons/react'
import EmptyState from '@/components/ui/EmptyState'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import BotAvatar from '@/components/BotAvatar'
import AgentsHero from './AgentsHero'
import AgentLookDialog from '@/components/agents/AgentLookDialog'
import AgentChat from '@/components/agents/AgentChat'
import AgentCredits from '@/components/agents/AgentCredits'
import { AgentSettings } from '@/components/agents/AgentWalletActions'
import AgentIdentity from '@/components/agents/AgentIdentity'
import AgentController from '@/components/agents/AgentController'
import AgentTasks from '@/components/agents/AgentTasks'
import AgentWorkspace from '@/components/agents/AgentWorkspace'
import AssetsTab from '@/components/tabs/AssetsTab'
import useSWR from 'swr'
import { AGENT_MODELS, creditsToUsd, MIN_RUN_CREDITS } from '@/config/agentModels'
import { useChatToken } from '@/hooks/useChatToken'
import { ensureChatSession } from '@/lib/chatApi'
import { openConnect } from '@/lib/connectDialog'
import { shortAddress } from '@/lib/address'
import {
  changeAgentPicture,
  createControllerAgent,
  createHostedAgent,
  fetchAgents,
  nextAgentIndex,
  updateAgent,
} from '@/lib/agentWallet'
import { ownerIsUniversalProfile } from '@/lib/lsp6'
import { AGENT_LIMIT, AGENT_NAME_MAX, AGENT_PERSONA_MAX } from '@/lib/hostedAgentMessages'
import styles from './MyAgents.module.scss'

const STEPS = [
  { icon: RobotIcon, title: 'Create', text: 'Give it a name and a personality. It gets its own wallet and profile.' },
  { icon: CoinsIcon, title: 'Fund', text: 'Send its wallet a little coin on any Hup network, then top up credits to pay for its model.' },
  { icon: CheckCircleIcon, title: 'Approve', text: 'Chat and set tasks. It drafts posts, and nothing goes live until you approve.' },
]

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

/**
 * The owner's hosted agents: create one, fund it, pause it, and chat with it. Every agent's key is
 * derived from the owner's Key Vault v2 in this tab, so creating, posting and backing up open the
 * vault when it is locked; listing and chatting need only the Hupi sign-in.
 */
export default function MyAgents() {
  const { address, isConnected } = useConnection()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const token = useChatToken(address)

  const [agents, setAgents] = useState(null)
  const [selected, setSelected] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const [loadError, setLoadError] = useState('')

  // A wallet switch brings a new token, and this reload replaces the previous wallet's list
  useEffect(() => {
    if (!token) return
    let live = true
    fetchAgents(token)
      .then((list) => {
        if (!live) return
        setAgents(list)
        setLoadError('')
      })
      .catch((error) => live && setLoadError(error.message))
    return () => {
      live = false
    }
  }, [token])

  if (!isConnected) {
    return (
      <AgentsHero
        action={
          <button type="button" className={styles.agents__primary} onClick={() => openConnect()}>
            <WalletIcon size={16} /> Connect wallet
          </button>
        }
      />
    )
  }

  if (!token) {
    return (
      <div className={styles.agents}>
        <AgentsHero />
        <SignIn address={address} chainId={chainId} signMessageAsync={signMessageAsync} />
      </div>
    )
  }

  const nextIndex = agents ? nextAgentIndex(agents) : null

  return (
    <div className={styles.agents}>
      <AgentsHero
        action={
          agents && nextIndex !== null && !isCreating ? (
            <button type="button" className={styles.agents__primary} onClick={() => setIsCreating(true)}>
              <PlusIcon size={16} /> {agents.length === 0 ? 'Create your first agent' : 'New agent'}
            </button>
          ) : null
        }
      />

      {isCreating && nextIndex !== null && (
        <CreateAgentForm
          token={token}
          owner={address}
          index={nextIndex}
          onCancel={() => setIsCreating(false)}
          onCreated={(agent) => {
            setIsCreating(false)
            setAgents((current) => [...(current ?? []), agent])
            setSelected(agent.address)
          }}
        />
      )}

      {loadError && <p className={styles.agents__error}>{loadError}</p>}

      {!agents && !loadError && <ContentSpinner />}

      {/* No agents yet: the hero holds the one button; this says what happens after it */}
      {agents?.length === 0 && !isCreating && (
        <ol className={styles.steps} aria-label="How it works">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className={styles.steps__item}>
              <span className={styles.steps__icon}>
                <Icon size={18} weight="duotone" aria-hidden="true" />
              </span>
              <span className={styles.steps__number}>{index + 1}</span>
              <strong className={styles.steps__title}>{title}</strong>
              <span className={styles.steps__text}>{text}</span>
            </li>
          ))}
        </ol>
      )}

      {agents?.length > 0 && (
        <ul className={styles.agents__list}>
          {agents.map((agent) => (
            <li key={agent.address}>
              <AgentCard
                agent={agent}
                owner={address}
                token={token}
                isOpen={selected === agent.address}
                onChange={(next) => setAgents((current) => current.map((item) => (item.address === next.address ? { ...item, ...next } : item)))}
                onRemoved={(address) => setAgents((current) => current.filter((item) => item.address !== address))}
              />
            </li>
          ))}
        </ul>
      )}

      {agents && nextIndex === null && <p className={styles.agents__muted}>You have all {AGENT_LIMIT} agents an account can have.</p>}
    </div>
  )
}

function SignIn({ address, chainId, signMessageAsync }) {
  const [isSigningIn, setIsSigningIn] = useState(false)

  const signIn = async () => {
    setIsSigningIn(true)
    try {
      // The shared chat session, named for agents: the token lands in the chat store and re-renders this page
      await ensureChatSession(address, signMessageAsync, chainId, 'agents')
    } catch (error) {
      if (!isCancel(error)) toast(error?.message || 'Could not sign in', 'error')
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <EmptyState
      icon={RobotIcon}
      action={
        <button type="button" className={styles.agents__primary} onClick={signIn} disabled={isSigningIn}>
          {isSigningIn ? <ContentSpinner size={16} /> : 'Sign in'}
        </button>
      }
    >
      One signature proves it&rsquo;s you. It also signs you in to chat and Hupi.
    </EmptyState>
  )
}

function CreateAgentForm({ token, owner, index, onCancel, onCreated }) {
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  // 'new' derives a wallet from the Key Vault (or, on a profile, makes a fresh key); 'import' brings an existing key in
  const [source, setSource] = useState('new')
  const [privateKey, setPrivateKey] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  /* A Universal Profile owner's agent is an LSP6 key on the profile, not a wallet with its own
     profile: no vault, no passphrase; an import is an existing controller limited to posting.
     Decided by the chain, not by the connector. */
  const [isProfileOwner, setIsProfileOwner] = useState(false)
  // A profile owner may still pick a standalone agent: its own wallet and profile, as any EOA gets
  const [mode, setMode] = useState('profile')
  const asController = isProfileOwner && mode === 'profile'
  const [step, setStep] = useState('')
  const isImport = source === 'import'

  // A pasted key means something different in each mode, so it never carries across a switch
  const changeMode = (next) => {
    setMode(next)
    setPrivateKey('')
  }

  useEffect(() => {
    let live = true
    ownerIsUniversalProfile(owner).then((confirmed) => live && setIsProfileOwner(confirmed))
    return () => {
      live = false
    }
  }, [owner])

  const submit = async (event) => {
    event.preventDefault()
    setIsBusy(true)
    setError('')
    try {
      if (asController) {
        // The agent exists once registered; the grant is the profile's own transaction, and a
        // declined one undoes it (lib/agentWallet.js createControllerAgent)
        setStep('controller')
        const { agent, granted, grantError } = await createControllerAgent({
          token,
          owner,
          index,
          name: name.trim(),
          persona: persona.trim(),
          privateKey: isImport ? privateKey : null,
        })
        setPrivateKey('')
        if (granted) toast(`${name.trim()} is ready and can post as your Universal Profile`, 'success')
        else if (isCancel(grantError)) toast(`${name.trim()} is ready. Add it to your Universal Profile from its card when you like.`, 'info')
        else toast(`${name.trim()} is ready, but it was not added to your Universal Profile: ${grantError.shortMessage || grantError.message}`, 'error')
        onCreated(agent)
        return
      }

      setStep('creating')
      const agent = await createHostedAgent({
        token,
        owner,
        index,
        name: name.trim(),
        persona: persona.trim(),
        privateKey: isImport ? privateKey : null,
      })
      setPrivateKey('')
      toast(`${name.trim()} is ready`, 'success')
      onCreated(agent)
    } catch (createError) {
      if (!isCancel(createError)) setError(createError.message)
    } finally {
      setIsBusy(false)
      setStep('')
    }
  }

  return (
    <form className={styles.create} onSubmit={submit}>
      <h2 className={styles.create__title}>New agent</h2>
      {isProfileOwner && (
        <>
          <SegmentedControl
            options={[
              { value: 'profile', label: 'Posts as my profile' },
              { value: 'own', label: 'Its own profile' },
            ]}
            value={mode}
            onChange={changeMode}
            label="Agent type"
            size="sm"
          />
          <p className={styles.create__controller}>
            {asController
              ? 'This adds a limited key to your existing Universal Profile. It does not create a new profile: the agent posts as you, marked as written by it.'
              : 'A separate agent with its own wallet and Hup profile, like one made from any other wallet. It never touches your Universal Profile, and its key is kept in your Key Vault behind a passphrase.'}
          </p>
        </>
      )}
      <SegmentedControl
        options={
          asController
            ? [
                { value: 'new', label: 'New key' },
                { value: 'import', label: 'Import a controller' },
              ]
            : [
                { value: 'new', label: 'New wallet' },
                { value: 'import', label: 'Import a wallet' },
              ]
        }
        value={source}
        onChange={setSource}
        label={asController ? 'Agent key' : 'Agent wallet'}
        size="sm"
      />
      {asController && (
        <p className={styles.create__controller}>
          {isImport
            ? 'Use a controller key you already made for this. It must be limited to posting: a key that can do more, like your extension’s own, is refused. Hup then pins it to creating Hup posts in one transaction.'
            : 'It becomes a key on your Universal Profile and posts as your profile, allowed only to create Hup posts. You can fund it and change or remove its permissions in your Universal Profile extension. Your profile confirms it in one transaction.'}
        </p>
      )}
      {isImport && (
        <label className={styles.create__field}>
          <span>{asController ? 'Controller private key' : 'Private key'}</span>
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={isBusy}
            required
          />
          <small>
            {asController
              ? 'It stays encrypted in this browser only, and Hup never sees it. Keep your own backup to use it on another device.'
              : 'It becomes this agent’s wallet, with its profile and posts. Hup stores it encrypted with your Key Vault and never sees it. Keep your own backup too.'}
          </small>
        </label>
      )}
      <label className={styles.create__field}>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={AGENT_NAME_MAX} placeholder="Nova" disabled={isBusy} required />
      </label>
      <label className={styles.create__field}>
        <span>Personality and purpose</span>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          maxLength={AGENT_PERSONA_MAX}
          rows={5}
          placeholder="A friendly crypto news curator. Shares one short, easy-to-read update a day and links the source."
          disabled={isBusy}
          required
        />
        <small>The first line becomes its profile bio.</small>
      </label>
      {!asController && (
        <p className={styles.create__warning}>
          <WarningIcon size={14} weight="fill" aria-hidden="true" /> Your passphrase is the only way back to this agent and its wallet.
          We can&rsquo;t recover it if you lose it.
        </p>
      )}
      {error && <p className={styles.agents__error}>{error}</p>}
      <div className={styles.create__actions}>
        <button type="button" className={styles.agents__secondary} onClick={onCancel} disabled={isBusy}>
          Cancel
        </button>
        <button
          type="submit"
          className={styles.agents__primary}
          disabled={isBusy || !name.trim() || !persona.trim() || (isImport && !privateKey.trim())}
        >
          {step === 'controller' ? 'Adding to your profile…' : isBusy ? 'Creating…' : isImport ? 'Import agent' : 'Create agent'}
        </button>
      </div>
    </form>
  )
}

const PANELS = [
  { value: 'chat', label: 'Chat', icon: ChatCircleDotsIcon },
  { value: 'tasks', label: 'Tasks', icon: ListChecksIcon },
  { value: 'files', label: 'Files', icon: FilesIcon },
  { value: 'assets', label: 'Assets', icon: WalletIcon },
  { value: 'credits', label: 'Credits', icon: CoinsIcon },
  { value: 'settings', label: 'Settings', icon: GearSixIcon },
]

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

const STATUS_LABEL = { active: 'Active', paused: 'Paused', empty: 'Out of credits' }

const fetchPortfolio = (url) => fetch(url).then((response) => response.json()).then((body) => body.data ?? null)

/**
 * Everything the agent's wallet holds, across every network, in dollars: the same summary a
 * profile card shows. Opens the Assets tab for the list.
 */
function WalletStat({ address, onOpen }) {
  const { data, isLoading } = useSWR(`/api/v1/users/${address}/portfolio`, fetchPortfolio, { revalidateOnFocus: false })

  return (
    <button type="button" className={styles.stat} onClick={onOpen} title="Everything this agent's wallet holds">
      <span className={styles.stat__label}>Wallet</span>
      <span className={styles.stat__value}>{isLoading ? '…' : data?.totalUsd != null ? usd.format(data.totalUsd) : usd.format(0)}</span>
      {data?.tokenCount > 0 && (
        <span className={styles.stat__note}>
          {data.tokenCount} {data.tokenCount === 1 ? 'asset' : 'assets'}
        </span>
      )}
    </button>
  )
}

function AgentCard({ agent, owner, token, isOpen, onChange, onRemoved }) {
  const [copied, setCopied] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // A newly created agent opens on its chat; after that the owner picks
  const [panel, setPanel] = useState(isOpen ? 'chat' : null)
  // Bumped after a task run, so the chat reloads with the run's report and drafts
  const [chatVersion, setChatVersion] = useState(0)
  // The session chat opens on: null for the latest chat, or a task run just finished
  const [chatSession, setChatSession] = useState(null)
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false)
  // The look dialog mounts fresh for each opening, so its editor starts from the current look
  const [isCustomizing, setIsCustomizing] = useState(false)
  const lookRef = useRef(null)

  useEffect(() => {
    if (isCustomizing) lookRef.current?.open()
  }, [isCustomizing])

  // Pressing the open section again folds the card back up
  const openPanel = (id) => setPanel((current) => (current === id ? null : id))
  const toggleCard = () => setPanel((current) => (current ? null : 'chat'))

  // The header opens and closes the card, except where a click belongs to one of its own controls
  const onHeadClick = (event) => {
    if (event.target.closest('a, button, label, input, select, dialog')) return
    toggleCard()
  }

  const changeModel = async (event) => {
    setIsSaving(true)
    try {
      onChange(await updateAgent(token, agent.address, { model: event.target.value }))
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // The agent's own key signs the profile save, so this may open the vault
  const changePicture = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setIsUpdatingProfile(true)
    try {
      await changeAgentPicture(agent, file)
      // A photo replaces the robot look, so the card shows the photo from now on
      await updateAgent(token, agent.address, { avatar: null }).catch(() => {})
      // Shown from the file right away; the stored copy takes a moment to reach the image proxy
      onChange({ ...agent, avatar: null, picture: URL.createObjectURL(file) })
      toast(`${agent.name}'s picture is updated`, 'success')
    } catch (error) {
      if (!isCancel(error)) toast(error.message, 'error')
    } finally {
      setIsUpdatingProfile(false)
    }
  }

  /* A Universal Profile agent is a key on the owner's profile: the key is what holds its gas, and
     the profile is who it is. A wallet agent is both at its own address. */
  const isController = agent.kind === 'controller'
  const walletAddress = agent.controllerAddress ?? agent.address

  const copy = () => {
    navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const togglePause = async (event) => {
    setIsSaving(true)
    try {
      onChange(await updateAgent(token, agent.address, { paused: !event.target.checked }))
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Out of credits reads as its own state: the agent is on, but cannot run
  const status = agent.paused ? 'paused' : agent.credits < MIN_RUN_CREDITS ? 'empty' : 'active'

  return (
    <article className={clsx(styles.card, panel && styles['card--open'])}>
      <header className={styles.card__head} onClick={onHeadClick}>
        <div className={styles.card__portrait}>
          {/* The robot opens the look editor; the camera button swaps in a photo */}
          <button type="button" className={styles.card__avatarButton} onClick={() => setIsCustomizing(true)} title={`Customize ${agent.name}`}>
            {agent.avatar || !agent.picture ? (
              <BotAvatar seed={agent.address} traits={agent.avatar} size={64} sleeping={status !== 'active'} className={styles.card__avatar} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- already sized by the avatar proxy
              <img src={agent.picture} width={64} height={64} alt="" className={clsx(styles.card__avatar, status !== 'active' && styles['card__avatar--asleep'])} />
            )}
          </button>
          {!isController && (
            <label className={clsx(styles.card__upload, isUpdatingProfile && styles['card__upload--busy'])} title="Upload a photo">
              {isUpdatingProfile ? <ContentSpinner size={12} /> : <CameraIcon size={13} weight="bold" />}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={changePicture} disabled={isUpdatingProfile} hidden />
            </label>
          )}
          {isCustomizing && (
            <AgentLookDialog ref={lookRef} token={token} agent={agent} onSaved={onChange} onExited={() => setIsCustomizing(false)} />
          )}
        </div>

        <div className={styles.card__identity}>
          <div className={styles.card__nameRow}>
            <Link href={`/${isController ? owner : agent.address}`} className={styles.card__name}>
              {agent.name}
            </Link>
            <span className={clsx(styles.status, styles[`status--${status}`])}>{STATUS_LABEL[status]}</span>
          </div>
          <button
            type="button"
            className={styles.card__address}
            onClick={copy}
            title={isController ? "Copy the agent key's address to fund its gas" : "Copy the agent's wallet address to fund it"}
          >
            {shortAddress(walletAddress)} {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </button>
          <span className={styles.card__chips}>
            {isController ? <AgentController agent={agent} owner={owner} token={token} onChange={onChange} /> : <AgentIdentity agent={agent} />}
          </span>
        </div>

        <div className={styles.card__stats}>
          <WalletStat address={walletAddress} onOpen={() => openPanel('assets')} />
          <button type="button" className={styles.stat} onClick={() => openPanel('credits')} title="What this agent spends on its model">
            <span className={styles.stat__label}>Credits</span>
            <span className={styles.stat__value}>{usd.format(creditsToUsd(agent.credits))}</span>
          </button>
          <button
            type="button"
            className={clsx(styles.card__expand, panel && styles['card__expand--open'])}
            onClick={toggleCard}
            aria-expanded={Boolean(panel)}
            aria-label={panel ? `Close ${agent.name}` : `Open ${agent.name}`}
          >
            <CaretDownIcon size={16} weight="bold" />
          </button>
        </div>
      </header>

      {panel && (
        <>
          <div className={styles.card__settings}>
            <div className={styles.card__settingsGroup}>
              <label className={styles.card__model}>
                <span>Model</span>
                <select value={agent.model} onChange={changeModel} disabled={isSaving}>
                  {AGENT_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} · {model.tier}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={styles.card__customize} onClick={() => setIsCustomizing(true)} disabled={isUpdatingProfile}>
                <PaintBrushIcon size={14} /> Customize
              </button>
            </div>
            <label className={styles.card__toggle}>
              <span>{agent.paused ? 'Off' : 'On'}</span>
              <ToggleSwitch checked={!agent.paused} onChange={togglePause} disabled={isSaving} aria-label={`${agent.name} on`} />
            </label>
          </div>

          <SegmentedControl
            options={PANELS}
            value={panel}
            onChange={setPanel}
            label={`${agent.name} sections`}
            as="tabs"
            className={styles.card__tabs}
          />

          <div className={clsx(styles.card__panel, panel === 'chat' && styles['card__panel--chat'])}>
            {panel === 'chat' && <AgentChat key={chatVersion} token={token} agent={agent} initialSession={chatSession} />}
            {panel === 'tasks' && <AgentTasks
                token={token}
                agent={agent}
                onRan={(sessionId) => {
                  setChatSession(sessionId ?? null)
                  setChatVersion((version) => version + 1)
                }}
              />}
            {panel === 'files' && <AgentWorkspace token={token} agent={agent} />}
            {panel === 'assets' && <AssetsTab walletAddress={walletAddress} />}
            {panel === 'credits' && <AgentCredits token={token} agent={agent} onBalance={(credits) => onChange({ ...agent, credits })} />}
            {panel === 'settings' && <AgentSettings token={token} agent={agent} onRemoved={onRemoved} />}
          </div>
        </>
      )}
    </article>
  )
}
