'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { MagnifyingGlassIcon, PuzzlePieceIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachMiniAppDialog.module.scss'

const fetcher = async (url) => {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || 'Apps failed to load')
  return json
}

/**
 * Picker for attaching a registered mini app to a post.
 *
 * Only apps a moderator has marked embeddable are offered. The composer stores a thin reference
 * ({ appId, chainId }) rather than a URL, matching how nftListing and predictMarket work — so a
 * later revocation takes effect everywhere at once instead of being frozen into every post that
 * ever embedded the app.
 */
const AttachMiniAppDialog = forwardRef(function AttachMiniAppDialog({ onAttached }, ref) {
  const dialogRef = useRef(null)
  const [query, setQuery] = useState('')

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const { data, error, isLoading } = useSWR('/api/v1/apps', fetcher)

  const embeddableApps = useMemo(() => {
    const all = data?.data || []
    const search = query.trim().toLowerCase()
    return all
      .filter((app) => app.embeddable && app.source === 'onchain' && app.appId)
      .filter((app) => !search || [app.name, app.description, app.category?.name].filter(Boolean).join(' ').toLowerCase().includes(search))
  }, [data, query])

  const attach = (app) => {
    onAttached?.({ appId: app.appId, chainId: app.network.id })
    dialogRef.current?.close()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachDialog}
      aria-label="Attach a mini app"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <div className={styles.attachDialog__body}>
        <header className={styles.attachDialog__header}>
          <h3>Add a mini app</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.attachDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <label className={styles.attachDialog__search}>
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps" aria-label="Search mini apps" />
        </label>

        {error ? (
          <p className={styles.attachDialog__state}>{error.message}</p>
        ) : isLoading ? (
          <p className={styles.attachDialog__state}>Loading apps...</p>
        ) : embeddableApps.length === 0 ? (
          <p className={styles.attachDialog__state}>
            {query ? `No mini apps match "${query}".` : 'No apps are approved for embedding yet. Apps are reviewed before they can run inside posts.'}
          </p>
        ) : (
          <ul className={styles.attachDialog__list}>
            {embeddableApps.map((app) => (
              <li key={`${app.network.id}-${app.appId}`}>
                <button type="button" className={styles.attachDialog__item} onClick={() => attach(app)}>
                  {app.logo ? (
                    <img className={styles.attachDialog__logo} src={app.logo} alt="" loading="lazy" />
                  ) : (
                    <span className={clsx(styles.attachDialog__logo, styles.attachDialog__logoFallback)} aria-hidden="true">
                      <PuzzlePieceIcon size={16} weight="fill" />
                    </span>
                  )}
                  <span className={styles.attachDialog__meta}>
                    <strong>{app.name}</strong>
                    <small>{app.description || app.category?.name}</small>
                  </span>
                  <span className={styles.attachDialog__network}>{app.network.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NativeDialog>
  )
})

export default AttachMiniAppDialog
