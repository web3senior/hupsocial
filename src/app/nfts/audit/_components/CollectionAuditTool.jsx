'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { isAddress } from 'viem'
import clsx from 'clsx'
import useSWR from 'swr'
import { CaretDownIcon, CheckIcon, CopyIcon, HashIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import { getNftCollectionAudits } from '@/lib/api'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { networkColorStyle } from '@/lib/networkColors'
import { handleBrokenImage } from '@/lib/utils'
import { describeBadge, formatRelativeTime, gradeColor, KIND_LABELS } from '@/lib/collectionAuditFormat'
import useCollectionAudit from '@/hooks/useCollectionAudit'
import useContractChains from '@/hooks/useContractChains'
import useTokenInspection from '@/hooks/useTokenInspection'
import CollectionAuditReport from '@/components/CollectionAuditReport'
import TokenInspection from '@/components/TokenInspection'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/NextToast'
import NativePopover from '@/components/ui/NativePopover'
import SegmentedControl from '@/components/ui/SegmentedControl'
import styles from './CollectionAuditTool.module.scss'

// LUKSO first: it is where collections have actually gone missing, and where the audit has
// the most to say (VerifiableURI hashes, creator linkback)
const DEFAULT_CHAIN_ID = 42
const BOARD_LIMIT = 20
const BOARD_BADGES = 3
// A whole number, or a bytes32 hex value for LSP8
const TOKEN_ID_PATTERN = /^(\d{1,78}|0x[0-9a-fA-F]{1,64})$/

const BOARD_SORTS = [
  { value: 'recent', label: 'Recent' },
  { value: 'top', label: 'Best' },
  { value: 'bottom', label: 'Worst' },
]

const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Collection audit tool.
 *
 * Paste any NFT contract and get its permanence score: where every pointer resolves, whether
 * the bytes can still be fetched and still match the chain, who pins them, and what the
 * contract can change. The probing runs in cidex; this page asks for it and reads the answer.
 * The target rides in the query string (`?network=42&address=0x…`) so a report can be linked.
 */
export default function CollectionAuditTool() {
  const searchParams = useSearchParams()

  const paramChain = Number(searchParams.get('network'))
  const paramAddress = searchParams.get('address') || ''
  const paramTokenId = searchParams.get('tokenId') || ''
  const [chainId, setChainId] = useState(() => (appChains.some((chain) => chain.id === paramChain) ? paramChain : DEFAULT_CHAIN_ID))
  const [input, setInput] = useState(() => (isAddress(paramAddress) ? paramAddress : ''))
  // The one token decoded under the report, when the reader asks for one
  const [tokenInput, setTokenInput] = useState(() => (TOKEN_ID_PATTERN.test(paramTokenId) ? paramTokenId : ''))
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [boardSort, setBoardSort] = useState('recent')
  // Which row's link was just copied, for the tick that replaces its icon for a moment
  const [copiedKey, setCopiedKey] = useState(null)

  const target = useMemo(() => (isAddress(input.trim()) ? input.trim().toLowerCase() : null), [input])
  const tokenId = useMemo(() => (TOKEN_ID_PATTERN.test(tokenInput.trim()) ? tokenInput.trim() : null), [tokenInput])
  const chain = appChains.find((candidate) => candidate.id === chainId)
  const chainIcon = chainIconFor(chain)

  // Keep the URL in step with what is on screen, quietly — no history entry per keystroke, and
  // through the History API rather than the router: a changed query string is a new page segment
  // to the router, which would fetch it, flash the loading boundary and remount this tool
  useEffect(() => {
    const query = new URLSearchParams()
    if (target) {
      query.set('network', String(chainId))
      query.set('address', target)
      if (tokenId) query.set('tokenId', tokenId)
    }
    const next = query.toString()
    if (next !== searchParams.toString()) window.history.replaceState(null, '', next ? `/nfts/audit?${next}` : '/nfts/audit')
  }, [chainId, target, tokenId, searchParams])

  // Suggestions come from collections the market has already read — a convenience, never a
  // gate: any pasted address works whether or not it was ever listed here
  const query = input.trim()
  const { data: suggestions } = useSWR(
    query.length >= 2 && !isAddress(query) ? `/api/v1/nfts/collections/search?q=${encodeURIComponent(query)}&networkId=${chainId}` : null,
    fetcher,
  )
  const matches = suggestions?.data ?? []

  // Looked for before anything is queued: an address on the wrong network used to sit in the
  // queue as "starts as soon as a worker is free", which was never going to be true
  const presence = useContractChains({ address: target, chainId, enabled: Boolean(target) })
  const audit = useCollectionAudit({ chainId, collection: target, enabled: Boolean(target) && presence.hasCode === true, autoRequest: true })
  // Independent of the audit queue: a token decodes on demand, whether or not the report has landed
  const inspection = useTokenInspection({ chainId, collection: target, tokenId, enabled: Boolean(target) && Boolean(tokenId) && presence.hasCode === true })
  const sampledTokens = audit.audit?.report?.tokens ?? []
  const auditKind = audit.audit?.kind || audit.audit?.report?.contract?.kind || null

  // The Inspect pills in the report fill the field below and bring it into view
  const inspectToken = useCallback((id) => {
    setTokenInput(String(id))
    requestAnimationFrame(() => document.getElementById('audit-inspect')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])
  const foundElsewhere = presence.elsewhere.map((id) => appChains.find((candidate) => candidate.id === id)).filter(Boolean)

  const { data: board, isLoading: isBoardLoading } = useSWR(['nft-collection-audits', boardSort], () => getNftCollectionAudits({ sort: boardSort, limit: BOARD_LIMIT }), {
    revalidateOnFocus: false,
  })
  const boardRows = board?.data ?? []

  // The same URL this page keeps in its own address bar, so a copied link opens the report
  const copyLink = useCallback(async (networkId, address) => {
    const key = `${networkId}:${address}`
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/nfts/audit?network=${networkId}&address=${address}`)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
    } catch {
      toast('Could not copy the link', 'error')
    }
  }, [])

  const pick = useCallback((networkId, address) => {
    setChainId(Number(networkId))
    setInput(address)
    setTokenInput('')
    setShowSuggestions(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  return (
    <div className={styles.tool}>
      <header className={styles.tool__head}>
        <p>
          Will an NFT&rsquo;s picture still be there in ten years? Paste any collection and Hup checks four things: where its files are
          stored, whether they open today, whether they are the originals, and whether anyone can change them. You get a score out of
          100, a grade from A to F, and a short list of what would raise it. Under the report, any single token can be decoded layer by
          layer: what the contract hands back, what its artwork loads from outside, and which contracts render it.
        </p>
      </header>

      <div className={styles.tool__lookup}>
        <NativePopover
          placement="bottom-start"
          className={styles.tool__networkMenu}
          trigger={
            <button type="button" className={styles.tool__network} aria-label={`Network: ${chain?.name ?? ''}`}>
              {chainIcon ? <img src={chainIcon} alt="" /> : null}
              <span>{chain?.name ?? 'Network'}</span>
              <CaretDownIcon size={13} weight="bold" aria-hidden="true" />
            </button>
          }
        >
          {({ close }) => (
            <ul>
              {appChains.map((candidate) => {
                const icon = chainIconFor(candidate)
                const isActive = candidate.id === chainId
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={clsx(isActive && styles['tool__networkOption--active'])}
                      onClick={() => {
                        setChainId(candidate.id)
                        close()
                      }}
                    >
                      {icon ? <img src={icon} alt="" /> : <span aria-hidden="true">{candidate.name.slice(0, 1)}</span>}
                      <span>{candidate.name}</span>
                      {isActive && <CheckIcon size={13} weight="bold" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </NativePopover>

        <div className={styles.tool__search}>
          <span className={styles.tool__field}>
            <MagnifyingGlassIcon size={15} />
            <input
              type="text"
              value={input}
              spellCheck={false}
              placeholder="Search a collection, or paste a contract address"
              onChange={(event) => {
                setInput(event.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              // Delayed so a click on a suggestion lands before the list unmounts
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
          </span>

          {showSuggestions && matches.length > 0 && (
            <ul className={styles.tool__suggestions}>
              {matches.map((row) => (
                <li key={`${row.network_id}:${row.collection}`}>
                  <button type="button" onClick={() => pick(row.network_id, row.collection)}>
                    {row.icon_uri ? (
                      <img src={resolveStorageImageUrl(row.icon_uri, { width: 64, still: true })} alt="" onError={handleBrokenImage} />
                    ) : (
                      <span className={styles.tool__mark} aria-hidden="true">
                        {(row.name || '?').slice(0, 1)}
                      </span>
                    )}
                    <span>
                      <strong>{row.name || 'Untitled collection'}</strong>
                      <small>
                        {row.symbol ? `${row.symbol} · ` : ''}
                        {row.is_lsp8 ? 'LSP8' : 'LSP7'} · {row.collection.slice(0, 6)}…{row.collection.slice(-4)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {input.trim() && !target && <p className={styles.tool__note}>That is not a valid contract address.</p>}

      {target && presence.isChecking && <p className={styles.tool__note}>Checking {chain?.name}…</p>}

      {/* The honest answer, and the fix beside it: the address is usually right and the network wrong */}
      {target && presence.hasCode === false && (
        <div className={styles.tool__wrongChain} role="status">
          <strong>Nothing is deployed at this address on {chain?.name}.</strong>
          {presence.isSearching ? (
            <p>Looking for it on the other networks…</p>
          ) : foundElsewhere.length > 0 ? (
            <>
              <p>It does exist on {foundElsewhere.length === 1 ? 'another network' : 'other networks'} — switch and the audit runs there.</p>
              <div className={styles.tool__wrongChainActions}>
                {foundElsewhere.map((candidate) => {
                  const icon = chainIconFor(candidate)
                  return (
                    <button key={candidate.id} type="button" onClick={() => setChainId(candidate.id)}>
                      {icon ? <img src={icon} alt="" /> : null}
                      Switch to {candidate.name}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <p>It was not found on any network Hup speaks either. Check the address, or the network it was deployed on.</p>
          )}
        </div>
      )}

      {target && presence.hasCode === true && (
        <>
          <CollectionAuditReport
            chainId={chainId}
            chainInfo={chain}
            collection={target}
            audit={audit.audit}
            status={audit.status}
            onRequest={audit.request}
            isRequesting={audit.isRequesting}
            requestError={audit.requestError}
            onInspectToken={inspectToken}
          />

          {/* The audit scores the collection from a sample; this decodes one token all the way down */}
          <section id="audit-inspect" className={styles.tool__inspect} aria-label="Inspect one token">
            <div className={styles.tool__inspectHead}>
              <h2>Inspect one token</h2>
              <p>
                The grade above comes from a sample. Pick or type a token id and this token alone is decoded layer by layer: what the contract hands back, the document behind it,
                the artwork inside that, everything the artwork loads from outside, and which contracts took part in rendering it.
              </p>
            </div>

            <div className={styles.tool__inspectLookup}>
              <span className={clsx(styles.tool__field, styles['tool__field--token'])}>
                <HashIcon size={15} />
                <input
                  type="text"
                  value={tokenInput}
                  spellCheck={false}
                  inputMode="numeric"
                  placeholder={auditKind === 'lsp7' ? 'Any id — an LSP7 edition shares one document' : 'Token id'}
                  aria-label="Token id"
                  onChange={(event) => setTokenInput(event.target.value)}
                />
              </span>
              {(sampledTokens.length > 0 || auditKind === 'lsp7') && (
                <span className={styles.tool__chips} aria-label="Sampled tokens">
                  {auditKind === 'lsp7' && (
                    <button type="button" className={clsx(styles.tool__chip, tokenInput === '0' && styles['tool__chip--active'])} onClick={() => setTokenInput('0')}>
                      Collection document
                    </button>
                  )}
                  {sampledTokens.map((token) => (
                    <button
                      key={token.tokenId}
                      type="button"
                      className={clsx(styles.tool__chip, tokenInput === String(token.tokenId) && styles['tool__chip--active'])}
                      onClick={() => setTokenInput(String(token.tokenId))}
                      title={String(token.tokenId)}
                    >
                      #{token.display}
                    </button>
                  ))}
                </span>
              )}
            </div>

            {tokenInput.trim() && !tokenId && <p className={styles.tool__note}>A token id is a whole number — or, for LSP8, a bytes32 hex value.</p>}

            {tokenId ? (
              <TokenInspection
                chainId={chainId}
                chainInfo={chain}
                collection={target}
                tokenId={tokenId}
                inspection={inspection.inspection}
                error={inspection.error}
                isLoading={inspection.isLoading}
                onRefresh={inspection.refresh}
                isRefreshing={inspection.isRefreshing}
              />
            ) : (
              <EmptyState icon={HashIcon} className={styles.tool__inspectEmpty}>
                Type a token id{sampledTokens.length > 0 ? ', or pick one of the sampled tokens' : ''} — the number after the # on a marketplace.
              </EmptyState>
            )}
          </section>
        </>
      )}

      <section className={styles.tool__board} aria-label="Audited collections">
        <div className={styles.tool__boardHead}>
          <h2>Audited collections</h2>
          <SegmentedControl options={BOARD_SORTS} value={boardSort} onChange={setBoardSort} label="Sort audited collections" />
        </div>

        {boardRows.length === 0 ? (
          <p className={styles.tool__note}>{isBoardLoading ? 'Loading…' : 'Nothing has been audited yet — paste a collection above to be the first.'}</p>
        ) : (
          <div className={styles.tool__tableWrap}>
            <table className={styles.tool__table}>
              <thead>
                <tr>
                  <th scope="col">Collection</th>
                  <th scope="col">Chain</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Audited</th>
                  <th scope="col">
                    <span className={styles.tool__srOnly}>Link</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {boardRows.map((row) => {
                  const rowChain = appChains.find((candidate) => candidate.id === row.networkId)
                  const rowIcon = chainIconFor(rowChain)
                  return (
                    <tr key={`${row.networkId}:${row.collection}`} style={networkColorStyle(rowChain)}>
                      <td data-label="Collection">
                        <button type="button" className={styles.tool__rowTarget} onClick={() => pick(row.networkId, row.collection)}>
                          {row.icon ? (
                            <img src={resolveStorageImageUrl(row.icon, { width: 64, still: true })} alt="" onError={handleBrokenImage} />
                          ) : (
                            <span className={styles.tool__mark} aria-hidden="true">
                              {(row.name || '?').slice(0, 1)}
                            </span>
                          )}
                          <span>
                            <strong>{row.name || 'Untitled collection'}</strong>
                            <small>
                              {KIND_LABELS[row.kind] || 'Unknown'} · {row.collection.slice(0, 6)}…{row.collection.slice(-4)}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td data-label="Chain">
                        <span className={styles.tool__chain}>
                          {rowIcon ? <img src={rowIcon} alt="" /> : null}
                          {rowChain?.name || `Chain ${row.networkId}`}
                        </span>
                      </td>
                      <td data-label="Grade">
                        <span className={styles.tool__grade} style={{ '--audit-grade-color': gradeColor(row.grade) }}>
                          <b>{row.grade}</b>
                          <small>{row.score}</small>
                        </span>
                      </td>
                      <td className={styles.tool__findings} data-label="Findings">
                        <span className={styles.tool__badges}>
                          {row.badges.slice(0, BOARD_BADGES).map((id) => {
                            const badge = describeBadge(id)
                            return (
                              <span key={id} className={clsx(styles.tool__badge, styles[`tool__badge--${badge.tone}`])} title={badge.hint || undefined}>
                                {badge.label}
                              </span>
                            )
                          })}
                        </span>
                      </td>
                      <td data-label="Audited">
                        <Link href={`/nfts/${row.networkId}/collection/${row.collection}`} className={styles.tool__when}>
                          {formatRelativeTime(row.auditedAt) || '—'}
                        </Link>
                      </td>
                      <td data-label="Link">
                        <button
                          type="button"
                          className={clsx(styles.tool__copy, copiedKey === `${row.networkId}:${row.collection}` && styles['tool__copy--done'])}
                          onClick={() => copyLink(row.networkId, row.collection)}
                          aria-label={`Copy a link to the ${row.name || 'collection'} audit`}
                          title="Copy link to this audit"
                        >
                          {copiedKey === `${row.networkId}:${row.collection}` ? <CheckIcon size={15} weight="bold" /> : <CopyIcon size={15} />}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
