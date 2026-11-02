'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ethers } from 'ethers'
import { ArrowSquareOutIcon, ArrowsLeftRightIcon, ClockCounterClockwiseIcon, CubeIcon, FileTextIcon, InfoIcon, PlusIcon, ShieldCheckIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { ContentSpinner, Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import { CORE_FILES, FILE_MAX_CHARS, isSkillPath, SKILL_LIMIT, skillPath, skillSlug, skillTemplate } from '@/lib/agentWorkspaceFiles'
import { deleteWorkspaceSkill, fetchWorkspace, recordWorkspaceSnapshot, restoreWorkspaceFiles, writeWorkspaceFile } from '@/lib/agentWallet'
import { quoteSnapshot, readWorkspaceOnchain, saveWorkspaceOnchain, storageChains, WORKSPACE_CHAIN_ID } from '@/lib/agentWorkspaceChain'
import { config } from '@/config/wagmi'
import styles from './AgentWorkspace.module.scss'

const isCancel = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError'

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const coin = (wei, symbol = '') => `${Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`.trim()

/** A network's name from the app's own list, for snapshots saved on it. */
const chainName = (chainId) => config.chains.find((chain) => chain.id === Number(chainId))?.name ?? `Chain ${chainId}`

// Sealing adds a short header, the IV and the GCM tag; enough to price before the vault is opened
const SEAL_OVERHEAD = 64

const STEP_TEXT = {
  prepare: 'Preparing…',
  price: 'Pricing…',
  confirm: 'Paying from the agent’s wallet…',
  upload: 'Uploading…',
  writing: 'Writing onchain…',
}

// The folder a skill's frontmatter `name:` asks for, or null when it has none
const skillPathFromContent = (content) => {
  const name = /^---\s*\n[\s\S]*?^name:\s*(.+?)\s*$/m.exec(content)?.[1]
  return name && skillSlug(name) ? skillPath(name) : null
}

const labelFor = (path) => CORE_FILES.find((file) => file.path === path)?.label ?? 'Skill'

/**
 * An agent's workspace in OpenClaw's layout: its soul, memory, rules, notes about its owner, tasks
 * and skills. Files are edited here as a working copy; "Save onchain" writes an encrypted snapshot
 * of all of them through ChainKeep, paid by the agent's wallet, and any snapshot can restore them.
 */
export default function AgentWorkspace({ token, agent }) {
  const [workspace, setWorkspace] = useState(null)
  const [selected, setSelected] = useState('SOUL.md')
  const [draft, setDraft] = useState('')
  const [newSkill, setNewSkill] = useState('')
  const skillsInfoRef = useRef(null)
  const [isSaving, setIsSaving] = useState(false)
  const [chainStep, setChainStep] = useState('')
  const [quote, setQuote] = useState(null)
  // Pricing asks ChainKeep and takes a few seconds; without this the button looks dead
  const [isPricing, setIsPricing] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  // Where the next snapshot goes; ChainKeep's networks load once, LUKSO until then
  const [chains, setChains] = useState([])
  const [chainId, setChainId] = useState(WORKSPACE_CHAIN_ID)
  const chosen = chains.find((chain) => chain.id === chainId)

  useEffect(() => {
    let live = true
    storageChains()
      .then((list) => live && setChains(list))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    fetchWorkspace(token, agent.address)
      .then((data) => {
        if (!live) return
        setWorkspace(data)
        setDraft(data.files.find((file) => file.path === selected)?.content ?? '')
      })
      .catch((error) => live && toast(error.message, 'error'))
    return () => {
      live = false
    }
    // `selected` is read once per load; picking another file is handled by `pick`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, agent.address, version])

  const reload = () => setVersion((value) => value + 1)
  const current = workspace?.files.find((file) => file.path === selected)
  const isDirty = current && draft !== current.content

  const pick = (path) => {
    if (isDirty && !window.confirm('Discard your unsaved changes to this file?')) return
    setSelected(path)
    setDraft(workspace.files.find((file) => file.path === path)?.content ?? '')
  }

  const saveFile = async () => {
    setIsSaving(true)
    try {
      // A skill whose `name:` changed moves to the folder of its new name, unless one is taken
      const renamed = isSkillPath(selected) ? skillPathFromContent(draft) : null
      const target = renamed && renamed !== selected && !workspace.files.some((file) => file.path === renamed) ? renamed : selected
      await writeWorkspaceFile(token, agent.address, target, draft)
      if (target !== selected) await deleteWorkspaceSkill(token, agent.address, selected)
      setWorkspace((value) => ({
        ...value,
        files: value.files.map((file) => (file.path === selected ? { ...file, path: target, content: draft } : file)),
      }))
      setSelected(target)
      toast(target === selected ? `${selected} saved` : `Skill renamed to ${target.split('/')[1]}`, 'success')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const addSkill = async (event) => {
    event.preventDefault()
    if (!skillSlug(newSkill)) return
    const path = skillPath(newSkill)
    if (workspace.files.some((file) => file.path === path)) {
      pick(path)
      return
    }
    setIsSaving(true)
    try {
      const content = skillTemplate(newSkill)
      await writeWorkspaceFile(token, agent.address, path, content)
      setWorkspace((value) => ({ ...value, files: [...value.files, { path, content, editable: true }] }))
      setSelected(path)
      setDraft(content)
      setNewSkill('')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const removeSkill = async () => {
    if (!window.confirm(`Remove ${selected}? Snapshots already onchain keep it.`)) return
    setIsSaving(true)
    try {
      await deleteWorkspaceSkill(token, agent.address, selected)
      setWorkspace((value) => ({ ...value, files: value.files.filter((file) => file.path !== selected) }))
      setSelected('SOUL.md')
      setDraft(workspace.files.find((file) => file.path === 'SOUL.md')?.content ?? '')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const filesMap = () => Object.fromEntries(workspace.files.map((file) => [file.path, file.path === selected ? draft : file.content]))

  const priceSave = async () => {
    setIsPricing(true)
    try {
      const size = new TextEncoder().encode(JSON.stringify(filesMap())).length + SEAL_OVERHEAD
      setQuote(await quoteSnapshot(size, chainId))
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsPricing(false)
    }
  }

  const saveOnchain = async () => {
    if (isDirty) await saveFile()
    setChainStep('prepare')
    try {
      const snapshot = await saveWorkspaceOnchain({ agent, files: filesMap(), chainId, onStep: (step) => STEP_TEXT[step] && setChainStep(step) })
      await recordWorkspaceSnapshot(token, agent.address, { chainId, ...snapshot })
      toast(`${agent.name}'s workspace is saved onchain`, 'success')
      setQuote(null)
      reload()
    } catch (error) {
      if (!isCancel(error)) toast(error.message, 'error')
    } finally {
      setChainStep('')
    }
  }

  const restore = async (snapshot) => {
    if (!window.confirm(`Replace ${agent.name}'s files and tasks with the snapshot from ${dateTime.format(new Date(snapshot.createdAt))}?`)) return
    setChainStep('restore')
    setRestoringId(snapshot.fileId)
    try {
      const document = await readWorkspaceOnchain({ agent, fileId: snapshot.fileId, chainId: snapshot.chainId })
      await restoreWorkspaceFiles(token, agent.address, document.files)
      toast('Workspace restored', 'success')
      reload()
    } catch (error) {
      if (!isCancel(error)) toast(error.message, 'error')
    } finally {
      setChainStep('')
      setRestoringId(null)
    }
  }

  if (!workspace) return <ContentSpinner />

  const busy = isSaving || isPricing || Boolean(chainStep)
  const skills = workspace.files.filter((file) => isSkillPath(file.path))

  return (
    <div className={styles.workspace}>
      <div className={styles.workspace__body}>
        <nav className={styles.workspace__files} aria-label="Workspace files">
          {workspace.files
            .filter((file) => !isSkillPath(file.path))
            .map((file) => (
              <button key={file.path} type="button" className={clsx(styles.file, selected === file.path && styles['file--active'])} onClick={() => pick(file.path)}>
                <FileTextIcon size={14} />
                <span className={styles.file__name}>{file.path}</span>
              </button>
            ))}

          <span className={styles.workspace__heading}>
            Skills
            <button type="button" className={styles.workspace__info} onClick={() => skillsInfoRef.current?.open()} aria-label="What are skills?" title="What are skills?">
              <InfoIcon size={14} />
            </button>
          </span>
          {skills.map((file) => (
            <button key={file.path} type="button" className={clsx(styles.file, selected === file.path && styles['file--active'])} onClick={() => pick(file.path)}>
              <FileTextIcon size={14} />
              <span className={styles.file__name}>{file.path.split('/')[1]}</span>
            </button>
          ))}
          <form className={styles.workspace__addSkill} onSubmit={addSkill}>
            <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="New skill" maxLength={40} disabled={busy} aria-label="New skill name" />
            <button type="submit" disabled={busy || !skillSlug(newSkill)} aria-label="Add skill">
              <PlusIcon size={14} />
            </button>
          </form>
        </nav>

        <div className={styles.workspace__editor}>
          <div className={styles.workspace__editorHead}>
            <span>
              <strong>{selected}</strong> · {labelFor(selected)}
            </span>
            {isSkillPath(selected) && (
              <button type="button" className={styles.workspace__icon} onClick={removeSkill} disabled={busy} aria-label={`Remove ${selected}`}>
                <TrashIcon size={14} />
              </button>
            )}
          </div>
          <textarea
            className={styles.workspace__text}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            readOnly={!current?.editable}
            disabled={busy}
            spellCheck={selected.endsWith('.md')}
            rows={14}
          />
          {/* Always laid out, so switching to a read-only file never changes the panel's height */}
          <div className={clsx(styles.workspace__editorActions, !current?.editable && styles['workspace__editorActions--hidden'])}>
            <button type="button" className={styles.workspace__primary} onClick={saveFile} disabled={busy || !isDirty || !current?.editable}>
              {isSaving ? 'Saving…' : isDirty ? 'Save file' : 'Saved'}
            </button>
          </div>
        </div>
      </div>

      <SkillsInfoDialog ref={skillsInfoRef} agentName={agent.name} />

      <section className={styles.chain}>
        <div className={styles.chain__head}>
          <span className={styles.chain__title}>
            <CubeIcon size={16} /> Onchain snapshots
          </span>
          <p className={styles.chain__muted}>Encrypted, permanent, and only your wallet and passphrase can open it. Never put credentials here.</p>
        </div>

        <ul className={styles.chain__why}>
          <li>
            <ShieldCheckIcon size={14} weight="duotone" aria-hidden="true" />
            <span>
              <strong>Never lose {agent.name}.</strong> Its memory, skills and tasks stay onchain, safe even if Hup&rsquo;s database is
              lost, and come back on any device.
            </span>
          </li>
          <li>
            <ClockCounterClockwiseIcon size={14} weight="duotone" aria-hidden="true" />
            <span>
              <strong>Undo anything.</strong> Every save is a version you can restore if a change goes wrong.
            </span>
          </li>
          <li>
            <ArrowsLeftRightIcon size={14} weight="duotone" aria-hidden="true" />
            <span>
              <strong>Yours to take anywhere.</strong> It&rsquo;s owned by {agent.name}&rsquo;s wallet and uses OpenClaw&rsquo;s layout,
              not locked into Hup.
            </span>
          </li>
        </ul>

        {/* Its own row under the title, so a price or a longer label never pushes the buttons around */}
        {quote === null ? (
          <div className={styles.chain__actions}>
            <select
              className={styles.chain__network}
              value={chainId}
              onChange={(e) => setChainId(Number(e.target.value))}
              disabled={busy || chains.length === 0}
              aria-label="Network to save on"
            >
              {chains.length === 0 && <option value={chainId}>{chainName(chainId)}</option>}
              {chains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
            <button type="button" className={clsx(styles.workspace__primary, styles.chain__button)} onClick={priceSave} disabled={busy}>
              {isPricing ? (
                <>
                  <Spinner size={12} label="Working" /> Pricing…
                </>
              ) : (
                'Save onchain'
              )}
            </button>
          </div>
        ) : (
          <div className={styles.chain__confirm}>
            <span className={styles.chain__price}>
              About <strong>{coin(quote, chosen?.symbol)}</strong> on {chosen?.name ?? chainName(chainId)}, from {agent.name}&rsquo;s wallet
            </span>
            <div className={styles.chain__confirmButtons}>
              <button type="button" className={styles.workspace__secondary} onClick={() => setQuote(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={clsx(styles.workspace__primary, styles.chain__button)} onClick={saveOnchain} disabled={busy}>
                {chainStep && chainStep !== 'restore' ? (
                  <>
                    <Spinner size={12} label="Working" /> {STEP_TEXT[chainStep]}
                  </>
                ) : (
                  'Pay and save'
                )}
              </button>
            </div>
          </div>
        )}

        {workspace.snapshots.length === 0 ? (
          <p className={styles.chain__muted}>Nothing saved yet.</p>
        ) : (
          <ul className={styles.chain__list}>
            {workspace.snapshots.map((snapshot) => (
              <li key={snapshot.fileId} className={styles.chain__row}>
                <span>
                  {dateTime.format(new Date(snapshot.createdAt))} <span className={styles.chain__muted}>· {chainName(snapshot.chainId)}</span>
                </span>
                <span className={styles.chain__muted}>{(snapshot.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</span>
                <a className={styles.chain__link} href={`https://chainkeep.online/file/${snapshot.chainId}/${snapshot.fileId}`} target="_blank" rel="noreferrer">
                  View <ArrowSquareOutIcon size={12} />
                </a>
                <button type="button" className={styles.workspace__secondary} onClick={() => restore(snapshot)} disabled={busy}>
                  {restoringId === snapshot.fileId ? (
                    <>
                      <Spinner size={12} label="Working" /> Restoring…
                    </>
                  ) : (
                    'Restore'
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const SKILL_EXAMPLE = `---
name: daily-news
description: Use when asked for today's news or a daily news post.
---

# Daily news

1. Check what is trending on Hup.
2. Pick the biggest story.
3. Draft one post under 280 characters with its link.`

/** What a skill is and how to write one. Always mounted; opened from the Skills heading. */
function SkillsInfoDialog({ ref, agentName }) {
  return (
    <NativeDialog ref={ref} className={styles.info} aria-label="About skills" lightDismiss>
      <header className={styles.info__header}>
        <h3>Skills</h3>
        <button type="button" className={styles.info__close} onClick={() => ref.current?.close()} aria-label="Close">
          <XIcon size={18} />
        </button>
      </header>
      <p className={styles.info__text}>
        A skill is a written recipe that teaches {agentName} how to do one kind of job your way. Nothing is installed: it is plain text
        {agentName} reads before every chat and task.
      </p>
      <ol className={styles.info__steps}>
        <li>
          <strong>Name it</strong> and press + to create its <code>SKILL.md</code>.
        </li>
        <li>
          <strong>Write the description:</strong> one sentence on when to use it. {agentName} picks a skill by this line.
        </li>
        <li>
          <strong>Write the steps</strong> below it, the way you would explain the job to a new teammate.
        </li>
      </ol>
      <pre className={styles.info__example}>{SKILL_EXAMPLE}</pre>
      <ul className={styles.info__notes}>
        <li>A skill guides what {agentName} already can do — read Hup, keep notes and draft posts for your approval. It cannot add new powers like other apps or websites.</li>
        <li>
          Up to {SKILL_LIMIT} skills, {FILE_MAX_CHARS.toLocaleString()} characters each. Keep them short: very long ones are cut when they are
          read.
        </li>
        <li>Skills follow OpenClaw&rsquo;s format, so one written for OpenClaw can be pasted in.</li>
        <li>They are saved in onchain snapshots. Never put passwords or keys in one.</li>
      </ul>
    </NativeDialog>
  )
}
