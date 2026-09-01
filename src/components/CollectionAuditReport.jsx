'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  MinusIcon,
  QuestionIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { networkColorStyle } from '@/lib/networkColors'
import { resolveIPFSUrl } from '@/lib/storageHelper'
import {
  AUDIT_CATEGORIES,
  AUDIT_WEIGHTS,
  describeBadge,
  describeStorageClass,
  formatRelativeTime,
  gradeColor,
  HASH_LABELS,
  KIND_LABELS,
  ROLE_LABELS,
  shortenReference,
} from '@/lib/collectionAuditFormat'
import Profile from '@/components/Profile'
import DetailSection from '@/components/ui/DetailSection'
import ProgressBar from '@/components/ui/ProgressBar'
import Sparkline from '@/components/ui/Sparkline'
import styles from './CollectionAuditReport.module.scss'

const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 })
const COUNT = new Intl.NumberFormat()
const HISTORY_ROWS = 5
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null)

// What a hop's "where" cell says beneath the class: the CID for IPFS, the host otherwise
const referenceOf = (hop) => {
  if (!hop) return null
  if (hop.cls === 'onchain') return 'inline data'
  if (hop.cls === 'ipfs' || hop.cls === 'ipfs-gateway') return shortenReference(hop.root || hop.cid, 8)
  if (hop.cls === 'none') return null
  return hop.host || shortenReference(hop.url || hop.uri, 14)
}

// Where "open" goes: the file as the collection points at it, or — for a bare CID — the gateway
// that actually served it during the audit, falling back to the app's own. Inline data has
// nowhere to go.
const openUrlOf = (hop) => {
  if (!hop || hop.cls === 'onchain' || hop.cls === 'none') return null
  if (hop.cls === 'ipfs') {
    if (hop.via) return `https://${hop.via}/ipfs/${hop.cid}`
    return resolveIPFSUrl(`ipfs://${hop.cid}`)
  }
  return hop.url || hop.uri || null
}

const sourceLabel = { token: 'own pointer', base: 'base URI', collection: 'collection document' }

/**
 * Every probed hop as one table row, grouped by what it belongs to: the collection's own
 * document and images first, then each sampled token's document and files.
 */
const hopRowsOf = (report) => {
  const rows = []
  const push = (group, role, hop, note) => {
    if (!hop) return
    rows.push({ key: `${group}:${role}:${rows.length}`, group, role, hop, note })
  }
  push('Collection', 'doc', report.collectionDoc)
  for (const asset of report.collectionAssets || []) push('Collection', asset.role, asset)
  for (const token of report.tokens || []) {
    const group = `Token ${token.display}`
    push(group, 'doc', token.doc, sourceLabel[token.source] || null)
    for (const asset of token.assets || []) push(group, asset.role, asset)
  }
  return rows
}

function Reachable({ hop }) {
  if (hop.cls === 'none') {
    return (
      <span className={clsx(styles.audit__verdict, styles['audit__verdict--bad'])}>
        <XCircleIcon size={14} weight="fill" /> missing
      </span>
    )
  }
  if (hop.reachable === true) {
    return (
      <span className={clsx(styles.audit__verdict, styles['audit__verdict--good'])} title={hop.via ? `Served by ${hop.via}` : undefined}>
        <CheckCircleIcon size={14} weight="fill" />
        {hop.cls === 'onchain' ? 'onchain' : hop.via ? `via ${hop.via}` : 'yes'}
        {hop.onlyOriginHost && <small>only the minting host</small>}
      </span>
    )
  }
  if (hop.reachable === false) {
    return (
      <span className={clsx(styles.audit__verdict, styles['audit__verdict--bad'])} title={hop.error || (hop.gateways ? `${hop.gateways.failed.length} gateways failed` : undefined)}>
        <XCircleIcon size={14} weight="fill" /> unreachable
      </span>
    )
  }
  return (
    <span className={clsx(styles.audit__verdict, styles['audit__verdict--muted'])} title={hop.error || 'Not probed'}>
      <MinusIcon size={14} /> not probed
    </span>
  )
}

function Providers({ hop }) {
  if (hop.cls !== 'ipfs' && hop.cls !== 'ipfs-gateway') return <span className={styles['audit__verdict--muted']}>—</span>
  if (hop.providers === null || hop.providers === undefined) {
    return (
      <span className={clsx(styles.audit__verdict, styles['audit__verdict--muted'])} title="No routing service answered">
        <QuestionIcon size={14} /> unknown
      </span>
    )
  }
  if (hop.providers === 0) {
    return (
      <span className={clsx(styles.audit__verdict, styles['audit__verdict--warn'])} title={`No node advertises this CID (${hop.providerSource})`}>
        <WarningCircleIcon size={14} weight="fill" /> none
      </span>
    )
  }
  return (
    <span className={styles.audit__verdict} title={`${COUNT.format(hop.providers)} providers advertise this CID (${hop.providerSource})`}>
      {COUNT.format(hop.providers)}
    </span>
  )
}

function Hash({ hop }) {
  const entry = HASH_LABELS[hop.hash] || HASH_LABELS.none
  if (hop.hash === 'n/a') return <span className={styles['audit__verdict--muted']}>—</span>
  return (
    <span className={clsx(styles.audit__verdict, styles[`audit__verdict--${entry.tone}`])}>
      {hop.hash === 'pass' && <CheckCircleIcon size={14} weight="fill" />}
      {hop.hash === 'fail' && <XCircleIcon size={14} weight="fill" />}
      {entry.label}
    </span>
  )
}

// Seconds since a timestamp, ticking once a second — the one clock on the page that has to move
const useElapsedSeconds = (since) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  if (!since) return null
  const started = Date.parse(since)
  return Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : null
}

// Waiting longer than this with nothing running means no worker is draining the queue
const STALLED_AFTER_SECONDS = 3 * 60

/**
 * What the queue is doing with this collection right now: the engine's stage and a running
 * clock while a worker has it, its place in the line while it waits.
 */
function PendingState({ audit, status }) {
  const running = status === 'running' || status === 'refreshing'
  const elapsed = useElapsedSeconds(running ? audit?.startedAt : audit?.requestedAt)
  const ahead = audit?.queueAhead ?? null

  if (running) {
    return (
      <>
        <strong>Auditing now</strong>
        <p className={styles.audit__stage}>
          {audit?.progress || 'Starting'}
          {elapsed !== null && <span className={styles.audit__elapsed}>{elapsed}s</span>}
        </p>
        <ProgressBar indeterminate height={4} decorative className={styles.audit__pendingBar} />
        <small className={styles.audit__pendingNote}>Every gateway, every hash, the routing table and the explorer — a collection whose bytes are gone takes the longest to prove.</small>
      </>
    )
  }

  return (
    <>
      <strong>Queued</strong>
      <p className={styles.audit__stage}>
        {ahead > 0 ? `${COUNT.format(ahead)} ${ahead === 1 ? 'collection' : 'collections'} ahead of this one` : 'Next up — starts as soon as a worker is free'}
        {elapsed !== null && <span className={styles.audit__elapsed}>{elapsed}s</span>}
      </p>
      <ProgressBar indeterminate height={4} decorative className={styles.audit__pendingBar} />
      {elapsed > STALLED_AFTER_SECONDS && <small className={styles.audit__pendingNote}>Taking longer than usual — the indexer that runs audits may be paused.</small>}
    </>
  )
}

/**
 * Collection Audit Report
 * One collection's permanence audit, as cidex scored it: the grade and score, the badges that
 * carry the verdict, the four category bars, then every probe behind them — each hop's storage
 * class, reachability, provider count and hash check; the contract's verification, proxy,
 * owner, setters and creators; the score's history.
 *
 * Renders every queue state too: nothing yet (with a way to ask), pending (cidex is probing),
 * failed (with the reason and a retry), and done — or refreshing behind the report it has.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {Object} [props.chainInfo] Entry from appChains, for the chain's colours and name.
 * @param {string} props.collection Collection contract address.
 * @param {Object|null} props.audit Row from useCollectionAudit (full, with report and history).
 * @param {string} props.status Queue state from useCollectionAudit.
 * @param {Function} props.onRequest Asks for a (re-)audit.
 * @param {boolean} props.isRequesting Whether that request is in flight.
 * @param {Error|null} [props.requestError] The last request's failure, e.g. the cooldown.
 * @param {boolean} [props.showCollectionLink=true] Link through to the collection page.
 */
export default function CollectionAuditReport({ chainId, chainInfo, collection, audit, status, onRequest, isRequesting, requestError, showCollectionLink = true }) {
  const report = audit?.report || null
  const isPending = status === 'pending' || status === 'running' || status === 'refreshing'
  const color = gradeColor(audit?.grade)
  const style = { ...networkColorStyle(chainInfo), '--audit-color': color }

  if (status === 'loading') {
    return <div className={clsx(styles.audit, styles['audit--skeleton'])} style={style} aria-busy="true" />
  }

  if (!report) {
    return (
      <div className={clsx(styles.audit, styles['audit--empty'])} style={style}>
        <ShieldCheckIcon size={28} className={styles.audit__emptyMark} aria-hidden="true" />
        {isPending ? (
          <PendingState audit={audit} status={status} />
        ) : status === 'failed' ? (
          <>
            <strong>The audit could not run</strong>
            <p>{audit?.error || 'The collection did not answer as a contract on this network.'}</p>
            <button type="button" className={styles.audit__button} onClick={onRequest} disabled={isRequesting}>
              <ArrowsClockwiseIcon size={14} className={clsx(isRequesting && styles['audit__spin'])} /> Try again
            </button>
          </>
        ) : (
          <>
            <strong>No audit yet</strong>
            <p>Ask for one and cidex will score where this collection&apos;s bytes live, whether they can still be fetched, and what the contract can change.</p>
            <button type="button" className={styles.audit__button} onClick={onRequest} disabled={isRequesting}>
              <ShieldCheckIcon size={14} weight="fill" /> Audit this collection
            </button>
          </>
        )}
        {requestError && <small className={styles.audit__requestError}>{requestError.message}</small>}
      </div>
    )
  }

  const { contract } = report
  const hopRows = hopRowsOf(report)
  const history = Array.isArray(audit.history) ? audit.history : []
  const historyValues = history.map((entry) => Number(entry.score)).filter(Number.isFinite)
  const kindLabel = KIND_LABELS[contract.kind] || KIND_LABELS.unknown
  const explorerAddress = audit.explorerUrl ? `${String(audit.explorerUrl).replace(/\/$/, '')}/address/${collection}` : null
  const isLsp = contract.kind === 'lsp8' || contract.kind === 'lsp7'

  const metadataNote = !contract.mutable
    ? 'Immutable — no owner and no setter can move the pointers'
    : contract.isProxy
      ? 'A proxy: the implementation, and with it every pointer, can be replaced'
      : isLsp
        ? 'The owner can rewrite every pointer through setData (ERC725Y)'
        : `The owner can rewrite pointers through ${contract.setters.join(', ')}`

  return (
    <article className={styles.audit} style={style} aria-label="Collection permanence audit">
      <header className={styles.audit__hero}>
        <span className={styles.audit__grade} aria-label={`Grade ${audit.grade}`}>
          {audit.grade}
        </span>
        <div className={styles.audit__headline}>
          <div className={styles.audit__scoreRow}>
            <strong className={styles.audit__score}>
              {audit.score}
              <small>/100</small>
            </strong>
            <span className={styles.audit__title}>Permanence score</span>
            {status === 'refreshing' && (
              <span className={styles.audit__refreshing}>
                <ArrowsClockwiseIcon size={12} className={styles.audit__spin} /> {audit.startedAt ? audit.progress || 're-auditing' : audit.queueAhead > 0 ? `queued, ${COUNT.format(audit.queueAhead)} ahead` : 're-audit queued'}
              </span>
            )}
          </div>
          <p className={styles.audit__summary}>{report.summary}</p>
          <div className={styles.audit__meta}>
            <span title={audit.auditedAt ? new Date(audit.auditedAt).toLocaleString() : undefined}>Audited {formatRelativeTime(audit.auditedAt) || 'just now'}</span>
            <span>{kindLabel}</span>
            <span>
              {COUNT.format(report.sampled.tokens)} {report.sampled.tokens === 1 ? 'token' : 'tokens'} · {COUNT.format(report.sampled.assets)} files probed
            </span>
            {showCollectionLink && (
              <Link href={`/nfts/${chainId}/collection/${collection}`} className={styles.audit__metaLink}>
                {contract.name || 'Open collection'}
              </Link>
            )}
            {explorerAddress && (
              <a href={explorerAddress} target="_blank" rel="noopener noreferrer" className={styles.audit__metaLink}>
                Explorer <ArrowSquareOutIcon size={11} />
              </a>
            )}
          </div>
        </div>
        <div className={styles.audit__actions}>
          <button type="button" className={styles.audit__button} onClick={onRequest} disabled={isRequesting || isPending} title="Ask cidex to probe this collection again">
            <ArrowsClockwiseIcon size={14} className={clsx((isRequesting || isPending) && styles.audit__spin)} />
            {isPending ? 'Auditing…' : 'Re-check'}
          </button>
          {requestError && <small className={styles.audit__requestError}>{requestError.message}</small>}
        </div>
      </header>

      <div className={styles.audit__badges}>
        {audit.badges.map((id) => {
          const badge = describeBadge(id)
          return (
            <span key={id} className={clsx(styles.audit__badge, styles[`audit__badge--${badge.tone}`])} title={badge.hint || undefined}>
              {badge.label}
            </span>
          )
        })}
      </div>

      <div className={styles.audit__categories}>
        {AUDIT_CATEGORIES.map((category) => {
          const value = audit.categories?.[category.key] ?? 0
          return (
            <div key={category.key} className={styles.audit__category} title={category.hint}>
              <ProgressBar
                percent={value}
                color={gradeColor(value >= 85 ? 'A' : value >= 70 ? 'B' : value >= 55 ? 'C' : value >= 40 ? 'D' : 'F')}
                height={6}
                label={
                  <span className={styles.audit__categoryLabel}>
                    {category.label}
                    <small>{PERCENT.format(AUDIT_WEIGHTS[category.key])} of the score</small>
                  </span>
                }
                hint={<span className={styles.audit__categoryValue}>{value}</span>}
                ariaLabel={category.label}
              />
            </div>
          )
        })}
      </div>

      <div className={styles.audit__sections}>
        <DetailSection title="Where the bytes live" count={hopRows.length} defaultOpen>
          {hopRows.length === 0 ? (
            <p className={styles.audit__note}>No metadata pointer could be followed for this collection.</p>
          ) : (
            <div className={styles.audit__tableWrap}>
              <table className={styles.audit__table}>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Where</th>
                    <th scope="col">Reachable</th>
                    <th scope="col">Providers</th>
                    <th scope="col">Hash</th>
                    <th scope="col">
                      <span className={styles.audit__srOnly}>Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hopRows.map((row, index) => {
                    const storage = describeStorageClass(row.hop.cls)
                    const openUrl = openUrlOf(row.hop)
                    const firstOfGroup = index === 0 || hopRows[index - 1].group !== row.group
                    return (
                      <tr key={row.key} className={clsx(firstOfGroup && styles['audit__row--group'])}>
                        <td data-label="Item">
                          <span className={styles.audit__item}>
                            {firstOfGroup && <strong>{row.group}</strong>}
                            <small>
                              {ROLE_LABELS[row.role] || row.role}
                              {row.note ? ` · ${row.note}` : ''}
                              {row.hop.duplicate ? ' · same file' : ''}
                            </small>
                          </span>
                        </td>
                        <td data-label="Where">
                          <span className={styles.audit__where}>
                            <span className={clsx(styles.audit__class, styles[`audit__class--${storage.tone}`])}>{storage.label}</span>
                            {referenceOf(row.hop) && <small title={row.hop.url || row.hop.uri}>{referenceOf(row.hop)}</small>}
                          </span>
                        </td>
                        <td data-label="Reachable">
                          <Reachable hop={row.hop} />
                        </td>
                        <td data-label="Providers">
                          <Providers hop={row.hop} />
                        </td>
                        <td data-label="Hash">
                          <Hash hop={row.hop} />
                        </td>
                        <td data-label="Open">
                          {openUrl ? (
                            <a
                              href={openUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.audit__open}
                              aria-label={`Open the ${(ROLE_LABELS[row.role] || row.role).toLowerCase()} in a new tab`}
                              title={openUrl}
                            >
                              <ArrowSquareOutIcon size={14} weight="bold" />
                            </a>
                          ) : (
                            <span className={styles['audit__verdict--muted']}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {report.sampled.tokens === 0 && contract.kind !== 'lsp7' && (
            <p className={styles.audit__note}>No token could be sampled — the ids are not guessable and none has been listed here — so the score speaks for the collection document only.</p>
          )}
          {report.pointers?.baseUri && (
            <p className={styles.audit__note}>
              Tokens hang off a shared base URI on <strong>{referenceOf(report.pointers.baseUri) || describeStorageClass(report.pointers.baseUri.cls).label}</strong>: every token goes wherever that pointer goes.
            </p>
          )}
        </DetailSection>

        <DetailSection title="Contract" defaultOpen>
          <dl className={styles.audit__facts}>
            <div>
              <dt>Standard</dt>
              <dd>
                {kindLabel}
                {contract.name ? ` · ${contract.name}` : ''}
                {contract.symbol ? ` (${contract.symbol})` : ''}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {contract.verification.verified === true && (
                  <span className={clsx(styles.audit__verdict, styles['audit__verdict--good'])}>
                    <CheckCircleIcon size={14} weight="fill" />
                    Verified{contract.verification.name ? ` · ${contract.verification.name}` : ''}
                    {contract.verification.url && (
                      <a href={contract.verification.url} target="_blank" rel="noopener noreferrer" className={styles.audit__inlineLink}>
                        {contract.verification.verifier} <ArrowSquareOutIcon size={11} />
                      </a>
                    )}
                  </span>
                )}
                {contract.verification.verified === false && (
                  <span className={clsx(styles.audit__verdict, styles['audit__verdict--warn'])}>
                    <WarningCircleIcon size={14} weight="fill" /> Not verified ({contract.verification.verifier})
                  </span>
                )}
                {contract.verification.verified === null && (
                  <span className={clsx(styles.audit__verdict, styles['audit__verdict--muted'])} title="No explorer answered for this chain; scored as neutral">
                    <QuestionIcon size={14} /> Unknown — no explorer answered
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Upgradeable</dt>
              <dd>
                {contract.isProxy ? (
                  <span className={clsx(styles.audit__verdict, styles['audit__verdict--warn'])} title={contract.implementation ? `Implementation ${contract.implementation}` : 'Minimal proxy'}>
                    <WarningCircleIcon size={14} weight="fill" /> Proxy{contract.implementation ? ` → ${shortAddress(contract.implementation)}` : ''}
                  </span>
                ) : (
                  <span className={clsx(styles.audit__verdict, styles['audit__verdict--good'])}>
                    <CheckCircleIcon size={14} weight="fill" /> No proxy
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                {contract.renounced ? 'Renounced' : contract.owner ? <span title={contract.owner}>{shortAddress(contract.owner)}</span> : 'None exposed'}
              </dd>
            </div>
            <div className={styles['audit__fact--wide']}>
              <dt>Metadata</dt>
              <dd>{metadataNote}</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{contract.totalSupply ? COUNT.format(BigInt(contract.totalSupply)) : '—'}</dd>
            </div>
            <div>
              <dt>Code size</dt>
              <dd>{COUNT.format(contract.codeSize)} bytes</dd>
            </div>
          </dl>

          {isLsp && (
            <div className={styles.audit__creators}>
              <small>Creators</small>
              {contract.creators.length === 0 ? (
                <span className={styles.audit__note}>None declared in LSP4Creators[].</span>
              ) : (
                contract.creators.map((creator) => (
                  <div key={creator.address} className={styles.audit__creator}>
                    <Profile variant="fullWithoutTime" creator={creator.address} networkId={chainId} />
                    {creator.linked ? (
                      <span className={clsx(styles.audit__verdict, styles['audit__verdict--good'])} title="This profile lists the collection under LSP12IssuedAssets">
                        <CheckCircleIcon size={14} weight="fill" /> claims it back
                      </span>
                    ) : (
                      <span className={clsx(styles.audit__verdict, styles['audit__verdict--warn'])} title="This profile does not list the collection under LSP12IssuedAssets">
                        <WarningCircleIcon size={14} weight="fill" /> does not claim it
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </DetailSection>

        {historyValues.length > 1 && (
          <DetailSection title="Score over time" count={historyValues.length} aside={<Sparkline values={historyValues} from={color} className={styles.audit__sparkline} />}>
            <ul className={styles.audit__history}>
              {history
                .slice(-HISTORY_ROWS)
                .reverse()
                .map((entry) => (
                  <li key={entry.at}>
                    <span>{DATE.format(new Date(entry.at))}</span>
                    <strong>{entry.score}</strong>
                  </li>
                ))}
            </ul>
          </DetailSection>
        )}

        <DetailSection title="How the score is built">
          <div className={styles.audit__method}>
            <p>
              Every pointer is followed to a hop and classed by where its bytes live: inline data (100), Arweave (90), IPFS (80, more with every node that advertises the CID, less when none does), a plain web server (25), unreachable (0). Token documents and artwork weigh three times a collection icon or banner.
            </p>
            <p>
              Availability is the share of probed hops that answered. Integrity hashes the bytes that came back against the digest committed onchain — an LSP2 VerifiableURI on the pointer, or the verification block on each LSP4 file. Contract trust starts neutral and moves with verified source, proxy, renounced ownership and, on LUKSO, whether the named creators&apos; profiles list the collection back.
            </p>
            <p>Unknown is never a defect: an explorer that does not answer, or a routing service that is down, scores as neutral.</p>
          </div>
        </DetailSection>
      </div>
    </article>
  )
}
