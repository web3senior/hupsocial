'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import {
  ArrowSquareOutIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  FileJsIcon,
  EyeSlashIcon,
  GlobeIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  PuzzlePieceIcon,
  SealCheckIcon,
  SquaresFourIcon,
  StarIcon,
} from '@phosphor-icons/react'
import PageTitle from '@/components/PageTitle'
import ListAppDialog from '@/components/ListAppDialog'
import AppModerationBar from '@/components/AppModerationBar'
import { useAppsModerator } from '@/hooks/useAppsModerator'
import clsx from 'clsx'
import styles from './page.module.scss'

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const fetcher = async (url) => {
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || !json.success) {
    throw new Error(json.error || 'Apps failed to load')
  }

  return json
}

export default function AppsPage() {
  const [categoryId, setCategoryId] = useState('all')
  const [networkId, setNetworkId] = useState('all')
  const [query, setQuery] = useState('')

  const listDialogRef = useRef(null)
  const editDialogRef = useRef(null)
  const [editingApp, setEditingApp] = useState(null)
  const [showHidden, setShowHidden] = useState(false)

  // The edit dialog mounts on demand, so it can only be shown after the render that creates it
  useEffect(() => {
    if (editingApp) editDialogRef.current?.open()
  }, [editingApp])

  // Hidden listings are only reachable through a moderator's own view — otherwise hiding would
  // be a one-way door, since a hidden card takes its moderation controls with it
  const { canModerate } = useAppsModerator()
  const canSeeHidden = canModerate && showHidden

  const { data, error, isLoading, mutate } = useSWR(canSeeHidden ? '/api/v1/apps?includeHidden=1' : '/api/v1/apps', fetcher)

  const apps = useMemo(() => data?.data || [], [data])
  const categories = data?.meta?.categories || []
  const networks = data?.meta?.networks || []
  const total = data?.meta?.total || 0

  const filteredApps = useMemo(() => {
    const search = query.trim().toLowerCase()

    return apps.filter((app) => {
      if (categoryId !== 'all' && app.category.id !== categoryId) return false
      if (networkId !== 'all' && app.network.id !== networkId) return false
      if (!search) return true

      const haystack = [app.name, app.description, app.category.name, app.network.name, ...app.tags].filter(Boolean).join(' ').toLowerCase()

      return haystack.includes(search)
    })
  }, [apps, categoryId, networkId, query])

  return (
    <>
      <PageTitle name="Apps" />
      <div className={clsx(styles.page, 'animate', 'fade')}>
        <div className={`__container`} data-width="medium">
          <header className={styles.page__header}>
            <label className={clsx(styles.search, 'rounded-full')}>
              <MagnifyingGlassIcon size={18} aria-hidden="true" />
              <input
                type="search"
                className={styles.search__input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search apps"
              />
            </label>

            {/* aria-label because the text span is display:none at narrow widths */}
            <button
              type="button"
              className={clsx(styles.page__list, 'rounded-full')}
              onClick={() => listDialogRef.current?.open()}
              aria-label="List your app"
            >
              <PlusIcon size={16} aria-hidden="true" />
              <span>List your app</span>
            </button>
          </header>
        </div>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          <BuildSection />

          <div className={styles.filterbar}>
            <nav className={styles.filters} aria-label="App categories">
              <button
                type="button"
                className={clsx(styles.filters__chip, categoryId === 'all' && styles['filters__chip--active'])}
                onClick={() => setCategoryId('all')}
              >
                <SquaresFourIcon size={14} aria-hidden="true" />
                <span>All</span>
                <small>{total}</small>
              </button>

              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={clsx(styles.filters__chip, categoryId === category.id && styles['filters__chip--active'])}
                  onClick={() => setCategoryId(category.id)}
                >
                  <span>{category.name}</span>
                  <small>{category.app_count}</small>
                </button>
              ))}
            </nav>

            {networks.length > 0 && (
              <nav className={styles.filters} aria-label="App networks">
                <button
                  type="button"
                  className={clsx(styles.filters__chip, networkId === 'all' && styles['filters__chip--active'])}
                  onClick={() => setNetworkId('all')}
                >
                  <GlobeIcon size={14} aria-hidden="true" />
                  <span>All networks</span>
                </button>

                {networks.map((network) => (
                  <button
                    key={network.id}
                    type="button"
                    className={clsx(styles.filters__chip, networkId === network.id && styles['filters__chip--active'])}
                    onClick={() => setNetworkId(network.id)}
                  >
                    <span>{network.name}</span>
                    <small>{network.app_count}</small>
                  </button>
                ))}
              </nav>
            )}

            {canModerate && (
              <nav className={styles.filters} aria-label="Moderation">
                <button
                  type="button"
                  className={clsx(styles.filters__chip, showHidden && styles['filters__chip--active'])}
                  onClick={() => setShowHidden((value) => !value)}
                  title="Show listings you have hidden, so they can be restored"
                >
                  <EyeSlashIcon size={14} aria-hidden="true" />
                  <span>Hidden</span>
                </button>
              </nav>
            )}
          </div>

          {error ? (
            <div className={styles.state}>
              <p>{error.message}</p>
            </div>
          ) : isLoading ? (
            <AppsSkeleton />
          ) : filteredApps.length === 0 ? (
            <div className={styles.state}>
              <p>No apps found{query ? ` for "${query}"` : ''}.</p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {filteredApps.map((app) => (
                <AppCard key={app.id} app={app} onChanged={() => mutate()} onEdit={setEditingApp} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ListAppDialog ref={listDialogRef} categories={categories} onListed={() => mutate()} />

      {/* key remounts the dialog per listing — the form prefills in state initializers, which
          would otherwise keep the first-opened app's values forever */}
      {editingApp && (
        <ListAppDialog
          key={`${editingApp.network.id}-${editingApp.appId}`}
          ref={editDialogRef}
          categories={categories}
          app={editingApp}
          onListed={() => {
            setEditingApp(null)
            mutate()
          }}
        />
      )}
    </>
  )
}

/**
 * Developer on-ramp aimed at agent-assisted building: the copy button hands an AI agent one
 * self-contained instruction, and /miniapp-skill.md carries everything it needs from there.
 */
function BuildSection() {
  // Which copy button just fired — the rows share one timer so labels can't stick
  const [copiedKey, setCopiedKey] = useState(null)
  // Resolved after mount so dev copies a localhost URL while SSR markup stays origin-neutral
  const [origin, setOrigin] = useState('https://hup.social')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const prompt = `Read ${origin}/miniapp-skill.md and build a Hup mini app`
  const clawInstall = 'openclaw skills install hup-miniapp-skill'

  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      /* clipboard denied — the text stays selectable */
    }
  }

  return (
    <section className={styles.build} aria-label="Build a mini app">
      <div className={styles.build__intro}>
        <h2>
          <CodeIcon size={16} aria-hidden="true" />
          Build a mini app
        </h2>
        <p>
          Mini apps run inside posts and use the viewer&apos;s Hup wallet — mint, play, trade without leaving the feed. Building one is a single
          HTML page plus the SDK. Vibe coding? Paste this into your agent:
        </p>
      </div>

      <div className={styles.build__prompt}>
        <code>{prompt}</code>
        <button type="button" onClick={() => copyText('prompt', prompt)} className={styles.build__copy} aria-label="Copy the build instruction">
          {copiedKey === 'prompt' ? <CheckIcon size={14} aria-hidden="true" /> : <CopyIcon size={14} aria-hidden="true" />}
          <span>{copiedKey === 'prompt' ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <div className={styles.build__prompt}>
        <code>
          {/* Running an OpenClaw agent? One install teaches it this skill permanently */}
          {clawInstall}
        </code>
        <a
          className={styles.build__clawLink}
          href="https://clawhub.ai/web3senior/skills/hup-miniapp-skill"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View the skill on ClawHub"
        >
          ClawHub
        </a>
        <button type="button" onClick={() => copyText('claw', clawInstall)} className={styles.build__copy} aria-label="Copy the OpenClaw install command">
          {copiedKey === 'claw' ? <CheckIcon size={14} aria-hidden="true" /> : <CopyIcon size={14} aria-hidden="true" />}
          <span>{copiedKey === 'claw' ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <div className={styles.build__links}>
        <a className={styles.build__link} href="/miniapp-skill.md" target="_blank" rel="noopener noreferrer">
          <BookOpenTextIcon size={20} aria-hidden="true" className={styles.build__linkIcon} />
          <span className={styles.build__linkText}>
            <strong>Read the docs</strong>
            <small>Build, test &amp; list your app</small>
          </span>
          <CaretRightIcon size={16} aria-hidden="true" className={styles.build__linkCaret} />
        </a>

        <a className={styles.build__link} href="/miniapp-sdk.js" target="_blank" rel="noopener noreferrer">
          <FileJsIcon size={20} aria-hidden="true" className={styles.build__linkIcon} />
          <span className={styles.build__linkText}>
            <strong>SDK source</strong>
            <small>miniapp-sdk.js — the wallet bridge</small>
          </span>
          <CaretRightIcon size={16} aria-hidden="true" className={styles.build__linkCaret} />
        </a>
      </div>
    </section>
  )
}

function AppCard({ app, onChanged, onEdit }) {
  const { address } = useConnection()
  // Ownership comes from the indexed onchain owner; the contract re-checks it on updateApp
  // anyway, so a stale row can only show a button that reverts, never a working exploit
  const isOwner = Boolean(app.source === 'onchain' && address && app.owner && app.owner.toLowerCase() === address.toLowerCase())

  return (
    <li className={styles.card}>
      <div className={styles.card__header}>
        <AppLogo name={app.name} logo={app.logo} />

        <div className={styles.card__title}>
          <h3>
            {app.name}
            {app.featured && <StarIcon size={13} weight="fill" className={styles.card__featured} aria-label="Featured" />}
          </h3>
          <div className={styles.card__badges}>
            <span className={styles.card__category}>{app.category.name}</span>
            {app.network.name && <span className={styles.card__network}>{app.network.name}</span>}
            {app.source === 'onchain' && (
              <span className={styles.card__registered} title="Registered onchain in the Hup apps registry">
                <SealCheckIcon size={11} weight="fill" aria-hidden="true" />
                <span>Registered</span>
              </span>
            )}
            {app.embeddable && (
              <span className={styles.card__embeddable} title="Reviewed — this app can run inside a post">
                <PuzzlePieceIcon size={11} weight="fill" aria-hidden="true" />
                <span>Embeddable</span>
              </span>
            )}
            {app.hidden && (
              <span className={styles.card__hidden} title="Hidden from the directory — only moderators see this">
                <EyeSlashIcon size={11} aria-hidden="true" />
                <span>Hidden</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {app.description && <p className={styles.card__description}>{app.description}</p>}

      {app.tags.length > 0 && (
        <div className={styles.card__tags}>
          {app.tags.slice(0, 5).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}

      <div className={styles.card__footer}>
        {app.url && (
          <a className={clsx(styles.card__visit, 'rounded-full')} href={app.url} target="_blank" rel="noopener noreferrer">
            <span>Open</span>
          </a>
        )}

        {isOwner && (
          <button
            type="button"
            className={clsx(styles.card__edit, 'rounded-full')}
            onClick={() => onEdit(app)}
            title="Edit your listing — saving pauses embedding until re-review"
          >
            <PencilSimpleIcon size={13} aria-hidden="true" />
            <span>Edit</span>
          </button>
        )}
      </div>

      {app.source === 'onchain' && <AppModerationBar app={app} onChanged={onChanged} />}
    </li>
  )
}

function AppLogo({ name, logo }) {
  const [failed, setFailed] = useState(false)

  if (!logo || failed) {
    return (
      <span className={styles.card__logoFallback} aria-hidden="true">
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return <img className={styles.card__logo} src={logo} alt={`${name} logo`} loading="lazy" onError={() => setFailed(true)} />
}

function AppsSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading apps">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className={styles.skeleton__card}>
          <span />
          <div />
          <p />
        </div>
      ))}
    </div>
  )
}
