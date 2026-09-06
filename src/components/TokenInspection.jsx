'use client'

import { useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CodeIcon,
  DownloadSimpleIcon,
  ImageIcon,
  MinusIcon,
  QuestionIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import { networkColorStyle } from '@/lib/networkColors'
import { resolveStorageImageUrl, resolveStorageUrl } from '@/lib/storageHelper'
import { formatRelativeTime, KIND_LABELS } from '@/lib/collectionAuditFormat'
import { DEPENDENCY_KINDS, describeLevel, describeStorageClass, formatBytes, LAYER_ROLES, referenceOf } from '@/lib/nftInspect'
import CopyButton from '@/components/ui/CopyButton'
import DetailSection from '@/components/ui/DetailSection'
import EmptyState from '@/components/ui/EmptyState'
import styles from './TokenInspection.module.scss'

const COUNT = new Intl.NumberFormat()
const TONE_ICON = { good: CheckCircleIcon, warn: WarningCircleIcon, bad: XCircleIcon, neutral: MinusIcon }
const HASH_LABELS = {
  pass: { label: 'Matches', tone: 'good' },
  fail: { label: 'Mismatch', tone: 'bad' },
  none: { label: 'No digest', tone: 'neutral' },
  unchecked: { label: 'Not hashed', tone: 'neutral' },
  'n/a': { label: '—', tone: 'neutral' },
}

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null)

// A short type for the table: the subtype, with the vendor noise off
const shortMime = (mime) => {
  if (!mime) return '—'
  const [type, subtype = ''] = String(mime).split('/')
  if (subtype.includes('svg')) return 'SVG'
  if (subtype.includes('html')) return 'HTML'
  if (subtype.includes('json')) return 'JSON'
  if (subtype.includes('javascript') || subtype.includes('ecmascript')) return 'JavaScript'
  if (type === 'text' && subtype === 'css') return 'CSS'
  if (type === 'font' || /woff|ttf|otf/.test(subtype)) return 'Font'
  return subtype ? subtype.replace(/^x-/, '').toUpperCase() : type
}

// Where "open" goes for a stored layer: the app's own resolver, so IPFS and Arweave both work
const openUrlOf = (layer) => {
  if (!layer || layer.cls === 'onchain' || layer.cls === 'none' || layer.cls === 'unresolvable' || layer.cls === 'relative') return null
  if (layer.cls === 'ipfs' || layer.cls === 'ipfs-gateway') return resolveStorageUrl(`ipfs://${layer.cid}`) || null
  return layer.uri || null
}

function Verdict({ tone, children, title }) {
  const Icon = TONE_ICON[tone] || MinusIcon
  return (
    <span className={clsx(styles.inspect__verdict, styles[`inspect__verdict--${tone}`])} title={title}>
      <Icon size={14} weight={tone === 'neutral' ? 'regular' : 'fill'} />
      {children}
    </span>
  )
}

function Reachable({ layer }) {
  if (layer.cls === 'none') return <Verdict tone="bad">missing</Verdict>
  if (layer.cls === 'unresolvable') return <Verdict tone="bad">cannot resolve</Verdict>
  if (layer.reachable === true) {
    return (
      <Verdict tone="good" title={layer.via ? `Served by ${layer.via}` : undefined}>
        {layer.cls === 'onchain' ? 'inline' : layer.via ? `via ${layer.via}` : 'yes'}
      </Verdict>
    )
  }
  if (layer.reachable === false) return <Verdict tone="bad" title={layer.error || undefined}>unreachable</Verdict>
  return (
    <Verdict tone="neutral" title={layer.error || 'Not probed'}>
      not probed
    </Verdict>
  )
}

function Hash({ layer }) {
  // Nothing to say unless a digest was committed for this layer and there were bytes to hash
  if (layer.hash === 'n/a' || (!layer.verified && layer.hash !== 'pass' && layer.hash !== 'fail')) return <span className={styles['inspect__verdict--muted']}>—</span>
  const entry = HASH_LABELS[layer.hash] || HASH_LABELS.none
  return <Verdict tone={entry.tone}>{entry.label}</Verdict>
}

/**
 * The artwork as it renders: inline data as itself, in a sandbox when it is a page; stored
 * files through the app's resolvers; oversized inline art through the rasterising route.
 */
function Preview({ preview, chainId, collection, tokenId, isLsp8 }) {
  if (!preview) {
    return (
      <div className={clsx(styles.inspect__preview, styles['inspect__preview--empty'])} aria-hidden="true">
        <ImageIcon size={26} />
      </div>
    )
  }
  const rasterised = `/api/nft/image?chainId=${chainId}&collection=${collection}&tokenId=${encodeURIComponent(tokenId)}&isLsp8=${isLsp8 ? 1 : 0}&w=768`
  const src = preview.rasterised ? rasterised : preview.inline ? preview.uri : preview.kind === 'image' ? resolveStorageImageUrl(preview.uri, { width: 768 }) : resolveStorageUrl(preview.uri)

  let body
  if (preview.kind === 'html') {
    // Sandboxed with scripts only: generative art needs to run, and nothing else it could ask for
    body = <iframe src={src} sandbox="allow-scripts" title="Artwork preview" loading="lazy" />
  } else if (preview.kind === 'video') {
    body = <video src={src} muted autoPlay loop playsInline controls preload="metadata" />
  } else if (preview.kind === 'audio') {
    body = <audio src={src} controls preload="metadata" />
  } else if (preview.kind === 'image') {
    body = <img src={src} alt="Token artwork" />
  } else {
    body = <CodeIcon size={26} />
  }

  return (
    <div className={styles.inspect__previewWrap}>
      <div className={clsx(styles.inspect__preview, preview.kind === 'audio' && styles['inspect__preview--audio'])}>{body}</div>
      {preview.inline ? (
        <a href={preview.uri} download={`token-${tokenId}.${preview.kind === 'html' ? 'html' : preview.mime?.includes('svg') ? 'svg' : 'bin'}`} className={styles.inspect__previewLink}>
          <DownloadSimpleIcon size={12} weight="bold" /> Save the inline file
        </a>
      ) : src ? (
        <a href={src} target="_blank" rel="noopener noreferrer" className={styles.inspect__previewLink}>
          <ArrowSquareOutIcon size={12} weight="bold" /> Open the file
        </a>
      ) : null}
    </div>
  )
}

/**
 * Token Inspection
 * One token decoded, under the collection's audit: the verdict and the five checks behind it,
 * then the decode tree, the outside resources the artwork loads, the contracts that render it,
 * the standards, the contract's facts, the raw data and how it is all judged.
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {Object} [props.chainInfo] Entry from appChains, for colours and explorer.
 * @param {string} props.collection Collection contract address.
 * @param {string} props.tokenId The id as typed.
 * @param {Object|null} props.inspection The server's answer.
 * @param {Error|null} props.error Why there is none.
 * @param {boolean} props.isLoading
 * @param {Function} props.onRefresh Asks for a fresh inspection.
 * @param {boolean} props.isRefreshing
 */
export default function TokenInspection({ chainId, chainInfo, collection, tokenId, inspection, error, isLoading, onRefresh, isRefreshing }) {
  const [openText, setOpenText] = useState(null)
  const style = networkColorStyle(chainInfo)

  if (isLoading) {
    return (
      <div className={clsx(styles.inspect, styles['inspect--skeleton'])} style={style} aria-busy="true">
        <span>Reading the contract, following every layer, tracing the render…</span>
      </div>
    )
  }

  if (!inspection) {
    return (
      <div className={clsx(styles.inspect, styles['inspect--empty'])} style={style}>
        <EmptyState
          icon={ShieldCheckIcon}
          size="lg"
          align="center"
          action={
            <button type="button" className={styles.inspect__button} onClick={onRefresh} disabled={isRefreshing}>
              <ArrowsClockwiseIcon size={14} className={clsx(isRefreshing && styles.inspect__spin)} /> Try again
            </button>
          }
        >
          {error?.message || 'This token could not be inspected.'}
        </EmptyState>
      </div>
    )
  }

  const { contract, verdict, layers, dependencies, renderers, standards, pointer, preview } = inspection
  const level = describeLevel(verdict.level)
  const LevelIcon = TONE_ICON[level.tone] || MinusIcon
  const metadataLayer = layers.find((layer) => layer.role === 'metadata')
  const tokenName = metadataLayer?.json?.LSP4Metadata?.name || metadataLayer?.json?.name || null
  const isLsp8 = inspection.kind === 'lsp8'
  const explorerBase = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '') || null
  const explorerAddress = explorerBase ? `${explorerBase}/address/${collection}` : null
  const supported = standards.filter((standard) => standard.supported)
  const foreignRenderers = Array.isArray(renderers) ? renderers : []
  // The audit page with this token filled in — the same URL the page keeps in its address bar
  const shareHref = `/nfts/audit?network=${chainId}&address=${collection}&tokenId=${encodeURIComponent(tokenId)}`
  const idForRoutes = inspection.tokenId.normalized || tokenId
  const tokenHref = inspection.kind === 'lsp7' ? `/nfts/${chainId}/collection/${collection}` : `/nfts/${chainId}/collection/${collection}/${idForRoutes}`

  const mutabilityNote = contract.isProxy
    ? 'A proxy: the implementation, and with it every pointer, can be replaced'
    : contract.frozen
      ? 'Frozen — the collection locked its pointers for good'
      : !contract.mutable
        ? 'Immutable — no owner and no setter can move the pointers'
        : isLsp8 || inspection.kind === 'lsp7'
          ? 'The owner can rewrite every pointer through setData (ERC725Y)'
          : `The owner can rewrite pointers through ${contract.setters.join(', ')}`

  return (
    <article className={styles.inspect} style={style} aria-label="Token inspection">
      <header className={styles.inspect__hero}>
        <Preview preview={preview} chainId={chainId} collection={collection} tokenId={idForRoutes} isLsp8={isLsp8} />
        <div className={styles.inspect__headline}>
          <span className={clsx(styles.inspect__level, styles[`inspect__level--${level.tone}`])} title={level.hint}>
            <LevelIcon size={14} weight={level.tone === 'neutral' ? 'regular' : 'fill'} aria-hidden="true" />
            {level.label}
          </span>
          <h2 className={styles.inspect__title}>
            {tokenName || contract.name || 'Untitled token'}
            {inspection.kind !== 'lsp7' && <small>#{inspection.tokenId.display}</small>}
          </h2>
          <p className={styles.inspect__summary}>{verdict.summary}</p>
          <div className={styles.inspect__meta}>
            <span>{KIND_LABELS[inspection.kind] || 'Unknown standard'}</span>
            <Link href={tokenHref} className={styles.inspect__metaLink}>
              {inspection.kind === 'lsp7' ? 'Open the collection' : 'Open the token'}
            </Link>
            {explorerAddress && (
              <a href={explorerAddress} target="_blank" rel="noopener noreferrer" className={styles.inspect__metaLink}>
                Explorer <ArrowSquareOutIcon size={11} />
              </a>
            )}
            <span title={new Date(inspection.inspectedAt).toLocaleString()}>Inspected {formatRelativeTime(inspection.inspectedAt) || 'just now'}</span>
            {inspection.exists === false && <span className={styles.inspect__flag}>no owner — maybe unminted</span>}
          </div>
        </div>
        <div className={styles.inspect__actions}>
          <button type="button" className={styles.inspect__button} onClick={onRefresh} disabled={isRefreshing} title="Decode it again, past the cache">
            <ArrowsClockwiseIcon size={14} className={clsx(isRefreshing && styles.inspect__spin)} />
            {isRefreshing ? 'Inspecting…' : 'Re-check'}
          </button>
          <CopyButton value={shareHref} label="Copy link" title="Copy a link to this token's inspection" variant="chip" size={13} />
        </div>
      </header>

      {/* Five questions a collector would ask, each answered in a sentence */}
      <ul className={styles.inspect__plain} aria-label="What this means">
        {verdict.checks.map((row) => {
          const Icon = TONE_ICON[row.tone] || MinusIcon
          return (
            <li key={row.key} className={clsx(styles.inspect__plainRow, styles[`inspect__plainRow--${row.tone}`])}>
              <Icon size={18} weight={row.tone === 'neutral' ? 'regular' : 'fill'} aria-hidden="true" />
              <span className={styles.inspect__plainText}>
                <strong>{row.label}</strong>
                <span>{row.text}</span>
              </span>
            </li>
          )
        })}
      </ul>

      <h3 className={styles.inspect__sectionsHead}>Full decode</h3>
      <div className={styles.inspect__sections}>
        <DetailSection title="Decode tree" count={layers.length} defaultOpen>
          <div className={styles.inspect__tableWrap}>
            <table className={styles.inspect__table}>
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">Where</th>
                  <th scope="col">Type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Reachable</th>
                  <th scope="col">Hash</th>
                  <th scope="col">
                    <span className={styles.inspect__srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {layers.map((layer) => {
                  const storage = describeStorageClass(layer.cls)
                  const openUrl = openUrlOf(layer)
                  const hasText = typeof layer.text === 'string' && layer.text.length > 0
                  const isOpen = openText === layer.id
                  return (
                    <LayerRows key={layer.id} layer={layer} storage={storage} openUrl={openUrl} hasText={hasText} isOpen={isOpen} onToggle={() => setOpenText(isOpen ? null : layer.id)} />
                  )
                })}
              </tbody>
            </table>
          </div>
          {pointer.source === 'collection' && inspection.kind !== 'lsp7' && (
            <p className={styles.inspect__note}>This token has no document of its own: it falls back to the collection&rsquo;s LSP4Metadata, so what is decoded here describes the collection.</p>
          )}
          {pointer.source === 'base' && <p className={styles.inspect__note}>The document was found by joining the token id onto the collection&rsquo;s shared base URI.</p>}
        </DetailSection>

        <DetailSection title="What the artwork loads" count={dependencies.length} defaultOpen={dependencies.length > 0}>
          {dependencies.length === 0 ? (
            <EmptyState size="sm" className={styles.inspect__empty}>
              {layers.some((layer) => layer.scanned) ? 'The artwork asks for nothing from outside itself.' : 'The artwork is a plain file: there is no code in it to load anything.'}
            </EmptyState>
          ) : (
            <div className={styles.inspect__tableWrap}>
              <table className={styles.inspect__table}>
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Where</th>
                    <th scope="col">Found in</th>
                  </tr>
                </thead>
                <tbody>
                  {dependencies.map((dependency) => {
                    const storage = describeStorageClass(dependency.cls)
                    const owner = layers.find((layer) => layer.id === dependency.foundIn)
                    return (
                      <tr key={`${dependency.foundIn}:${dependency.url}`}>
                        <td data-label="Resource">
                          <code className={styles.inspect__code} title={dependency.url}>
                            {dependency.url.length > 72 ? `${dependency.url.slice(0, 40)}…${dependency.url.slice(-28)}` : dependency.url}
                          </code>
                        </td>
                        <td data-label="Kind">{DEPENDENCY_KINDS[dependency.kind] || dependency.kind}</td>
                        <td data-label="Where">
                          <span className={styles.inspect__where}>
                            <span className={clsx(styles.inspect__class, styles[`inspect__class--${storage.tone}`])}>{storage.label}</span>
                            {dependency.host && <small>{dependency.host}</small>}
                            {dependency.relative && !dependency.host && <small>relative path</small>}
                          </span>
                        </td>
                        <td data-label="Found in">{owner ? `${LAYER_ROLES[owner.role] || owner.role} (${shortMime(owner.mime)})` : dependency.foundIn}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        <DetailSection title="Contracts that take part in rendering" count={renderers === null ? null : foreignRenderers.length} defaultOpen={foreignRenderers.length > 0}>
          {renderers === null ? (
            <EmptyState size="sm" icon={QuestionIcon} className={styles.inspect__empty}>
              This network&rsquo;s RPC does not offer access-list tracing, so which contracts answer for the token could not be seen.
            </EmptyState>
          ) : foreignRenderers.length === 0 ? (
            <EmptyState size="sm" className={styles.inspect__empty}>
              The collection contract answers on its own — no renderer, library or storage contract was touched.
            </EmptyState>
          ) : (
            <div className={styles.inspect__tableWrap}>
              <table className={styles.inspect__table}>
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Role</th>
                    <th scope="col">Code</th>
                    <th scope="col">Upgradeable</th>
                  </tr>
                </thead>
                <tbody>
                  {foreignRenderers.map((entry) => (
                    <tr key={entry.address}>
                      <td data-label="Contract">
                        <span className={styles.inspect__item}>
                          <strong>{entry.name || shortAddress(entry.address)}</strong>
                          <small>
                            {explorerBase ? (
                              <a href={`${explorerBase}/address/${entry.address}`} target="_blank" rel="noopener noreferrer" className={styles.inspect__inlineLink}>
                                {entry.address} <ArrowSquareOutIcon size={10} />
                              </a>
                            ) : (
                              entry.address
                            )}
                          </small>
                        </span>
                      </td>
                      <td data-label="Role">{entry.role === 'implementation' ? 'Proxy implementation' : entry.codeSize === 0 ? 'Account (no code)' : entry.slots > 0 ? 'Storage read' : 'Called'}</td>
                      <td data-label="Code">{entry.codeSize > 0 ? `${formatBytes(entry.codeSize)}` : '—'}</td>
                      <td data-label="Upgradeable">
                        {entry.isProxy ? (
                          <Verdict tone="warn" title={entry.implementation ? `Implementation ${entry.implementation}` : 'Minimal proxy'}>
                            Proxy
                          </Verdict>
                        ) : (
                          <Verdict tone="good">No</Verdict>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        <DetailSection title="Standards" count={supported.length}>
          <div className={styles.inspect__standards}>
            {standards.map((standard) => (
              <span key={standard.key} className={clsx(styles.inspect__standard, standard.supported && styles['inspect__standard--on'])} title={`${standard.id} · ${standard.hint}`}>
                {standard.supported ? <CheckCircleIcon size={12} weight="fill" /> : <MinusIcon size={12} />}
                {standard.label}
              </span>
            ))}
          </div>
          {contract.announcesUpdates && <p className={styles.inspect__note}>ERC4906 is a declaration that metadata is expected to change: wallets are told to refresh when it does.</p>}
        </DetailSection>

        <DetailSection title="The contract">
          <dl className={styles.inspect__facts}>
            <div>
              <dt>Standard</dt>
              <dd>
                {KIND_LABELS[inspection.kind] || 'Unknown'}
                {contract.name ? ` · ${contract.name}` : ''}
                {contract.symbol ? ` (${contract.symbol})` : ''}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{contract.renounced ? 'Renounced' : contract.owner ? <span title={contract.owner}>{shortAddress(contract.owner)}</span> : 'None exposed'}</dd>
            </div>
            <div>
              <dt>Upgradeable</dt>
              <dd>
                {contract.isProxy ? (
                  <Verdict tone="warn" title={contract.implementation ? `Implementation ${contract.implementation}` : 'Minimal proxy'}>
                    Proxy{contract.implementation ? ` → ${shortAddress(contract.implementation)}` : ''}
                  </Verdict>
                ) : (
                  <Verdict tone="good">No proxy</Verdict>
                )}
              </dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{contract.totalSupply ? COUNT.format(BigInt(contract.totalSupply)) : '—'}</dd>
            </div>
            <div className={styles['inspect__fact--wide']}>
              <dt>Metadata</dt>
              <dd>{mutabilityNote}</dd>
            </div>
            <div>
              <dt>Code size</dt>
              <dd>{formatBytes(contract.codeSize)}</dd>
            </div>
            <div>
              <dt>Setters in bytecode</dt>
              <dd>{contract.setters.length > 0 ? contract.setters.join(', ') : isLsp8 || inspection.kind === 'lsp7' ? 'setData (ERC725Y)' : 'none found'}</dd>
            </div>
          </dl>
        </DetailSection>

        <DetailSection title="Raw data">
          <dl className={styles.inspect__facts}>
            <div className={styles['inspect__fact--wide']}>
              <dt>Read through</dt>
              <dd>
                {pointer.method || '—'}
                {pointer.source && <small className={styles.inspect__muted}> · {pointer.source === 'token' ? 'the token’s own pointer' : pointer.source === 'base' ? 'base URI + id' : 'the collection document'}</small>}
              </dd>
            </div>
            {pointer.verification && (
              <div className={styles['inspect__fact--wide']}>
                <dt>Onchain digest</dt>
                <dd>
                  <code className={styles.inspect__code}>{pointer.verification.digest}</code>
                  <small className={styles.inspect__muted}> · {pointer.verification.name || pointer.verification.method}</small>
                </dd>
              </div>
            )}
          </dl>
          <div className={styles.inspect__rawHead}>
            <strong>Returned value</strong>
            <small>{COUNT.format(pointer.rawLength)} chars</small>
            {pointer.raw && <CopyButton value={pointer.raw} title="Copy the raw value" size={12} />}
          </div>
          <pre className={styles.inspect__pre}>{pointer.raw || '—'}</pre>
          {metadataLayer?.json && (
            <>
              <div className={styles.inspect__rawHead}>
                <strong>Decoded document</strong>
                <small>strings over 600 characters are cut</small>
              </div>
              <pre className={styles.inspect__pre}>{JSON.stringify(metadataLayer.json, null, 2)}</pre>
            </>
          )}
        </DetailSection>

        <DetailSection title="How this is judged">
          <div className={styles.inspect__method}>
            <p>
              The contract is asked for the token the way its standard stores it — tokenURI, uri, or an LSP8 getDataForTokenId with the base-URI and collection fallbacks — and the answer is
              followed as far as it goes: a data: URI is decoded in place, an IPFS CID is raced across the gateways, a web URL is fetched. The document&rsquo;s artwork, animation, icon and
              assets are followed the same way. Anything that is code — SVG, HTML, JavaScript, CSS — is read whole and scanned for what it loads: script and style tags, images, fonts,
              imports, fetch calls. Inline data: URIs inside it are counted as embedded, not as dependencies.
            </p>
            <p>
              Fully onchain means the document and the artwork are both inline data and the artwork loads nothing from outside. Rendering contracts come from an access-list trace of the
              same call: every address the node touched while answering. A collection is upgradeable when an EIP-1967 implementation slot is set or the code is a minimal proxy;
              mutable when the standard guarantees a setter (ERC725Y) or the bytecode carries one, and frozen when the collection says so itself.
            </p>
            <p>Unknown is never a defect: a network without access lists, or a gateway that does not answer, leaves a question open rather than counting against the token.</p>
          </div>
        </DetailSection>
      </div>
    </article>
  )
}

/** One layer's row, and beneath it — when opened — a sample of its text. */
function LayerRows({ layer, storage, openUrl, hasText, isOpen, onToggle }) {
  const reference = referenceOf(layer)
  return (
    <>
      <tr className={clsx(layer.depth === 0 && styles['inspect__row--group'])}>
        <td data-label="Layer">
          <span className={styles.inspect__item} style={{ '--inspect-depth': layer.depth }}>
            <strong>
              {layer.depth > 0 && <span className={styles.inspect__branch} aria-hidden="true" />}
              {LAYER_ROLES[layer.role] || layer.role}
            </strong>
            <small title={layer.uri || undefined}>{layer.label || (layer.role === 'embedded' ? shortMime(layer.mime) : layer.uri && layer.cls !== 'onchain' ? layer.uri : reference)}</small>
          </span>
        </td>
        <td data-label="Where">
          <span className={styles.inspect__where}>
            <span className={clsx(styles.inspect__class, styles[`inspect__class--${storage.tone}`])}>{storage.label}</span>
            {reference && layer.cls !== 'none' && <small title={layer.uri || undefined}>{reference}</small>}
          </span>
        </td>
        <td data-label="Type">
          <span title={layer.mime || undefined}>{shortMime(layer.mime)}</span>
          {layer.encoding && layer.encoding !== 'plain' && <small className={styles.inspect__muted}> · {layer.encoding}</small>}
        </td>
        <td data-label="Size">
          <span title={layer.sizeSource ? `From ${layer.sizeSource}` : undefined}>{formatBytes(layer.size)}</span>
        </td>
        <td data-label="Reachable">
          <Reachable layer={layer} />
        </td>
        <td data-label="Hash">
          <Hash layer={layer} />
        </td>
        <td data-label="Actions">
          <span className={styles.inspect__rowActions}>
            {hasText && (
              <button type="button" className={clsx(styles.inspect__iconButton, isOpen && styles['inspect__iconButton--active'])} onClick={onToggle} aria-expanded={isOpen} aria-label={isOpen ? 'Hide the source' : 'Show the source'} title={isOpen ? 'Hide the source' : 'Show the source'}>
                <CodeIcon size={14} weight="bold" />
              </button>
            )}
            {openUrl && (
              <a href={openUrl} target="_blank" rel="noopener noreferrer" className={styles.inspect__iconButton} aria-label="Open the file in a new tab" title={openUrl}>
                <ArrowSquareOutIcon size={14} weight="bold" />
              </a>
            )}
          </span>
        </td>
      </tr>
      {isOpen && hasText && (
        <tr className={styles.inspect__sourceRow}>
          <td colSpan={7}>
            <pre className={styles.inspect__pre}>{layer.text}</pre>
            {layer.textTruncated && <small className={styles.inspect__muted}>Showing the first {formatBytes(layer.text.length)} of the file.</small>}
          </td>
        </tr>
      )}
    </>
  )
}
