'use client'

/**
 * Instagram-style links row for the profile header.
 *
 * A profile can carry any number of links, and a tab for them buried the one thing
 * a visitor most often wants to reach. So the header shows the first one inline —
 * `www.getlayers.ai and 1 more` — and the rest live one tap away in a modal.
 *
 * A lone link needs no modal: the row itself is the anchor.
 */

import { useMemo, useRef } from 'react'
import { LinkSimpleIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './ProfileLinks.module.scss'

// Links arrive as a stringified JSON array on most reads and as a real array on some,
// and both shapes have historically held half-written entries like {"name":""}.
const parseLinks = (raw) => {
  if (!raw) return []

  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error('Failed to parse profile links structure:', error)
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((link) => link && typeof link === 'object' && typeof link.url === 'string' && link.url.trim() !== '')
    .map((link) => ({
      label: (link.title || link.name || '').trim(),
      url: link.url.trim(),
    }))
}

// A bare `hup.social` in the profile is still meant as a URL, so anything without a
// scheme gets a protocol-relative one rather than resolving against the current route.
const toHref = (url) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `//${url}`)

// What the row reads as: the destination, not the plumbing around it.
const prettyUrl = (url) =>
  url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')

const hostOf = (url) => {
  try {
    return new URL(toHref(url), 'https://hup.social').hostname.replace(/^www\./i, '')
  } catch (error) {
    return prettyUrl(url).split(/[/?#]/)[0]
  }
}

// The one-line summary shares its row with "and N more", so it can't hold an arbitrary
// URL. A short path still reads well and is worth keeping — `x.com/TheCitadelRPG` says
// more than `x.com` does — but past this width a slug only ever truncates to an
// unreadable stub, so the domain alone serves better. The full address is in the tooltip.
const INLINE_URL_MAX = 32
const compactUrl = (url) => {
  const pretty = prettyUrl(url)
  return pretty.length <= INLINE_URL_MAX ? pretty : hostOf(url)
}

export default function ProfileLinks({ links: rawLinks }) {
  const links = useMemo(() => parseLinks(rawLinks), [rawLinks])
  const dialogRef = useRef(null)

  if (links.length === 0) return null

  const [first, ...rest] = links

  return (
    <>
      {rest.length === 0 ? (
        <a className={styles.profileLinks__row} href={toHref(first.url)} target="_blank" rel="noopener noreferrer" title={first.url}>
          <LinkSimpleIcon size={14} weight="bold" />
          <span className={styles.profileLinks__primary}>{compactUrl(first.url)}</span>
        </a>
      ) : (
        <button
          type="button"
          className={styles.profileLinks__row}
          aria-haspopup="dialog"
          title={first.url}
          onClick={() => dialogRef.current?.open()}
        >
          <LinkSimpleIcon size={14} weight="bold" />
          <span className={styles.profileLinks__primary}>{compactUrl(first.url)}</span>
          <span className={styles.profileLinks__more}>and {rest.length} more</span>
        </button>
      )}

      {rest.length > 0 && (
        <NativeDialog ref={dialogRef} className={styles.dialog} lightDismiss aria-label="Links">
          <header className={styles.dialog__header}>
            <button type="button" className={styles.dialog__close} aria-label="Close" onClick={() => dialogRef.current?.close()}>
              <XIcon size={20} />
            </button>
            <h3 className={styles.dialog__title}>Links</h3>
          </header>

          <ul className={styles.dialog__list}>
            {links.map((link, index) => {
              // Named links lead with the name, unnamed ones with the compact address, so the
              // bold line is always something short and recognisable. The full address is the
              // second line — it wraps rather than clipping, since the tail of a URL is often
              // the only thing telling two of them apart.
              const primary = link.label || compactUrl(link.url)
              const secondary = prettyUrl(link.url)

              return (
                <li key={`${link.url}-${index}`}>
                  <a className={styles.dialog__link} href={toHref(link.url)} target="_blank" rel="noopener noreferrer" title={link.url}>
                    <span className={styles.dialog__icon}>
                      <LinkSimpleIcon size={18} weight="bold" />
                    </span>
                    <span className={styles.dialog__text}>
                      <strong>{primary}</strong>
                      {secondary !== primary && <small>{secondary}</small>}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </NativeDialog>
      )}
    </>
  )
}
